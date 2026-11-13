#!/usr/bin/env node
// Serveur MCP de MaxyStudio : connecte Claude Code (application ou CLI), Antigravity ou Gemini CLI à tes projets.
// Lancé par l'assistant avec MaxyStudio.exe en mode Node (ELECTRON_RUN_AS_NODE=1), sur l'entrée/sortie standard.
// - Les fichiers du projet sont lus et écrits directement (MaxyStudio recharge tout seul ce qui change sur le disque).
// - Lancer le jeu, lire la console et faire une capture passent par MaxyStudio ouvert (pont local 127.0.0.1, jeton).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { TOOLS, callTool, CFG } = require('./maxy-tools.js');

const BRIDGE = process.env.MAXY_BRIDGE || '';
const VERSION = (() => { try { return require('./package.json').version; } catch { return '2'; } })();
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

// ---------- Pont vers MaxyStudio ouvert ----------
function bridgeInfo() { try { return JSON.parse(fs.readFileSync(BRIDGE, 'utf8')); } catch { return null; } }
function bridge(method, params = {}, timeout = 30000) {
  const b = bridgeInfo();
  const closed = "MaxyStudio n'est pas ouvert. Ouvre MaxyStudio et un projet, puis réessaie.";
  if (!b) return Promise.reject(new Error(closed));
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
    req.on('error', () => reject(new Error(closed)));
    req.end(body);
  });
}
function recentProjects() {
  const b = bridgeInfo();
  try { return JSON.parse(fs.readFileSync(b && b.recent, 'utf8')); } catch { return []; }
}
const ctx = {
  rootDir: __dirname,
  libDir: path.join(__dirname, 'library'),
  bridge,
  async status() {
    let open;
    try { open = await bridge('status', {}, 4000); } catch (e) { open = { error: e.message }; }
    return { maxystudio: open, recent: recentProjects().slice(0, 15) };
  },
  async project(given) {
    let dir = given;
    if (!dir) { try { const st = await bridge('status', {}, 4000); dir = st.active || (st.open && st.open[0]); } catch { /* MaxyStudio fermé */ } }
    if (!dir) throw new Error("Aucun projet indiqué et aucun projet ouvert dans MaxyStudio. Donne le chemin du projet (paramètre project) ou ouvre-le dans MaxyStudio.");
    dir = path.resolve(dir);
    if (!fs.existsSync(path.join(dir, CFG))) throw new Error(`Ce dossier n'est pas un projet MaxyStudio (pas de ${CFG}) : ${dir}`);
    return dir;
  }
};

// ---------- Protocole MCP (JSON-RPC 2.0, une ligne par message) ----------
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return; // notification (initialized, cancelled…)
  try {
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        return ok(id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'maxystudio', title: 'MaxyStudio', version: VERSION },
          instructions: "MaxyStudio est un moteur de jeu 2D/3D (Windows, macOS, Linux). Commence par maxystudio_status puis get_guide. Les scripts sont en MaxyCode (.mc, blocs Scratch en texte) ou en JavaScript (.js, classe Maxy.Script). Utilise create_script, add_object et update_object plutôt que d'éditer les scènes à la main. Après une modification, lance run_game pour lire la console, puis screenshot pour voir le jeu."
        });
      }
      case 'ping': return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.schema })) });
      case 'tools/call': {
        try {
          const r = await callTool(ctx, params.name, params.arguments || {});
          const content = [];
          if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType });
          if (r.text) content.push({ type: 'text', text: r.text });
          return ok(id, { content });
        } catch (e) {
          return ok(id, { isError: true, content: [{ type: 'text', text: e.message || String(e) }] });
        }
      }
      case 'resources/list': return ok(id, { resources: [] });
      case 'resources/templates/list': return ok(id, { resourceTemplates: [] });
      case 'prompts/list': return ok(id, { prompts: [] });
      default: return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Méthode inconnue : ${method}` } });
    }
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
