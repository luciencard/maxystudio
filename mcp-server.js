#!/usr/bin/env node
// Serveur MCP de MaxyStudio : connecte Claude Desktop, Codex (ChatGPT) ou Antigravity (Gemini) à tes projets.
// Lancé par l'assistant IA avec MaxyStudio.exe en mode Node (ELECTRON_RUN_AS_NODE=1), sur l'entrée/sortie standard.
// - Les fichiers du projet sont lus et écrits directement (MaxyStudio recharge tout seul ce qui change sur le disque).
// - Lancer le jeu, lire la console et faire une capture passent par MaxyStudio ouvert (pont local 127.0.0.1, jeton).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

const BRIDGE = process.env.MAXY_BRIDGE || '';
const CFG = 'project.maxycode';
const VERSION = (() => { try { return require('./package.json').version; } catch { return '2'; } })();
const TEXT_EXT = /\.(sc|js|json|scene|prefab|anim|md|txt|maxycode|ts|svg|css|html)$/i;
const JSON_EXT = /\.(json|scene|prefab|anim|maxycode)$/i;

// ---------- Pont vers MaxyStudio ouvert ----------
function bridgeInfo() {
  try { return JSON.parse(fs.readFileSync(BRIDGE, 'utf8')); } catch { return null; }
}
function bridge(method, params = {}, timeout = 20000) {
  const b = bridgeInfo();
  if (!b) return Promise.reject(new Error("MaxyStudio n'est pas ouvert. Ouvre MaxyStudio et un projet, puis réessaie."));
  const body = JSON.stringify({ token: b.token, method, params });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: b.port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { const r = JSON.parse(data); r.error ? reject(new Error(r.error)) : resolve(r.result); }
        catch { reject(new Error('Réponse illisible de MaxyStudio.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('MaxyStudio ne répond pas.')));
    req.on('error', () => reject(new Error("MaxyStudio n'est pas ouvert. Ouvre MaxyStudio et un projet, puis réessaie.")));
    req.end(body);
  });
}

// ---------- Projets ----------
function recentProjects() {
  const b = bridgeInfo();
  const file = b && b.recent;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
async function projectDir(given) {
  let dir = given;
  if (!dir) {
    try { const st = await bridge('status', {}, 4000); dir = st.active || (st.open && st.open[0]); } catch { /* MaxyStudio fermé */ }
  }
  if (!dir) throw new Error("Aucun projet indiqué et aucun projet ouvert dans MaxyStudio. Donne le chemin du projet (paramètre project) ou ouvre-le dans MaxyStudio.");
  dir = path.resolve(dir);
  if (!fs.existsSync(path.join(dir, CFG))) throw new Error(`Ce dossier n'est pas un projet MaxyStudio (pas de ${CFG}) : ${dir}`);
  return dir;
}
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
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// ---------- Outils ----------
const P = { project: { type: 'string', description: "Dossier du projet. Facultatif : par défaut, le projet ouvert dans MaxyStudio." } };
const TOOLS = [
  { name: 'maxystudio_status', description: "Projets ouverts dans MaxyStudio et projets récents. À appeler en premier.", inputSchema: { type: 'object', properties: {} } },
  { name: 'get_guide', description: "Guide de MaxyStudio : syntaxe MaxyCode (blocs Scratch en texte), API JavaScript (Maxy.Script), blocs 3D, interface, animation. À lire avant d'écrire un script.", inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['2d', '3d', 'app'], description: 'Type de projet (par défaut celui du projet ouvert).' } } } },
  { name: 'get_project', description: "Résumé du projet : nom, type (2d, 3d, app), scènes, objets de chaque scène avec leur script, fichiers.", inputSchema: { type: 'object', properties: { ...P } } },
  { name: 'read_file', description: "Lit un fichier texte du projet (script .sc MaxyCode ou .js JavaScript, scène .scene en JSON, prefab, clip .anim, guide).", inputSchema: { type: 'object', properties: { ...P, path: { type: 'string', description: 'Chemin relatif, par exemple scripts/Joueur.sc ou scenes/Main.scene' } }, required: ['path'] } },
  { name: 'write_file', description: "Crée ou remplace un fichier texte du projet. MaxyStudio recharge tout seul. Pour attacher un script à un objet, mets son chemin dans le champ \"script\" de l'objet dans la scène (.scene). Les fichiers JSON sont vérifiés avant d'être écrits.", inputSchema: { type: 'object', properties: { ...P, path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_files', description: "Liste les fichiers du projet (ou d'un dossier).", inputSchema: { type: 'object', properties: { ...P, folder: { type: 'string', description: 'Dossier relatif, par exemple scripts' } } } },
  { name: 'run_game', description: "Lance le jeu dans MaxyStudio (le projet doit y être ouvert), attend quelques secondes et renvoie la console (erreurs de compilation comprises).", inputSchema: { type: 'object', properties: { seconds: { type: 'number', description: 'Secondes à attendre avant de lire la console (2 par défaut, 10 au plus).' } } } },
  { name: 'stop_game', description: 'Arrête le jeu dans MaxyStudio.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_console', description: 'Dernières lignes de la console de MaxyStudio (messages, avertissements, erreurs avec fichier et ligne).', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '50 par défaut' } } } },
  { name: 'screenshot', description: "Capture d'écran de la vue Jeu (ou Scène si le jeu est arrêté) de MaxyStudio, pour voir le résultat.", inputSchema: { type: 'object', properties: {} } }
];

const text = t => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
async function callTool(name, a = {}) {
  switch (name) {
    case 'maxystudio_status': {
      let open = null;
      try { open = await bridge('status', {}, 4000); } catch (e) { open = { error: e.message }; }
      return text({ maxystudio: open, recent: recentProjects().slice(0, 15) });
    }
    case 'get_guide': {
      let type = a.type;
      if (!type) { try { type = readJson(path.join(await projectDir(), CFG)).type; } catch { type = '2d'; } }
      const T = require('./templates.js');
      return text(T.guide(type === '3d' || type === 'app' ? type : '2d'));
    }
    case 'get_project': {
      const dir = await projectDir(a.project);
      const cfg = readJson(path.join(dir, CFG));
      const files = listFiles(dir);
      const scenes = files.filter(f => f.endsWith('.scene')).map(rel => {
        try {
          const sc = readJson(path.join(dir, rel));
          return { path: rel, start: rel === (cfg.mainScene || 'scenes/Main.scene'), stageScript: sc.worldScript || (sc.stage && sc.stage.script) || '', objects: (sc.objects || []).map(o => ({ name: o.name, kind: o.kind, script: o.script || '' })), ui: (sc.ui || []).map(e => ({ name: e.name, type: e.type })) };
        } catch (e) { return { path: rel, error: e.message }; }
      });
      return text({ dir, name: cfg.name, type: cfg.type, scenes, files });
    }
    case 'list_files': {
      const dir = await projectDir(a.project);
      const all = listFiles(dir);
      const f = String(a.folder || '').replace(/^\/+|\/+$/g, '');
      return text(f ? all.filter(x => x.startsWith(f + '/')) : all);
    }
    case 'read_file': {
      const dir = await projectDir(a.project);
      const full = safe(dir, a.path);
      if (!TEXT_EXT.test(full)) throw new Error('Seuls les fichiers texte se lisent ici (scripts, scènes, JSON…).');
      return text(fs.readFileSync(full, 'utf8'));
    }
    case 'write_file': {
      const dir = await projectDir(a.project);
      const rel = String(a.path || '');
      if (!TEXT_EXT.test(rel)) throw new Error('Seuls les fichiers texte s\'écrivent ici (.sc, .js, .scene, .json…).');
      const content = String(a.content ?? '');
      if (JSON_EXT.test(rel)) { try { JSON.parse(content); } catch (e) { throw new Error(`JSON invalide, rien n'a été écrit : ${e.message}`); } }
      const full = safe(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      return text(`Écrit : ${rel} (${Buffer.byteLength(content)} octets). MaxyStudio l'a rechargé.`);
    }
    case 'run_game': {
      const r = await bridge('play', { seconds: Math.max(0.5, Math.min(10, +a.seconds || 2)) }, 30000);
      return text(r);
    }
    case 'stop_game': return text(await bridge('stop'));
    case 'get_console': return text(await bridge('console', { limit: Math.max(1, Math.min(300, +a.limit || 50)) }));
    case 'screenshot': {
      const r = await bridge('screenshot', {}, 15000);
      return { content: [{ type: 'image', data: r.png, mimeType: 'image/png' }, { type: 'text', text: r.view }] };
    }
    default: throw new Error(`Outil inconnu : ${name}`);
  }
}

// ---------- Protocole MCP (JSON-RPC 2.0, une ligne par message) ----------
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'maxystudio', version: VERSION },
        instructions: "MaxyStudio est un moteur de jeu 2D/3D. Commence par maxystudio_status et get_guide. Les scripts sont en MaxyCode (.sc) ou JavaScript (.js). Après une modification, utilise run_game pour vérifier la console, et screenshot pour voir le jeu."
      } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try { return send({ jsonrpc: '2.0', id, result: await callTool(params.name, params.arguments || {}) }); }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message || String(e) }] } }); }
    }
    if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Méthode inconnue : ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message || String(e) } });
  }
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }); }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
rl.on('close', () => process.exit(0));
