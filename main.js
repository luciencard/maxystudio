// ScratchCode Studio 1.2 - processus principal Electron
// Un projet est un vrai dossier sur le disque :
//   MonJeu/
//     project.scratchcode   configuration (type 2d, 3d ou app, scène principale...)
//     scenes/Main.scene     objets de la scène (JSON)
//     scripts/*.sc          un script par objet, en ScratchCode
//     assets/               modèles 3D, images, sons importés
//     SCRATCHCODE.md        guide de syntaxe (utile aux assistants IA)
// Un projet entier peut aussi être échangé en un seul fichier .scratchcode (archive zip).

const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const zlib = require('zlib');
const crypto = require('crypto');
const T = require('./templates');

// ---------- Zip (écriture et lecture, sans dépendance) ----------
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function createZipBuffer(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(entries)) {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); nameBuf.copy(local, 30);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42); nameBuf.copy(central, 46);
    localParts.push(local, compressed); centralParts.push(central);
    offset += local.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(count, 8); eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function readZipBuffer(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ce fichier n'est pas une archive .scratchcode valide.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const data = buf.slice(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    if (!name.endsWith('/')) out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// ---------- Chemins et protocole app:// ----------
const ROOT = __dirname;
const ENGINE_DIR = path.join(ROOT, 'engine');
const UI_DIR = path.join(ROOT, 'renderer');
const MONACO_DIR = path.join(ROOT, 'node_modules', 'monaco-editor', 'min');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const openDirs = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const encDir = dir => Buffer.from(dir, 'utf8').toString('base64url');
const decDir = s => Buffer.from(s, 'base64url').toString('utf8');

// Toutes les pages partagent l'origine app://studio pour que l'éditeur puisse piloter le moteur.
function resolveAppPath(urlPath) {
  const p = decodeURIComponent(urlPath);
  if (p.startsWith('/studio/')) return path.join(UI_DIR, p.slice('/studio/'.length));
  if (p.startsWith('/monaco/')) return path.join(MONACO_DIR, p.slice('/monaco/'.length));
  if (p.startsWith('/three/')) return path.join(THREE_DIR, p.slice('/three/'.length));
  if (p.startsWith('/project/')) {
    const [, , key, ...rest] = p.split('/');
    const dir = decDir(key);
    if (!openDirs.has(dir)) return null;
    return safeJoin(dir, rest.join('/'));
  }
  return path.join(ENGINE_DIR, p === '/' ? 'index.html' : p.slice(1));
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let file;
    try { file = resolveAppPath(url.pathname); } catch { file = null; }
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const stat = await fsp.stat(file).catch(() => null);
      if (stat && stat.isDirectory()) file = path.join(file, 'index.html');
      const data = await fsp.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- Projets récents ----------
const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');
async function readRecent() {
  try { return JSON.parse(await fsp.readFile(recentFile(), 'utf8')); } catch { return []; }
}
async function addRecent(dir, name, type) {
  let list = (await readRecent()).filter(p => p.path !== dir);
  list.unshift({ path: dir, name, type, openedAt: Date.now() });
  list = list.slice(0, 16);
  await fsp.mkdir(path.dirname(recentFile()), { recursive: true });
  await fsp.writeFile(recentFile(), JSON.stringify(list, null, 2));
}

// ---------- Création, lecture et migration ----------
const safeName = n => String(n || 'MonProjet').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'MonProjet';

async function createProject({ parentDir, name, type, template }) {
  const safe = safeName(name);
  const dir = path.join(parentDir, safe);
  if (fs.existsSync(dir) && (await fsp.readdir(dir)).length) throw new Error(`Le dossier "${dir}" existe déjà et n'est pas vide.`);
  const tpl = T.build(type, template, safe);
  for (const [rel, content] of Object.entries(tpl.files)) {
    const full = path.join(dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content);
  }
  await fsp.mkdir(path.join(dir, 'assets'), { recursive: true });
  const config = {
    format: 'scratchcode', version: 2, engine: '1.2', name: safe, type: tpl.type, template: template || 'vide',
    mainScene: 'scenes/Main.scene', settings: { title: safe }, created: new Date().toISOString()
  };
  await fsp.writeFile(path.join(dir, 'project.scratchcode'), JSON.stringify(config, null, 2));
  await fsp.writeFile(path.join(dir, 'SCRATCHCODE.md'), T.guide(tpl.type));
  return dir;
}

// Les projets 1.0 / 1.1 (stage.sc + sprites/*.sc + .sb3) deviennent des projets 2D avec une scène.
async function migrate(dir, config) {
  if (config.version >= 2 && fs.existsSync(path.join(dir, config.mainScene || 'scenes/Main.scene'))) return config;
  const spritesDir = path.join(dir, 'sprites');
  const names = fs.existsSync(spritesDir) ? (await fsp.readdir(spritesDir)).filter(f => f.endsWith('.sc')).map(f => f.slice(0, -3)) : [];
  const scene = T.legacyScene(names, fs.existsSync(path.join(dir, 'stage.sc')));
  await fsp.mkdir(path.join(dir, 'scenes'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'scenes', 'Main.scene'), JSON.stringify(scene, null, 2));
  const next = { format: 'scratchcode', version: 2, engine: '1.2', name: config.name || path.basename(dir), type: '2d', mainScene: 'scenes/Main.scene', settings: { title: config.title || config.name }, created: config.created || new Date().toISOString(), migratedFrom: config.version || 1 };
  await fsp.writeFile(path.join(dir, 'project.scratchcode'), JSON.stringify(next, null, 2));
  return next;
}

async function readProject(dir) {
  const cfgPath = path.join(dir, 'project.scratchcode');
  if (!fs.existsSync(cfgPath)) throw new Error('Ce dossier ne contient pas de fichier project.scratchcode.');
  let config = JSON.parse(await fsp.readFile(cfgPath, 'utf8'));
  config = await migrate(dir, config);
  openDirs.add(dir);
  return { dir, config, tree: await listTree(dir), assetBase: `app://studio/project/${encDir(dir)}/` };
}

async function listTree(dir, rel = '') {
  const out = [];
  const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push({ type: 'dir', path: r, name: e.name, children: await listTree(dir, r) });
    else {
      const st = await fsp.stat(path.join(dir, r)).catch(() => null);
      out.push({ type: 'file', path: r, name: e.name, size: st ? st.size : 0 });
    }
  }
  return out;
}

function safeJoin(dir, rel) {
  const full = path.resolve(dir, rel);
  if (full !== path.resolve(dir) && !full.startsWith(path.resolve(dir) + path.sep)) throw new Error('Chemin invalide');
  return full;
}

async function walkFiles(dir, rel = '', out = []) {
  for (const e of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walkFiles(dir, r, out); else out.push(r);
  }
  return out;
}

// ---------- Archive Scratch construite en mémoire pour le mode Jeu ----------
const EMPTY_SVG = '<svg version="1.1" width="2" height="2" viewBox="0 0 2 2" xmlns="http://www.w3.org/2000/svg"></svg>';
function imageSize(buf, ext) {
  try {
    if (ext === 'png') return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (ext === 'gif') return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (ext === 'svg') {
      const s = buf.toString('utf8', 0, 4000);
      const vb = s.match(/viewBox\s*=\s*"\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/);
      const w = s.match(/\swidth\s*=\s*"([\d.]+)/), h = s.match(/\sheight\s*=\s*"([\d.]+)/);
      if (w && h) return [+w[1], +h[1]];
      if (vb) return [+vb[1], +vb[2]];
    }
  } catch { /* taille inconnue */ }
  return [96, 96];
}
async function buildPlayArchive(dir, spec) {
  // project.json doit être le premier fichier de l'archive pour le lecteur de projets Scratch
  const files = { 'project.json': '' };
  const addAsset = async (rel, kind) => {
    let data, ext;
    if (rel) {
      try { data = await fsp.readFile(safeJoin(dir, rel)); ext = path.extname(rel).slice(1).toLowerCase(); } catch { data = null; }
    }
    if (!data) { data = Buffer.from(kind === 'sound' ? '' : EMPTY_SVG); ext = 'svg'; }
    if (ext === 'jpeg') ext = 'jpg';
    const md5 = crypto.createHash('md5').update(data).digest('hex');
    files[`${md5}.${ext}`] = data;
    return { md5, ext, data };
  };
  const costume = async (c) => {
    const a = await addAsset(c.rel, 'image');
    const [w, h] = imageSize(a.data, a.ext);
    return { name: c.name || 'costume', dataFormat: a.ext, assetId: a.md5, md5ext: `${a.md5}.${a.ext}`, bitmapResolution: 1, rotationCenterX: w / 2, rotationCenterY: h / 2 };
  };
  const sound = async (s) => {
    const a = await addAsset(s.rel, 'sound');
    return { name: s.name || 'son', dataFormat: a.ext === 'mp3' ? 'mp3' : 'wav', assetId: a.md5, md5ext: `${a.md5}.${a.ext}`, rate: 48000, sampleCount: 0 };
  };
  const stageCostumes = [];
  for (const c of (spec.stage && spec.stage.costumes && spec.stage.costumes.length ? spec.stage.costumes : [{ name: 'fond' }])) stageCostumes.push(await costume(c));
  const targets = [{
    isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: stageCostumes,
    sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null
  }];
  let layer = 1;
  for (const sp of spec.sprites || []) {
    const costumes = [];
    for (const c of (sp.costumes && sp.costumes.length ? sp.costumes : [{ name: 'vide' }])) costumes.push(await costume(c));
    const sounds = [];
    for (const s of sp.sounds || []) if (s.rel && fs.existsSync(safeJoin(dir, s.rel))) sounds.push(await sound(s));
    targets.push({
      isStage: false, name: sp.name, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes, sounds,
      volume: 100, layerOrder: layer++, visible: sp.visible !== false, x: +sp.x || 0, y: +sp.y || 0, size: sp.size == null ? 100 : +sp.size,
      direction: sp.direction == null ? 90 : +sp.direction, draggable: !!sp.draggable, rotationStyle: sp.rotationStyle || 'all around'
    });
  }
  files['project.json'] = JSON.stringify({ targets, monitors: [], extensions: [], meta: { semver: '3.0.0', vm: '0.2.0', agent: 'ScratchCode Studio 1.2' } });
  return createZipBuffer(files).toString('base64');
}

// ---------- Fenêtres ----------
let hubWin = null;
const watchers = new Map();

function createHub() {
  if (hubWin && !hubWin.isDestroyed()) { hubWin.focus(); return; }
  hubWin = new BrowserWindow({
    width: 980, height: 660, minWidth: 800, minHeight: 540, title: 'ScratchCode Studio',
    backgroundColor: '#1e1f22', icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  hubWin.loadURL('app://studio/studio/hub.html');
  hubWin.on('closed', () => { hubWin = null; });
}

async function openProjectWindow(dir) {
  const project = await readProject(dir);
  await addRecent(dir, project.config.name, project.config.type);
  const win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1080, minHeight: 680, title: `${project.config.name} - ScratchCode Studio`,
    backgroundColor: '#1e1f22', icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  win.loadURL('app://studio/studio/studio.html?dir=' + encodeURIComponent(dir));
  // Les changements faits par un autre outil (éditeur, assistant IA) sont envoyés à l'éditeur.
  let timer = null; const changed = new Set();
  try {
    const w = fs.watch(dir, { recursive: true }, (_evt, file) => {
      if (!file) return;
      changed.add(String(file).split(path.sep).join('/'));
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('project:changed', [...changed]);
        changed.clear();
      }, 150);
    });
    watchers.set(win.id, w);
  } catch (e) { console.warn('watch', e); }
  win.on('closed', () => { const w = watchers.get(win.id); if (w) w.close(); watchers.delete(win.id); });
  if (hubWin && !hubWin.isDestroyed()) hubWin.close();
}

async function importArchive(file, parentDir) {
  const entries = readZipBuffer(await fsp.readFile(file));
  const cfgName = Object.keys(entries).find(k => k === 'project.scratchcode' || k.endsWith('/project.scratchcode'));
  if (!cfgName) throw new Error("Cette archive ne contient pas de projet ScratchCode (project.scratchcode manquant).");
  const prefix = cfgName.slice(0, -'project.scratchcode'.length);
  let cfg = {};
  try { cfg = JSON.parse(entries[cfgName].toString('utf8')); } catch { /* nom par défaut */ }
  const base = safeName(cfg.name || path.basename(file, path.extname(file)));
  let dir = path.join(parentDir, base), i = 2;
  while (fs.existsSync(dir) && (await fsp.readdir(dir)).length) dir = path.join(parentDir, `${base} (${i++})`);
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith(prefix)) continue;
    const full = safeJoin(dir, name.slice(prefix.length));
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, data);
  }
  return dir;
}

async function openPathArg(p) {
  if (!p || !fs.existsSync(p)) return false;
  const st = await fsp.stat(p);
  if (st.isDirectory()) { await openProjectWindow(p); return true; }
  if (path.basename(p) === 'project.scratchcode') { await openProjectWindow(path.dirname(p)); return true; }
  if (p.toLowerCase().endsWith('.scratchcode')) {
    const dir = await importArchive(p, path.join(app.getPath('documents'), 'ScratchCode Projects'));
    await openProjectWindow(dir);
    return true;
  }
  return false;
}

// ---------- IPC ----------
const defaultLocation = () => path.join(app.getPath('documents'), 'ScratchCode Projects');
ipcMain.handle('recent:list', async () => (await readRecent()).filter(p => fs.existsSync(path.join(p.path, 'project.scratchcode'))));
ipcMain.handle('recent:remove', async (_e, dir) => {
  const list = (await readRecent()).filter(p => p.path !== dir);
  await fsp.writeFile(recentFile(), JSON.stringify(list, null, 2));
  return true;
});
ipcMain.handle('dialog:pickFolder', async (e, title) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: title || 'Choisir un dossier', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app:defaultLocation', () => defaultLocation());
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('project:create', async (_e, opts) => {
  await fsp.mkdir(opts.parentDir, { recursive: true });
  const dir = await createProject(opts);
  await openProjectWindow(dir);
  return dir;
});
ipcMain.handle('project:open', async (_e, dir) => { await openProjectWindow(dir); return true; });
ipcMain.handle('project:openAny', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Ouvrir un projet ScratchCode', properties: ['openFile'],
    filters: [{ name: 'Projet ScratchCode (.scratchcode)', extensions: ['scratchcode'] }]
  });
  if (r.canceled || !r.filePaths[0]) return false;
  return openPathArg(r.filePaths[0]);
});
ipcMain.handle('project:read', (_e, dir) => readProject(dir));
ipcMain.handle('project:export', async (e, dir, name) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Exporter le projet', defaultPath: path.join(app.getPath('documents'), `${safeName(name)}.scratchcode`),
    filters: [{ name: 'Projet ScratchCode (.scratchcode)', extensions: ['scratchcode'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const entries = {};
  for (const rel of await walkFiles(dir)) {
    if (/\.sb3$/i.test(rel)) continue;
    entries[rel] = await fsp.readFile(path.join(dir, rel));
  }
  await fsp.writeFile(r.filePath, createZipBuffer(entries));
  return r.filePath;
});
ipcMain.handle('play:archive', (_e, dir, spec) => buildPlayArchive(dir, spec));
ipcMain.handle('assets:import', async (e, dir, folder) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Importer des assets', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Tous les assets', extensions: ['glb', 'gltf', 'bin', 'obj', 'mtl', 'fbx', 'stl', 'ply', 'dae', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp3', 'wav', 'ogg', 'm4a', 'sc'] },
      { name: 'Modèles 3D', extensions: ['glb', 'gltf', 'bin', 'obj', 'mtl', 'fbx', 'stl', 'ply', 'dae'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
      { name: 'Sons', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
    ]
  });
  if (r.canceled) return [];
  return copyAssets(dir, folder, r.filePaths);
});
ipcMain.handle('assets:importPaths', (_e, dir, folder, paths) => copyAssets(dir, folder, paths));
async function copyAssets(dir, folder, paths) {
  const out = [];
  for (const src of paths) {
    if (!fs.existsSync(src) || (await fsp.stat(src)).isDirectory()) continue;
    const ext = path.extname(src);
    const base = path.basename(src, ext);
    let rel = `${folder || 'assets'}/${base}${ext}`, i = 2;
    while (fs.existsSync(safeJoin(dir, rel))) rel = `${folder || 'assets'}/${base} ${i++}${ext}`;
    await fsp.mkdir(path.dirname(safeJoin(dir, rel)), { recursive: true });
    await fsp.copyFile(src, safeJoin(dir, rel));
    out.push(rel);
  }
  return out;
}
ipcMain.handle('file:read', (_e, dir, rel) => fsp.readFile(safeJoin(dir, rel), 'utf8'));
ipcMain.handle('file:write', async (_e, dir, rel, content) => {
  const full = safeJoin(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
  return true;
});
ipcMain.handle('file:writeBinary', async (_e, dir, rel, base64) => {
  const full = safeJoin(dir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, Buffer.from(base64, 'base64'));
  return full;
});
ipcMain.handle('file:mkdir', (_e, dir, rel) => fsp.mkdir(safeJoin(dir, rel), { recursive: true }));
ipcMain.handle('file:delete', (_e, dir, rel) => shell.trashItem(safeJoin(dir, rel)).catch(() => fsp.rm(safeJoin(dir, rel), { recursive: true, force: true })));
ipcMain.handle('file:rename', async (_e, dir, from, to) => {
  await fsp.mkdir(path.dirname(safeJoin(dir, to)), { recursive: true });
  return fsp.rename(safeJoin(dir, from), safeJoin(dir, to));
});
ipcMain.handle('shell:reveal', (_e, dir, rel) => rel ? shell.showItemInFolder(safeJoin(dir, rel)) : shell.openPath(dir));
ipcMain.handle('hub:show', () => createHub());

app.whenReady().then(async () => {
  registerProtocol();
  Menu.setApplicationMenu(null);
  const arg = process.argv.slice(1).find(a => /\.scratchcode$/i.test(a));
  if (!(arg && await openPathArg(arg).catch(() => false))) createHub();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createHub(); });
});
app.on('open-file', (e, p) => { e.preventDefault(); app.whenReady().then(() => openPathArg(p).catch(() => createHub())); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
