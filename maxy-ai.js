// Maxy AI : l'assistant intégré à MaxyStudio (processus principal).
// Il parle à Claude (API Anthropic, clé de l'utilisateur chiffrée sur son ordinateur) et agit sur le projet
// ouvert avec les mêmes outils que le serveur MCP (maxy-tools.js). La page ne voit jamais la clé.
'use strict';
const fs = require('fs');
const path = require('path');
const sdk = require('@anthropic-ai/sdk');
const Anthropic = sdk.default || sdk;
const { TOOLS, callTool, CFG } = require('./maxy-tools.js');

const MODELS = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5' };
const EFFORTS = ['low', 'medium', 'high'];
// Repli côté serveur si le modèle refuse une demande (pas disponible sur Haiku 5.5)
const WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
// Tests automatiques uniquement : serveur d'API local à la place d'api.anthropic.com
const clientFor = apiKey => new Anthropic({ apiKey, ...(process.env.MAXY_AI_TEST_BASE_URL ? { baseURL: process.env.MAXY_AI_TEST_BASE_URL } : {}) });

const INSTRUCTIONS = `Tu es Maxy AI, l'assistant intégré à MaxyStudio, un moteur de jeu 2D et 3D.
Tu parles français et tu tutoies. Tu aides à créer des jeux : écrire des scripts, ajouter des objets, régler des scènes, trouver des erreurs.

Comment travailler :
- Tu agis directement sur le projet ouvert avec tes outils ; MaxyStudio affiche les changements en direct.
- Avant de modifier, regarde l'état du projet (get_project, read_file) si tu ne le connais pas encore.
- Les scripts s'écrivent en MaxyCode (.sc, blocs Scratch en texte) ou en JavaScript (.js, classe qui étend Maxy.Script). Garde le langage déjà utilisé par le projet ; pour un nouveau script, MaxyCode pour les débutants et les choses simples, JavaScript quand il faut de la vitesse ou de la logique complexe.
- Utilise create_script, add_object et update_object plutôt que de réécrire une scène entière.
- Après une modification de script, lance run_game et lis la console : corrige les erreurs avant de répondre. Fais une capture (screenshot) quand le résultat visuel compte.
- Pour un modèle 3D, un son ou une image, cherche d'abord dans la bibliothèque incluse (search_library puis import_library_asset).
- Réponds court : ce que tu as fait, et ce que l'utilisateur peut essayer. Pas d'emoji. N'invente pas de blocs ni de fonctions : la syntaxe exacte est dans le guide ci-dessous.`;

module.exports = function setupMaxyAi({ app, ipcMain, safeStorage, BrowserWindow, projectWins, bridgeCall, rootDir, libDir, recentFile }) {
  const file = () => path.join(app.getPath('userData'), 'maxy-ai.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
  const write = s => fs.writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });
  function apiKey() {
    const s = read();
    if (!s.key) return null;
    try { return safeStorage.decryptString(Buffer.from(s.key, 'base64')); } catch { return null; }
  }
  const settings = () => { const s = read(); return { hasKey: !!s.key, model: MODELS[s.model] ? s.model : 'claude-opus-5-5', effort: EFFORTS.includes(s.effort) ? s.effort : 'medium', models: MODELS, canEncrypt: safeStorage.isEncryptionAvailable() }; };

  ipcMain.handle('maxyai:settings', () => settings());
  ipcMain.handle('maxyai:setOptions', (_e, o = {}) => {
    const s = read();
    if (MODELS[o.model]) s.model = o.model;
    if (EFFORTS.includes(o.effort)) s.effort = o.effort;
    write(s);
    return settings();
  });
  ipcMain.handle('maxyai:setKey', async (_e, key) => {
    key = String(key || '').trim();
    if (!key) { const s = read(); delete s.key; write(s); return settings(); }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Le chiffrement n'est pas disponible sur cet ordinateur : la clé ne peut pas être enregistrée en sécurité.");
    // Vérifie la clé avant de l'enregistrer
    try { await clientFor(key).models.list({ limit: 1 }); }
    catch (e) { throw new Error(describe(e)); }
    const s = read();
    s.key = safeStorage.encryptString(key).toString('base64');
    write(s);
    return settings();
  });

  // Conversations : une par fenêtre de projet
  const convs = new Map();
  const conv = win => { if (!convs.has(win.id)) convs.set(win.id, { messages: [], abort: null, backups: new Map(), last: null }); return convs.get(win.id); };
  ipcMain.handle('maxyai:reset', e => { const w = BrowserWindow.fromWebContents(e.sender); convs.delete(w.id); return true; });
  ipcMain.handle('maxyai:stop', e => { const c = conv(BrowserWindow.fromWebContents(e.sender)); if (c.abort) c.abort.abort(); return true; });
  ipcMain.handle('maxyai:undo', e => {
    const c = conv(BrowserWindow.fromWebContents(e.sender));
    if (!c.last || !c.last.size) return 0;
    let n = 0;
    for (const [full, content] of c.last) {
      try { if (content === null) fs.rmSync(full, { force: true }); else fs.writeFileSync(full, content); n++; } catch { /* ignoré */ }
    }
    c.last = null;
    return n;
  });
  ipcMain.handle('maxyai:send', async (e, text, context) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const dir = projectWins.get(win.id);
    if (!dir) throw new Error("Aucun projet n'est ouvert dans cette fenêtre.");
    const key = apiKey();
    if (!key) throw new Error("Ajoute d'abord ta clé API Anthropic dans Maxy AI.");
    const c = conv(win);
    if (c.abort) throw new Error('Maxy AI répond déjà : attends ou arrête la réponse en cours.');
    const emit = ev => { if (!win.isDestroyed()) win.webContents.send('maxyai:event', ev); };
    c.abort = new AbortController();
    c.last = new Map();
    try { await runTurn({ c, dir, win, key, text, context, emit }); }
    catch (err) { repair(c); emit({ type: 'error', message: c.abort.signal.aborted ? 'Réponse arrêtée.' : describe(err) }); }
    finally { c.abort = null; emit({ type: 'end', changed: c.last.size }); }
    return true;
  });

  // Après une interruption : chaque demande d'outil doit avoir sa réponse, sinon la question suivante serait refusée
  function repair(c) {
    const last = c.messages[c.messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return;
    const uses = last.content.filter(b => b.type === 'tool_use');
    if (uses.length) c.messages.push({ role: 'user', content: uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: "Interrompu par l'utilisateur." })) });
  }
  function describe(e) {
    if (e instanceof Anthropic.AuthenticationError) return 'Clé API refusée : vérifie-la dans les réglages de Maxy AI.';
    if (e instanceof Anthropic.PermissionDeniedError) return "Ta clé API n'a pas accès à ce modèle.";
    if (e instanceof Anthropic.RateLimitError) return 'Trop de demandes pour le moment : réessaie dans une minute.';
    if (e instanceof Anthropic.BadRequestError) return `Demande refusée par l'API : ${e.message}`;
    if (e instanceof Anthropic.APIConnectionError) return "Pas de connexion à l'API Anthropic : vérifie Internet.";
    if (e instanceof Anthropic.APIError) return `Erreur de l'API (${e.status}) : ${e.message}`;
    return e && e.message ? e.message : String(e);
  }

  // Validation simple d'une entrée d'outil (les entrées en streaming ne sont pas validées par le serveur)
  function valid(schema, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    for (const k of schema.required || []) if (input[k] === undefined) return false;
    for (const [k, v] of Object.entries(input)) {
      const p = schema.properties[k];
      if (!p) return false;
      const t = p.type;
      if (t === 'string' && typeof v !== 'string') return false;
      if (t === 'number' && typeof v !== 'number') return false;
      if (t === 'boolean' && typeof v !== 'boolean') return false;
      if (t === 'array' && !Array.isArray(v)) return false;
      if (t === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) return false;
      if (p.enum && !p.enum.includes(v)) return false;
    }
    return true;
  }
  const TOOL_DEFS = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema, ...(t.eager ? { eager_input_streaming: true } : {}) }));
  const SCHEMAS = Object.fromEntries(TOOLS.map(t => [t.name, t.schema]));

  async function runTurn({ c, dir, win, key, text, context, emit }) {
    const opts = settings();
    const client = clientFor(key);
    let type = '2d';
    try { type = JSON.parse(fs.readFileSync(path.join(dir, CFG), 'utf8')).type || '2d'; } catch { /* projet illisible */ }
    const guide = require(path.join(rootDir, 'templates.js')).guide(type === '3d' || type === 'app' ? type : '2d');
    const system = [{ type: 'text', text: `${INSTRUCTIONS}\n\n# Guide de MaxyStudio (projet ${type.toUpperCase()})\n\n${guide}`, cache_control: { type: 'ephemeral' } }];
    const ctxLine = context ? `[Contexte MaxyStudio : projet « ${path.basename(dir)} », scène ${context.scene || '?'}${context.selected ? `, objet sélectionné « ${context.selected} »` : ''}${context.file ? `, fichier ouvert ${context.file}` : ''}]\n\n` : '';
    c.messages.push({ role: 'user', content: ctxLine + text });

    const tctx = {
      rootDir, libDir,
      status: async () => ({ active: dir, open: [...projectWins.values()] }),
      project: async () => dir,
      bridge: (method, params) => bridgeCall(win, method, params),
      // Sauvegarde du contenu d'avant, pour « Annuler les changements »
      before: (d, rel) => {
        const full = path.resolve(d, rel);
        if (!c.last.has(full)) c.last.set(full, fs.existsSync(full) ? fs.readFileSync(full) : null);
      }
    };
    let jsonRetries = 0;
    for (let step = 0; step < 40; step++) {
      const params = {
        model: opts.model,
        max_tokens: 64000,
        system,
        tools: TOOL_DEFS,
        messages: c.messages,
        output_config: { effort: opts.effort }
      };
      if (WITH_FALLBACK.has(opts.model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
      const stream = client.beta.messages.stream(params, { signal: c.abort.signal });
      stream.on('text', delta => emit({ type: 'text', delta }));
      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Anthropic.APIError || c.abort.signal.aborted || jsonRetries++ >= 2) throw err;
        continue; // entrée d'outil illisible : on relance ce tour
      }
      emit({ type: 'usage', usage: message.usage, model: message.model });
      if (message.stop_reason === 'refusal') { c.messages.push({ role: 'assistant', content: message.content }); emit({ type: 'error', message: 'Claude a refusé cette demande.' }); return; }
      if (message.stop_reason === 'pause_turn') { c.messages.push({ role: 'assistant', content: message.content }); continue; }
      const uses = message.content.filter(b => b.type === 'tool_use');
      c.messages.push({ role: 'assistant', content: message.content });
      if (!uses.length) return;
      if (message.stop_reason === 'max_tokens') { emit({ type: 'error', message: 'Réponse trop longue, coupée : demande une étape plus petite.' }); c.messages.push({ role: 'user', content: uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Entrée coupée (max_tokens).' })) }); return; }
      const results = [];
      for (const u of uses) {
        if (c.abort.signal.aborted) throw new Error('Réponse arrêtée.');
        if (!SCHEMAS[u.name] || !valid(SCHEMAS[u.name], u.input)) {
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(u.input) }) });
          continue;
        }
        emit({ type: 'tool', name: u.name, input: summarize(u.name, u.input) });
        try {
          const r = await callTool(tctx, u.name, u.input);
          const content = [];
          if (r.image) content.push({ type: 'image', source: { type: 'base64', media_type: r.image.mimeType, data: r.image.data } });
          if (r.text) content.push({ type: 'text', text: r.text.length > 60000 ? r.text.slice(0, 60000) + '\n[…coupé]' : r.text });
          results.push({ type: 'tool_result', tool_use_id: u.id, content });
          emit({ type: 'tool_done', name: u.name, ok: true });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: err.message || String(err) });
          emit({ type: 'tool_done', name: u.name, ok: false, message: err.message || String(err) });
        }
      }
      c.messages.push({ role: 'user', content: results });
    }
    emit({ type: 'error', message: 'Trop d\'étapes pour une seule demande : découpe-la en plusieurs.' });
  }
  function summarize(name, a) {
    return a.path || a.name || a.query || a.file || (a.kind ? `${a.kind}` : '') || '';
  }
};
