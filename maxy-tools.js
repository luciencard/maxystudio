// Outils de MaxyStudio pour les assistants IA : utilisés par le serveur MCP (mcp-server.js)
// et par Maxy AI, l'assistant intégré (maxy-ai.js). Aucune dépendance externe.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CFG = 'project.maxycode';
const TEXT_EXT = /\.(mc|sc|js|json|scene|prefab|anim|md|txt|maxycode|ts|svg|css|html)$/i;
const JSON_EXT = /\.(json|scene|prefab|anim|maxycode)$/i;
const SHAPES = ['cube', 'sphere', 'cylinder', 'cone', 'capsule', 'plane', 'torus'];
const KINDS_3D = [...SHAPES, 'empty', 'light', 'camera', 'model', 'terrain', 'particles'];
const PARTICLES = ['feu', 'fumee', 'etincelles', 'pluie', 'neige', 'explosion', 'magie', 'poussiere'];

// ---------- Fichiers du projet ----------
/** Chemin d'un fichier du projet ; refuse tout ce qui sort du dossier (.., chemins absolus, liens). */
function safe(dir, rel) {
  const root = fs.realpathSync(dir);
  const inside = p => p === root || p.startsWith(root + path.sep);
  const full = path.resolve(root, String(rel || '').replace(/^[/\\]+/, ''));
  if (!inside(full) || full === root) throw new Error('Chemin en dehors du projet refusé.');
  let p = full;
  while (!fs.existsSync(p)) p = path.dirname(p);
  if (!inside(fs.realpathSync(p))) throw new Error('Chemin en dehors du projet refusé.');
  return full;
}
function listFiles(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel)); else out.push(rel);
  }
  return out;
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const newId = () => Math.random().toString(36).slice(2, 10);
function projectInfo(dir) {
  const cfg = readJson(path.join(dir, CFG));
  return { cfg, type: cfg.type === '3d' || cfg.type === 'app' ? cfg.type : '2d', main: cfg.mainScene || 'scenes/Main.scene' };
}
function scenePath(dir, scene) {
  if (!scene) return projectInfo(dir).main;
  const s = String(scene);
  if (s.endsWith('.scene')) return s;
  return `scenes/${s}.scene`;
}
function loadScene(dir, scene) {
  const rel = scenePath(dir, scene);
  const full = safe(dir, rel);
  if (!fs.existsSync(full)) throw new Error(`Scène introuvable : ${rel}`);
  return { rel, full, data: readJson(full) };
}
function saveScene(s) { fs.writeFileSync(s.full, JSON.stringify(s.data, null, 2)); }
function findObject(sc, name) {
  const list = sc.data.objects || [];
  const o = list.find(x => x.name === name) || list.find(x => x.name.toLowerCase() === String(name).toLowerCase());
  if (!o) throw new Error(`Objet « ${name} » introuvable dans ${sc.rel}. Objets : ${list.map(x => x.name).join(', ') || 'aucun'}.`);
  return o;
}
function uniqueName(sc, name) {
  const used = new Set((sc.data.objects || []).map(o => o.name.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}
/** Fusion profonde (les tableaux sont remplacés). */
function merge(into, from) {
  for (const [k, v] of Object.entries(from || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) merge(into[k], v);
    else into[k] = v;
  }
  return into;
}
function object3D(kind, name) {
  const o = { id: newId(), name, kind, parent: null, active: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], script: '', collider: !['light', 'camera', 'empty', 'particles'].includes(kind), rigidbody: { enabled: false, gravity: 1, bounce: 0 } };
  if (SHAPES.includes(kind)) o.mesh = { color: '#c9ccd4', texture: '', opacity: 1, metalness: 0, roughness: 0.75, castShadow: true, receiveShadow: true };
  if (kind === 'model') o.model = '';
  if (kind === 'light') o.light = { type: 'point', color: '#ffffff', intensity: 2, range: 12 };
  if (kind === 'camera') o.camera = { fov: 60, main: false };
  if (kind === 'plane') o.scale = [10, 1, 10];
  if (kind === 'terrain') o.terrain = { preset: 'collines', seed: 1, size: 60, res: 96, height: 8, colors: { sand: '#d9c58f', grass: '#5b9a3e', rock: '#857e72', snow: '#f2f4f7' }, levels: { sand: 0.4, snow: 12 }, data: '' };
  if (kind === 'particles') o.particles = { preset: 'feu' };
  return o;
}
async function ensureJsTypes(dir, rootDir) {
  // Le fichier est un module ES du rendu : on l'évalue comme texte (marche aussi depuis l'archive app.asar)
  const src = fs.readFileSync(path.join(rootDir, 'renderer', 'maxyjs-types.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ');
  const types = new Function(`${src}
return { MAXY_DTS, JSCONFIG, jsTemplate };`)();
  const dts = path.join(dir, 'types', 'maxy.d.ts');
  fs.mkdirSync(path.dirname(dts), { recursive: true });
  if (!fs.existsSync(dts) || fs.readFileSync(dts, 'utf8') !== types.MAXY_DTS) fs.writeFileSync(dts, types.MAXY_DTS);
  const jc = path.join(dir, 'jsconfig.json');
  if (!fs.existsSync(jc)) fs.writeFileSync(jc, types.JSCONFIG);
  return types;
}

// ---------- Bibliothèque d'assets (Kenney, CC0) ----------
let libCache = null;
function libIndex(libDir) {
  if (!libCache) libCache = readJson(path.join(libDir, 'library.json'));
  return libCache;
}
/** Copie un élément de la bibliothèque dans le projet (assets/bibliotheque/...), avec ses textures. */
async function importLibraryFile(libDir, dir, file) {
  const src = path.resolve(libDir, file);
  if (!src.startsWith(path.resolve(libDir) + path.sep) || !fs.existsSync(src) || !/^(modeles|sons|images)\//.test(file)) throw new Error('Élément introuvable dans la bibliothèque.');
  const rel = 'assets/bibliotheque/' + file;
  const copy = async (from, to) => {
    const dest = safe(dir, to);
    if (fs.existsSync(dest)) return;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(from, dest);
  };
  await copy(src, rel);
  if (file.startsWith('modeles/')) {
    const packDir = path.dirname(src), relDir = path.posix.dirname(rel);
    const tex = path.join(packDir, 'Textures');
    if (fs.existsSync(tex)) for (const t of await fsp.readdir(tex)) await copy(path.join(tex, t), `${relDir}/Textures/${t}`);
    if (/\.gltf$/i.test(file)) {
      const gltf = JSON.parse(await fsp.readFile(src, 'utf8'));
      for (const b of [...(gltf.buffers || []), ...(gltf.images || [])]) {
        if (b.uri && !/^data:/.test(b.uri) && !b.uri.includes('..')) { const from = path.join(packDir, decodeURIComponent(b.uri)); if (fs.existsSync(from)) await copy(from, `${relDir}/${decodeURIComponent(b.uri)}`); }
      }
    }
    for (const t of await fsp.readdir(packDir)) if (/\.(png|jpg)$/i.test(t)) await copy(path.join(packDir, t), `${relDir}/${t}`);
  }
  return rel;
}

// ---------- Définition des outils ----------
const P = { project: { type: 'string', description: 'Dossier du projet. Facultatif : par défaut, le projet ouvert dans MaxyStudio.' } };
const SC = { scene: { type: 'string', description: 'Scène (nom comme "Main" ou chemin scenes/Main.scene). Par défaut : la scène de départ.' } };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOLS = [
  { name: 'maxystudio_status', description: 'Projets ouverts dans MaxyStudio et projets récents. À appeler en premier.', schema: obj({}) },
  { name: 'get_guide', description: "Guide complet de MaxyStudio : syntaxe MaxyCode (blocs Scratch en texte), API JavaScript (classe Maxy.Script), blocs 3D, interface, animation, scènes. À lire avant d'écrire un script.", schema: obj({ type: { type: 'string', enum: ['2d', '3d', 'app'], description: 'Type de projet (par défaut celui du projet).' } }) },
  { name: 'get_project', description: 'Résumé du projet : nom, type (2d, 3d, app), scènes avec leurs objets (nom, type, script), interface, fichiers.', schema: obj({ ...P }) },
  { name: 'list_files', description: "Liste les fichiers du projet (ou d'un dossier).", schema: obj({ ...P, folder: { type: 'string', description: 'Dossier relatif, par exemple scripts' } }) },
  { name: 'read_file', description: 'Lit un fichier texte du projet : script .mc (MaxyCode) ou .js (JavaScript), scène .scene (JSON), prefab, clip .anim.', schema: obj({ ...P, path: { type: 'string', description: 'Chemin relatif, par exemple scripts/Joueur.mc' } }, ['path']) },
  { name: 'write_file', description: 'Crée ou remplace un fichier texte du projet (MaxyStudio recharge tout seul). Les fichiers JSON (.scene, .json, .anim, .prefab) sont vérifiés avant écriture. Pour un script, préfère create_script ; pour les objets, add_object et update_object.', schema: obj({ ...P, path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']), eager: true },
  { name: 'create_script', description: "Crée un script et l'attache à un objet (ou à la Scène). Langage maxycode (fichier .mc, blocs en texte) ou javascript (fichier .js : export default class extends Maxy.Script { start() {} update(dt) {} }).", schema: obj({ ...P, ...SC, name: { type: 'string', description: 'Nom du script, par exemple Joueur' }, language: { type: 'string', enum: ['maxycode', 'javascript'] }, code: { type: 'string', description: 'Contenu du script (facultatif : un modèle est écrit sinon).' }, attach_to: { type: 'string', description: "Nom de l'objet qui exécute le script, ou \"stage\" pour la Scène. Facultatif." } }, ['name', 'language']), eager: true },
  { name: 'add_object', description: `Ajoute un objet à une scène. 2D : kind "sprite" (x, y en pixels, scène de 480 x 360 centrée en 0,0). 3D : kind parmi ${KINDS_3D.join(', ')} (position [x, y, z]). Pour un modèle 3D, donne model (chemin d'un .glb du projet, voir import_library_asset). Pour des particules, preset parmi ${PARTICLES.join(', ')}.`, schema: obj({ ...P, ...SC, kind: { type: 'string' }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, position: { type: 'array', items: { type: 'number' }, description: '3D : [x, y, z]' }, costume: { type: 'string', description: "2D : image du projet (sinon le lutin par défaut)" }, model: { type: 'string' }, preset: { type: 'string' }, color: { type: 'string', description: '3D : couleur #rrggbb' }, physics: { type: 'boolean', description: '3D : active la physique (gravité, collisions)' } }, ['kind', 'name']) },
  { name: 'update_object', description: "Modifie un objet d'une scène : les champs donnés sont fusionnés (par exemple {\"position\": [0, 2, 0]}, {\"mesh\": {\"color\": \"#ff0000\"}}, {\"x\": 100, \"size\": 50}, {\"rigidbody\": {\"enabled\": true}}). Lis d'abord la scène pour connaître les champs.", schema: obj({ ...P, ...SC, name: { type: 'string' }, changes: { type: 'object', description: 'Champs à modifier' } }, ['name', 'changes']) },
  { name: 'remove_object', description: "Supprime un objet d'une scène (et ses enfants en 3D).", schema: obj({ ...P, ...SC, name: { type: 'string' } }, ['name']) },
  { name: 'create_scene', description: 'Crée une nouvelle scène (un niveau). En jeu, le bloc go to scene [Nom] (MaxyCode) ou Maxy.goToScene("Nom") (JavaScript) y mène.', schema: obj({ ...P, name: { type: 'string' } }, ['name']) },
  { name: 'search_library', description: "Cherche dans la bibliothèque d'assets gratuits incluse (Kenney, CC0) : modèles 3D, sons, images. Renvoie les fichiers à passer à import_library_asset.", schema: obj({ query: { type: 'string', description: 'Mots en anglais ou en français (car, tree, coin…)' }, type: { type: 'string', enum: ['modele', 'son', 'image'] }, limit: { type: 'number' } }, ['query']) },
  { name: 'import_library_asset', description: 'Copie un asset de la bibliothèque dans le projet (avec ses textures) et renvoie son chemin, à utiliser dans add_object (model ou costume) ou un script.', schema: obj({ ...P, file: { type: 'string', description: 'Champ file renvoyé par search_library' } }, ['file']) },
  { name: 'run_game', description: 'Lance le jeu dans MaxyStudio (le projet doit y être ouvert), attend quelques secondes et renvoie la console (erreurs de compilation comprises, avec fichier et ligne).', schema: obj({ seconds: { type: 'number', description: '2 par défaut, 10 au plus' } }) },
  { name: 'stop_game', description: 'Arrête le jeu dans MaxyStudio.', schema: obj({}) },
  { name: 'get_console', description: 'Dernières lignes de la console de MaxyStudio.', schema: obj({ limit: { type: 'number', description: '50 par défaut' } }) },
  { name: 'screenshot', description: "Capture d'écran de la vue Jeu (ou Scène si le jeu est arrêté) pour voir le résultat.", schema: obj({}) }
];

/**
 * Exécute un outil. ctx : { rootDir, libDir, project(given) -> dossier, bridge(method, params) -> résultat, status() }.
 * Renvoie { text } ou { image: { data, mimeType }, text }.
 */
async function callTool(ctx, name, a = {}) {
  const J = v => ({ text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) });
  switch (name) {
    case 'maxystudio_status': return J(await ctx.status());
    case 'get_guide': {
      let type = a.type;
      if (!type) { try { type = projectInfo(await ctx.project()).type; } catch { type = '2d'; } }
      return J(require(path.join(ctx.rootDir, 'templates.js')).guide(type));
    }
    case 'get_project': {
      const dir = await ctx.project(a.project);
      const { cfg, type, main } = projectInfo(dir);
      const files = listFiles(dir);
      const scenes = files.filter(f => f.endsWith('.scene')).map(rel => {
        try {
          const sc = readJson(path.join(dir, rel));
          return { path: rel, start: rel === main, stageScript: sc.worldScript || (sc.stage && sc.stage.script) || '', objects: (sc.objects || []).map(o => ({ name: o.name, kind: o.kind, script: o.script || '', ...(o.parent ? { parent: (sc.objects.find(p => p.id === o.parent) || {}).name } : {}) })), ui: (sc.ui || []).map(e => ({ name: e.name, type: e.type })) };
        } catch (e) { return { path: rel, error: e.message }; }
      });
      return J({ dir, name: cfg.name, type, scenes, files });
    }
    case 'list_files': {
      const dir = await ctx.project(a.project);
      const all = listFiles(dir);
      const f = String(a.folder || '').replace(/^\/+|\/+$/g, '');
      return J(f ? all.filter(x => x.startsWith(f + '/')) : all);
    }
    case 'read_file': {
      const dir = await ctx.project(a.project);
      const full = safe(dir, a.path);
      if (!TEXT_EXT.test(full)) throw new Error('Seuls les fichiers texte se lisent ici (scripts, scènes, JSON…).');
      if (!fs.existsSync(full)) throw new Error(`Fichier introuvable : ${a.path}`);
      return J(fs.readFileSync(full, 'utf8'));
    }
    case 'write_file': {
      const dir = await ctx.project(a.project);
      const rel = String(a.path || '');
      if (!TEXT_EXT.test(rel)) throw new Error("Seuls les fichiers texte s'écrivent ici (.mc, .js, .scene, .json…).");
      const content = String(a.content ?? '');
      if (JSON_EXT.test(rel)) { try { JSON.parse(content); } catch (e) { throw new Error(`JSON invalide, rien n'a été écrit : ${e.message}`); } }
      const full = safe(dir, rel);
      if (ctx.before) ctx.before(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      return J(`Écrit : ${rel} (${Buffer.byteLength(content)} octets). MaxyStudio l'a rechargé.`);
    }
    case 'create_script': {
      const dir = await ctx.project(a.project);
      const { type } = projectInfo(dir);
      const js = a.language === 'javascript';
      const base = String(a.name || 'Script').replace(/[<>:"/\\|?*]/g, '').replace(/\.(sc|js)$/i, '').trim() || 'Script';
      const rel = `scripts/${base}.${js ? 'js' : 'sc'}`;
      let code = a.code;
      if (js) { const t = await ensureJsTypes(dir, ctx.rootDir); if (!code) code = t.jsTemplate(type, base); }
      else if (!code) code = 'when app run\n';
      const full = safe(dir, rel);
      if (ctx.before) ctx.before(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, code, 'utf8');
      let attached = '';
      if (a.attach_to) {
        const sc = loadScene(dir, a.scene);
        if (ctx.before) ctx.before(dir, sc.rel);
        if (/^(stage|scène|scene|world|monde)$/i.test(a.attach_to)) {
          if (type === '3d') sc.data.worldScript = rel; else { sc.data.stage = sc.data.stage || { backdrops: [], script: '' }; sc.data.stage.script = rel; }
          attached = ' Attaché à la Scène.';
        } else { findObject(sc, a.attach_to).script = rel; attached = ` Attaché à « ${a.attach_to} » dans ${sc.rel}.`; }
        saveScene(sc);
      }
      return J(`Script créé : ${rel}.${attached}`);
    }
    case 'add_object': {
      const dir = await ctx.project(a.project);
      const { type } = projectInfo(dir);
      const sc = loadScene(dir, a.scene);
      if (ctx.before) ctx.before(dir, sc.rel);
      sc.data.objects = sc.data.objects || [];
      const name = uniqueName(sc, String(a.name || a.kind));
      let o;
      if (type === '3d') {
        const kind = String(a.kind || 'cube').toLowerCase();
        if (!KINDS_3D.includes(kind)) throw new Error(`Type d'objet 3D inconnu : ${kind}. Types : ${KINDS_3D.join(', ')}.`);
        o = object3D(kind, name);
        if (Array.isArray(a.position) && a.position.length === 3) o.position = a.position.map(Number);
        if (a.model) o.model = String(a.model);
        if (a.color && o.mesh) o.mesh.color = String(a.color);
        if (kind === 'particles' && a.preset) o.particles = { preset: PARTICLES.includes(a.preset) ? a.preset : 'feu' };
        if (a.physics) { o.rigidbody.enabled = true; o.collider = true; }
        if (kind === 'camera' && !sc.data.objects.some(x => x.kind === 'camera')) o.camera.main = true;
      } else {
        let costume = a.costume;
        if (!costume) {
          costume = 'assets/Lutin.svg';
          const full = safe(dir, costume);
          if (!fs.existsSync(full)) { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, require(path.join(ctx.rootDir, 'templates.js')).SVG.lutin); }
        }
        o = { id: newId(), name, kind: 'sprite', x: +a.x || 0, y: +a.y || 0, size: 100, direction: 90, visible: true, rotationStyle: 'all around', draggable: false, costumes: [costume], sounds: [], script: '' };
      }
      sc.data.objects.push(o);
      saveScene(sc);
      return J(`Objet « ${name} » ajouté à ${sc.rel} : ${JSON.stringify(o)}`);
    }
    case 'update_object': {
      const dir = await ctx.project(a.project);
      const sc = loadScene(dir, a.scene);
      const o = findObject(sc, a.name);
      if (!a.changes || typeof a.changes !== 'object') throw new Error('changes doit être un objet JSON.');
      const { id, ...changes } = a.changes;
      if (ctx.before) ctx.before(dir, sc.rel);
      merge(o, changes);
      saveScene(sc);
      return J(`Objet « ${o.name} » modifié : ${JSON.stringify(o)}`);
    }
    case 'remove_object': {
      const dir = await ctx.project(a.project);
      const sc = loadScene(dir, a.scene);
      const o = findObject(sc, a.name);
      const gone = new Set([o.id]);
      let grew = true;
      while (grew) { grew = false; for (const x of sc.data.objects) if (x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
      if (ctx.before) ctx.before(dir, sc.rel);
      sc.data.objects = sc.data.objects.filter(x => !gone.has(x.id));
      saveScene(sc);
      return J(`Supprimé : ${gone.size} objet${gone.size > 1 ? 's' : ''}.`);
    }
    case 'create_scene': {
      const dir = await ctx.project(a.project);
      const { type, main } = projectInfo(dir);
      const base = String(a.name || 'Niveau').replace(/[<>:"/\\|?*]/g, '').trim() || 'Niveau';
      const rel = `scenes/${base}.scene`;
      const full = safe(dir, rel);
      if (fs.existsSync(full)) throw new Error(`La scène ${rel} existe déjà.`);
      let data;
      try {
        const m = readJson(path.join(dir, main));
        data = type === '3d'
          ? { environment: m.environment, worldScript: '', objects: (m.objects || []).filter(o => o.kind === 'camera' || o.kind === 'light').map(o => ({ ...o, id: newId(), script: '' })), ui: [] }
          : { stage: { backdrops: (m.stage && m.stage.backdrops) || [], script: '' }, objects: [], ui: [] };
      } catch { data = type === '3d' ? { objects: [], ui: [] } : { stage: { backdrops: [], script: '' }, objects: [], ui: [] }; }
      if (ctx.before) ctx.before(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(data, null, 2));
      return J(`Scène créée : ${rel}`);
    }
    case 'search_library': {
      const idx = libIndex(ctx.libDir);
      const words = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const max = Math.max(1, Math.min(60, +a.limit || 20));
      const hits = idx.items.filter(it => (!a.type || it.type === a.type) && words.every(w => `${it.name} ${it.pack} ${it.packName} ${it.file}`.toLowerCase().includes(w))).slice(0, max);
      return J({ count: hits.length, items: hits.map(it => ({ name: it.name, type: it.type, pack: it.packName, file: it.file })), licence: idx.source });
    }
    case 'import_library_asset': {
      const dir = await ctx.project(a.project);
      const rel = await importLibraryFile(ctx.libDir, dir, String(a.file || ''));
      return J(`Importé : ${rel}`);
    }
    case 'run_game': return J(await ctx.bridge('play', { seconds: Math.max(0.5, Math.min(10, +a.seconds || 2)) }));
    case 'stop_game': return J(await ctx.bridge('stop', {}));
    case 'get_console': return J(await ctx.bridge('console', { limit: Math.max(1, Math.min(300, +a.limit || 50)) }));
    case 'screenshot': { const r = await ctx.bridge('screenshot', {}); return { image: { data: r.png, mimeType: 'image/png' }, text: r.view }; }
    default: throw new Error(`Outil inconnu : ${name}`);
  }
}

module.exports = { TOOLS, callTool, importLibraryFile, safe, CFG };
