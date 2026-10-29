// ScratchCode Studio - processus principal Electron
// Les projets sont de vrais dossiers sur le disque :
//   MonJeu/
//     project.scratchcode   (configuration JSON)
//     stage.sc              (code de la scène)
//     sprites/*.sc          (un fichier par lutin)
//     SCRATCHCODE.md        (guide de syntaxe, utile aux assistants IA comme Antigravity)

const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const zlib = require('zlib');
const crypto = require('crypto');

function createZipBuffer(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
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

function buildInitialArchive(name, sources) {
  const stageSvg = '<svg version="1.1" width="480" height="360" viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="360" fill="#ffffff"/></svg>';
  const spriteSvg = '<svg version="1.1" width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><circle cx="48" cy="48" r="38" fill="#855cd6" stroke="#4c97ff" stroke-width="4"/><circle cx="35" cy="40" r="5" fill="#fff"/><circle cx="61" cy="40" r="5" fill="#fff"/><path d="M34 60 Q48 72 62 60" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';
  const stageMd5 = crypto.createHash('md5').update(stageSvg).digest('hex');
  const spriteMd5 = crypto.createHash('md5').update(spriteSvg).digest('hex');
  const spriteNames = Object.keys(sources).filter(k => k !== 'Stage' && k !== 'Scène' && k !== 'stage');
  const targets = [
    { isStage: true, name: 'Stage', variables: { var_score: ['score', 0] }, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: [{ name: 'backdrop1', dataFormat: 'svg', assetId: stageMd5, md5ext: `${stageMd5}.svg`, rotationCenterX: 240, rotationCenterY: 180 }], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null },
    ...spriteNames.map((spName, idx) => ({ isStage: false, name: spName, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: [{ name: 'costume1', dataFormat: 'svg', assetId: spriteMd5, md5ext: `${spriteMd5}.svg`, rotationCenterX: 48, rotationCenterY: 48 }], sounds: [], volume: 100, layerOrder: idx + 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' }))
  ];
  const meta = { format: 'scratchcode-studio', version: 1, name, title: name, sources, extensions: [], updated: new Date().toISOString() };
  const entries = {
    'project.json': JSON.stringify({ targets, monitors: [], extensions: [], meta: { semver: '3.0.0', vm: '0.2.0', agent: 'ScratchCode Studio 1.0' } }),
    [`${stageMd5}.svg`]: stageSvg,
    [`${spriteMd5}.svg`]: spriteSvg,
    'scratchcode.json': JSON.stringify(meta, null, 2),
    'project.scratchcode': JSON.stringify(meta, null, 2),
    'stage.sc': sources.Stage || ''
  };
  for (const spName of spriteNames) entries[`sprites/${spName}.sc`] = sources[spName] || '';
  return createZipBuffer(entries);
}

const ROOT = __dirname;
const ENGINE_DIR = path.join(ROOT, 'engine');
const UI_DIR = path.join(ROOT, 'renderer');
const MONACO_DIR = path.join(ROOT, 'node_modules', 'monaco-editor', 'min');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// Toutes les pages partagent la même origine (app://studio) pour que l'IDE puisse piloter le moteur Scratch.
function resolveAppPath(urlPath) {
  const p = decodeURIComponent(urlPath);
  if (p.startsWith('/studio/')) return path.join(UI_DIR, p.slice('/studio/'.length));
  if (p.startsWith('/monaco/')) return path.join(MONACO_DIR, p.slice('/monaco/'.length));
  return path.join(ENGINE_DIR, p === '/' ? 'index.html' : p.slice(1));
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let file = resolveAppPath(url.pathname);
    try {
      const stat = await fsp.stat(file).catch(() => null);
      if (stat && stat.isDirectory()) file = path.join(file, 'index.html');
      const data = await fsp.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
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
async function addRecent(dir, name) {
  let list = (await readRecent()).filter(p => p.path !== dir);
  list.unshift({ path: dir, name, openedAt: Date.now() });
  list = list.slice(0, 12);
  await fsp.mkdir(path.dirname(recentFile()), { recursive: true });
  await fsp.writeFile(recentFile(), JSON.stringify(list, null, 2));
}

// ---------- Modèles ----------
const TEMPLATES = {
  vide: {
    'stage.sc': 'when flag clicked\nset [score v] to (0)\n',
    'sprites/Chat.sc': 'when flag clicked\ngo to x: (0) y: (0)\nsay [Bonjour !] for (2) seconds\nforever\n    if <key (right arrow v) pressed?> then\n        change x by (10)\n    end\n    if <key (left arrow v) pressed?> then\n        change x by (-10)\n    end\nend\n'
  },
  plateforme: {
    'stage.sc': 'when flag clicked\nset [niveau v] to (1)\n',
    'sprites/Joueur.sc': 'when flag clicked\ngo to x: (-180) y: (0)\nset [vy v] to (0)\nforever\n    change [vy v] by (-1)\n    change y by (vy)\n    if <(y position) < (-120)> then\n        set y to (-120)\n        set [vy v] to (0)\n        if <key (up arrow v) pressed?> then\n            set [vy v] to (14)\n        end\n    end\n    if <key (right arrow v) pressed?> then\n        change x by (6)\n    end\n    if <key (left arrow v) pressed?> then\n        change x by (-6)\n    end\nend\n'
  },
  arcade: {
    'stage.sc': 'when flag clicked\nset [score v] to (0)\n',
    'sprites/Vaisseau.sc': 'when flag clicked\ngo to x: (0) y: (-130)\nforever\n    set x to (mouse x)\n    if <mouse down?> then\n        broadcast [tirer v]\n        wait (0.25) seconds\n    end\nend\n',
    'sprites/Laser.sc': 'when flag clicked\nhide\n\nwhen I receive [tirer v]\ncreate clone of (myself v)\n\nwhen I start as a clone\ngo to (Vaisseau v)\nset size to (30) %\nshow\nrepeat until <(y position) > (170)>\n    change y by (15)\nend\ndelete this clone\n'
  }
};

const GUIDE = `# Projet ScratchCode Studio

Ce dossier est un projet **ScratchCode Studio** (Scratch 3 écrit en texte).

## Structure
- \`project.scratchcode\` : configuration du projet (JSON)
- \`stage.sc\` : code de la scène (arrière-plan)
- \`sprites/<Nom>.sc\` : un fichier par lutin. Le nom du fichier = le nom du lutin.

Créer un fichier \`sprites/Ennemi.sc\` crée automatiquement le lutin "Ennemi".
ScratchCode Studio surveille ce dossier : toute modification faite par un autre outil
(éditeur, assistant IA comme Antigravity...) est rechargée automatiquement.

## Syntaxe (style scratchblocks)
- Un bloc par ligne. Un script commence par un bloc chapeau (\`when flag clicked\`). Scripts séparés par une ligne vide.
- Entrées : \`(10)\` nombre, \`[bonjour]\` texte, \`(mouse-pointer v)\` ou \`[score v]\` menu, \`<...>\` condition, \`(x position)\` reporter.
- Blocs C (\`forever\`, \`repeat\`, \`if\`, \`repeat until\`, \`if/else\`) : indenter de 4 espaces et fermer avec \`end\`.
- Variables créées automatiquement par \`set [nom v] to (..)\` ; lecture avec \`(nom)\`.
- Blocs personnalisés : \`define sauter (hauteur)\` puis \`sauter (10)\`. \`define!\` = sans rafraîchissement d'écran.
- Commentaires : \`// comme ceci\`

## Exemple
\`\`\`
when flag clicked
go to x: (0) y: (0)
forever
    if <key (right arrow v) pressed?> then
        change x by (5)
    end
end
\`\`\`
`;

async function createProject({ parentDir, name, template, exportFormat }) {
  const safe = String(name || 'MonProjet').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'MonProjet';
  const dir = path.join(parentDir, safe);
  if (fs.existsSync(dir) && (await fsp.readdir(dir)).length) throw new Error(`Le dossier "${dir}" existe déjà et n'est pas vide.`);
  await fsp.mkdir(path.join(dir, 'sprites'), { recursive: true });
  const files = TEMPLATES[template] || TEMPLATES.vide;
  const sources = {};
  for (const [rel, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, rel), content);
    if (rel === 'stage.sc') sources.Stage = content;
    else if (rel.startsWith('sprites/') && rel.endsWith('.sc')) sources[rel.slice(8, -3)] = content;
  }
  const config = {
    format: 'scratchcode-studio',
    version: 1,
    name: safe,
    title: safe,
    template: template || 'vide',
    exportFormat: 'sb3',
    sources,
    created: new Date().toISOString()
  };
  await fsp.writeFile(path.join(dir, 'project.scratchcode'), JSON.stringify(config, null, 2));
  await fsp.writeFile(path.join(dir, 'SCRATCHCODE.md'), GUIDE);
  const archive = buildInitialArchive(safe, sources);
  await fsp.writeFile(path.join(dir, `${safe}.sb3`), archive);
  return dir;
}

async function readProject(dir) {
  const cfgPath = path.join(dir, 'project.scratchcode');
  if (!fs.existsSync(cfgPath)) throw new Error('Ce dossier ne contient pas de fichier project.scratchcode.');
  const config = JSON.parse(await fsp.readFile(cfgPath, 'utf8'));
  return { dir, config, tree: await listTree(dir) };
}

async function listTree(dir, rel = '') {
  const out = [];
  const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push({ type: 'dir', path: r, name: e.name, children: await listTree(dir, r) });
    else out.push({ type: 'file', path: r, name: e.name });
  }
  return out;
}

function safeJoin(dir, rel) {
  const full = path.resolve(dir, rel);
  if (!full.startsWith(path.resolve(dir))) throw new Error('Chemin invalide');
  return full;
}

// ---------- Fenêtres ----------
let hubWin = null;
const watchers = new Map();

function createHub() {
  if (hubWin && !hubWin.isDestroyed()) { hubWin.focus(); return; }
  hubWin = new BrowserWindow({
    width: 920, height: 640, minWidth: 760, minHeight: 520, title: 'Bienvenue dans ScratchCode Studio',
    backgroundColor: '#1e1f22', icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  hubWin.loadURL('app://studio/studio/hub.html');
  hubWin.on('closed', () => { hubWin = null; });
}

async function openProjectWindow(dir) {
  const project = await readProject(dir);
  await addRecent(dir, project.config.name);
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640, title: `${project.config.name} - ScratchCode Studio`,
    backgroundColor: '#1e1f22', icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  win.loadURL('app://studio/studio/editor.html?dir=' + encodeURIComponent(dir));
  // Surveillance du dossier : les changements externes (Antigravity, autre éditeur) sont envoyés à l'IDE
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

// ---------- IPC ----------
ipcMain.handle('recent:list', async () => (await readRecent()).filter(p => fs.existsSync(path.join(p.path, 'project.scratchcode'))));
ipcMain.handle('dialog:pickFolder', async (e, title) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: title || 'Choisir un dossier', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app:defaultLocation', () => path.join(app.getPath('documents'), 'ScratchCode Projects'));
ipcMain.handle('project:create', async (_e, opts) => {
  await fsp.mkdir(opts.parentDir, { recursive: true });
  const dir = await createProject(opts);
  await openProjectWindow(dir);
  return dir;
});
ipcMain.handle('project:open', async (_e, dir) => { await openProjectWindow(dir); return true; });
ipcMain.handle('project:read', (_e, dir) => readProject(dir));
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
ipcMain.handle('project:exportSave', async (e, defaultName, ext, base64) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const filters = [{ name: 'Projet Scratch 3 / TurboWarp / ScratchCode (.sb3)', extensions: ['sb3'] }];
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter en .sb3 (Scratch / TurboWarp / ScratchCode)',
    defaultPath: `${defaultName || 'MonProjet'}.sb3`,
    filters
  });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, Buffer.from(base64, 'base64'));
  return r.filePath;
});
ipcMain.handle('file:delete', (_e, dir, rel) => fsp.rm(safeJoin(dir, rel), { recursive: true, force: true }));
ipcMain.handle('file:rename', (_e, dir, from, to) => fsp.rename(safeJoin(dir, from), safeJoin(dir, to)));
ipcMain.handle('shell:reveal', (_e, dir) => shell.openPath(dir));
ipcMain.handle('hub:show', () => createHub());

app.whenReady().then(() => {
  registerProtocol();
  Menu.setApplicationMenu(null);
  const arg = process.argv.find(a => a.endsWith('project.scratchcode'));
  if (arg && fs.existsSync(arg)) openProjectWindow(path.dirname(arg)).catch(() => createHub());
  else createHub();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createHub(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
