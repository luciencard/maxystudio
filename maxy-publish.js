// Publication sur MaxyGame depuis MaxyStudio : connexion au compte MaxyGame (dans le navigateur, une seule fois),
// captures du jeu, puis envoi du jeu, de sa fiche et de ses images. Le jeu est en ligne tout de suite.
// Les écritures se font avec la session du membre : les règles de MaxyGame s'appliquent comme sur le Dev Portal
// (5 jeux par jour, questionnaire d'âge, pas d'adresse web dans les textes).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const path = require('path');

const SERVER = process.env.MAXY_PUBLISH_SERVER || 'https://maxygame-mcp.scratchcode.workers.dev';
const SITE = 'https://maxygame.web.app';
const CHUNK = 880000;            // caractères base64 par morceau (comme le Dev Portal)
const MAX_BYTES = 60 * 1024 * 1024;

module.exports = function setupPublish({ app, ipcMain, shell, safeStorage, BrowserWindow, nativeImage, buildArchive }) {
  const file = () => path.join(app.getPath('userData'), 'maxygame-account.json');
  let account = null;   // { rt, name }
  let session = null;   // { idToken, uid, name, expiresAt, projectId, apiKey, firestoreUrl }
  let pending = null;   // connexion en cours

  // ---------- Compte (jeton de renouvellement chiffré par le système) ----------
  function load() {
    if (account) return account;
    try {
      const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
      const rt = d.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(d.enc, 'base64')) : d.rt;
      account = rt ? { rt, name: d.name || '' } : null;
    } catch { account = null; }
    return account;
  }
  function save(a) {
    account = a; session = null;
    if (!a) { try { fs.unlinkSync(file()); } catch { /* déjà absent */ } return; }
    const d = { name: a.name };
    if (safeStorage.isEncryptionAvailable()) d.enc = safeStorage.encryptString(a.rt).toString('base64'); else d.rt = a.rt;
    fs.writeFileSync(file(), JSON.stringify(d));
  }
  const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function post(url, body, headers = {}) {
    const form = body instanceof URLSearchParams;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...headers }, body: form ? body : JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error_description || (data.error && data.error.message) || data.error || `Erreur ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  /** Ouvre la page de connexion de MaxyGame dans le navigateur et attend le retour (5 minutes au plus). */
  function login() {
    if (pending) return pending.promise;
    let finish;
    const promise = new Promise((resolve, reject) => { finish = { resolve, reject }; });
    const state = b64url(crypto.randomBytes(16));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    let redirect = '', clientId = '';
    const page = (title, text) => `<!doctype html><html lang="fr"><meta charset="utf-8"><title>MaxyStudio</title><body style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;background:#f4f6fb;color:#1f2430"><main style="background:#fff;border-radius:16px;padding:32px 36px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)"><h1 style="font-size:22px;margin:0 0 10px">${title}</h1><p style="margin:0">${text}</p></main></body></html>`;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/retour') { res.writeHead(404); return res.end(); }
      const html = (t, x) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(t, x)); };
      try {
        if (u.searchParams.get('state') !== state) throw new Error('Retour inattendu.');
        if (u.searchParams.get('error')) throw new Error('Connexion annulée.');
        const t = await post(`${SERVER}/token`, new URLSearchParams({ grant_type: 'authorization_code', code: u.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect, client_id: clientId }));
        const s = await post(`${SERVER}/session`, null, { Authorization: `Bearer ${t.access_token}` });
        save({ rt: t.refresh_token, name: s.name || '' });
        session = s;
        html('Compte connecté', 'Tu peux fermer cet onglet et retourner dans MaxyStudio.');
        done(null, { name: s.name || '' });
      } catch (e) {
        html('Connexion impossible', String(e.message || e).replace(/[<&]/g, ''));
        done(e);
      }
    });
    const timer = setTimeout(() => done(new Error('La connexion a pris trop de temps. Réessaie.')), 5 * 60 * 1000);
    function done(err, value) {
      if (!pending) return;
      pending = null; clearTimeout(timer);
      setTimeout(() => server.close(), 500);
      err ? finish.reject(err) : finish.resolve(value);
    }
    pending = { promise };
    server.listen(0, '127.0.0.1', async () => {
      try {
        redirect = `http://127.0.0.1:${server.address().port}/retour`;
        const c = await post(`${SERVER}/register`, { client_name: 'MaxyStudio', redirect_uris: [redirect] });
        clientId = c.client_id;
        const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: 'S256' });
        const url = `${SERVER}/authorize?${q}`;
        if (process.env.MAXY_PUBLISH_NO_BROWSER) pending.url = url; else await shell.openExternal(url);
      } catch (e) { done(new Error('Serveur MaxyGame injoignable. Vérifie ta connexion Internet.')); }
    });
    return promise;
  }

  /** Session du membre (jeton d'une heure), renouvelée au besoin. */
  async function getSession() {
    if (session && session.expiresAt > Date.now() / 1000 + 60) return session;
    const a = load();
    if (!a) { const e = new Error('Connecte d\'abord ton compte MaxyGame.'); e.code = 'login'; throw e; }
    try {
      const t = await post(`${SERVER}/token`, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.rt }));
      session = await post(`${SERVER}/session`, null, { Authorization: `Bearer ${t.access_token}` });
      if (t.refresh_token && t.refresh_token !== a.rt) save({ rt: t.refresh_token, name: session.name || a.name });
      return session;
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) { save(null); const x = new Error('Ta connexion à MaxyGame a expiré. Reconnecte ton compte.'); x.code = 'login'; throw x; }
      throw new Error('Serveur MaxyGame injoignable. Vérifie ta connexion Internet.');
    }
  }

  // ---------- Firestore (API REST, avec le jeton du membre) ----------
  const toValue = v => v === null || v === undefined ? { nullValue: null }
    : typeof v === 'boolean' ? { booleanValue: v }
      : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
        : typeof v === 'string' ? { stringValue: v }
          : Array.isArray(v) ? { arrayValue: { values: v.map(toValue) } }
            : { mapValue: { fields: toFields(v) } };
  const toFields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));
  const fromValue = v => !v ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
    : 'booleanValue' in v ? v.booleanValue : 'timestampValue' in v ? v.timestampValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(fromValue)
      : 'mapValue' in v ? fromFields(v.mapValue.fields || {}) : null;
  const fromFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));
  const base = s => `${s.firestoreUrl}/v1/projects/${s.projectId}/databases/(default)/documents`;
  const docName = (s, p) => `projects/${s.projectId}/databases/(default)/documents/${p}`;
  const auth = s => ({ Authorization: `Bearer ${s.idToken}` });
  async function commit(s, writes) {
    try { return await post(`${base(s)}:commit?key=${encodeURIComponent(s.apiKey)}`, { writes }, auth(s)); }
    catch (e) { if (e.status === 403) e.denied = true; throw e; }
  }
  async function getDoc(s, p) {
    const res = await fetch(`${base(s)}/${p}?key=${encodeURIComponent(s.apiKey)}`, { headers: auth(s) });
    if (!res.ok) return null;
    const d = await res.json();
    return { id: d.name.split('/').pop(), ...fromFields(d.fields) };
  }
  function setWrite(s, p, data, { timestamps = [], mustNotExist = false, mask = null } = {}) {
    const w = { update: { name: docName(s, p), fields: toFields(data) } };
    if (timestamps.length) w.updateTransforms = timestamps.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' }));
    if (mustNotExist) w.currentDocument = { exists: false };
    if (mask) w.updateMask = { fieldPaths: mask };
    return w;
  }
  const newId = () => { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; return [...crypto.randomBytes(20)].map(x => c[x % c.length]).join(''); };

  async function mine() {
    const s = await getSession();
    const rows = await post(`${base(s)}:runQuery?key=${encodeURIComponent(s.apiKey)}`, {
      structuredQuery: { from: [{ collectionId: 'maxygames' }], where: { fieldFilter: { field: { fieldPath: 'authorUid' }, op: 'EQUAL', value: { stringValue: s.uid } } }, limit: 100 }
    }, auth(s));
    return rows.filter(r => r.document).map(r => {
      const d = fromFields(r.document.fields);
      return { id: r.document.name.split('/').pop(), title: d.title, description: d.description || '', controls: d.controls || '', category: d.category || '', devices: d.devices || ['pc'],
        ageAnswers: d.ageAnswers || {}, version: d.version || '1.0', plays: d.plays || 0, chunks: d.chunks || 0, mediaCount: d.mediaCount || 0, credits: d.credits || '', updatedAt: d.updatedAt };
    }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  // ---------- Captures ----------
  /** Capture de la vue Jeu : vignette 4:3 (480 x 360) et image Ordinateur 16:9 (1280 x 720), en JPEG. */
  async function capture(win, rect) {
    const img = await win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    const { width, height } = img.getSize();
    if (!width || !height) throw new Error('Capture vide.');
    const jpeg = (im, max) => { for (const q of [85, 75, 65, 50, 35]) { const s = 'data:image/jpeg;base64,' + im.toJPEG(q).toString('base64'); if (s.length <= max) return s; } return null; };
    const h169 = Math.min(height, Math.round(width * 9 / 16));
    const wide = img.crop({ x: 0, y: Math.round((height - h169) / 2), width, height: h169 }).resize({ width: 1280, height: 720, quality: 'best' });
    return { thumb: jpeg(img.resize({ width: 480, height: 360, quality: 'best' }), 190000), pc: jpeg(wide, 390000) };
  }

  // ---------- Publication ----------
  async function publish(win, dir, fiche) {
    const progress = (text, pct) => { if (!win.isDestroyed()) win.webContents.send('publish:progress', text, Math.round(pct)); };
    progress('Préparation du jeu', 2);
    const s = await getSession();
    const cfg = JSON.parse(await fsp.readFile(path.join(dir, 'project.maxycode'), 'utf8'));
    const archive = await buildArchive(dir);
    if (archive.length > MAX_BYTES) throw new Error(`Ce jeu pèse ${Math.round(archive.length / 1048576)} Mo : la limite est de 60 Mo. Allège les images, les sons ou les modèles.`);
    const b64 = archive.toString('base64');
    const chunks = Math.ceil(b64.length / CHUNK);
    const shots = (fiche.shots || []).filter(x => x && x.pc).slice(0, 3);
    const thumb = (fiche.shots || []).map(x => x && x.thumb).find(Boolean);
    const data = {
      title: String(fiche.title).trim().slice(0, 80), description: String(fiche.description || '').trim().slice(0, 2000), controls: String(fiche.controls || '').trim().slice(0, 300),
      type: ['2d', '3d', 'app'].includes(cfg.type) ? cfg.type : '2d', engine: 'maxystudio', size: archive.length, chunks, mediaCount: shots.length,
      category: fiche.category, devices: fiche.devices && fiche.devices.length ? fiche.devices : ['pc'], orientation: 'paysage',
      age: fiche.age, ageTags: fiche.ageTags || [], ageAnswers: fiche.ageAnswers || {}, version: /^[0-9A-Za-z. -]{1,20}$/.test(fiche.version || '') ? fiche.version : '1.0',
      languages: ['fr'], players: ['solo'], gamepad: false, playtime: 'moyen', ai: ['non', 'aide', 'contenu'].includes(fiche.ai) ? fiche.ai : 'non', credits: String(fiche.credits || '').trim().slice(0, 1000)
    };
    if (thumb) data.thumbnail = thumb;
    const total = chunks + shots.length + 3;
    let done = 0;
    const step = text => progress(text, 5 + (++done / total) * 95);
    const updating = fiche.gameId ? await getDoc(s, `maxygames/${fiche.gameId}`) : null;
    if (fiche.gameId && (!updating || updating.authorUid !== s.uid)) throw new Error('Ce jeu n\'existe plus sur MaxyGame, ou n\'est pas à toi. Publie-le comme un nouveau jeu.');
    const id = updating ? updating.id : newId();
    try {
      if (updating) {
        await commit(s, [setWrite(s, `maxygames/${id}`, { ready: false }, { timestamps: ['updatedAt'], mask: ['ready'] })]);
      } else {
        let author = '';
        const prof = await getDoc(s, `profiles/${s.uid}`).catch(() => null);
        author = String((prof && prof.displayName) || s.name || 'Créateur').slice(0, 100);
        const d = new Date();
        const today = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        const q = await getDoc(s, `maxyquota/${s.uid}`).catch(() => null);
        const prev = q && q.day === today ? q.count || 0 : 0;
        if (prev >= 5) throw new Error('Tu as déjà publié 5 jeux aujourd\'hui. Reviens demain pour publier le suivant.');
        await commit(s, [
          setWrite(s, `maxygames/${id}`, { ...data, author, authorUid: s.uid, videoChunks: 0, plays: 0, ready: false }, { timestamps: ['createdAt', 'updatedAt'], mustNotExist: true }),
          setWrite(s, `maxyquota/${s.uid}`, { day: today, count: prev + 1 }, { timestamps: ['updatedAt'] })
        ]);
      }
      step('Envoi du jeu');
      for (let i = 0; i < chunks; i++) {
        await commit(s, [setWrite(s, `maxygames/${id}/chunks/${i}`, { data: b64.slice(i * CHUNK, (i + 1) * CHUNK) })]);
        step(`Envoi du jeu (${i + 1} sur ${chunks})`);
      }
      const extra = [];
      for (let i = chunks; i < ((updating && updating.chunks) || 0); i++) extra.push({ delete: docName(s, `maxygames/${id}/chunks/${i}`) });
      // Images : les nouvelles captures remplacent les images Ordinateur ; sans capture, les anciennes sont gardées
      for (let i = 0; i < shots.length; i++) { await commit(s, [setWrite(s, `maxygames/${id}/media/pc${i}`, { data: shots[i].pc })]); step('Envoi des images'); }
      if (updating && shots.length) for (let i = shots.length; i < 3; i++) extra.push({ delete: docName(s, `maxygames/${id}/media/pc${i}`) });
      if (extra.length) await commit(s, extra).catch(() => {});
      const final = updating ? { ...data, ready: true } : { ready: true };
      if (updating && !shots.length) { delete final.mediaCount; delete final.thumbnail; }
      await commit(s, [setWrite(s, `maxygames/${id}`, final, { timestamps: ['updatedAt'], mask: Object.keys(final) })]);
      step('En ligne');
    } catch (e) {
      if (e.denied) throw new Error('MaxyGame a refusé la publication. Causes possibles : compte non confirmé (Google, Microsoft ou adresse e-mail vérifiée), jeu 16+ ou 18+ sans date de naissance déclarée sur MaxyGame, ou texte refusé (pas d\'adresse web dans les textes).');
      throw e;
    }
    return { id, url: `${SITE}/jeu/?id=${encodeURIComponent(id)}`, updated: !!updating, size: archive.length };
  }

  const win = e => BrowserWindow.fromWebContents(e.sender);
  ipcMain.handle('publish:account', () => { const a = load(); return a ? { connected: true, name: a.name } : { connected: false }; });
  ipcMain.handle('publish:login', () => login());
  ipcMain.handle('publish:loginUrl', () => (pending && pending.url) || null); // tests seulement
  ipcMain.handle('publish:logout', () => { save(null); return true; });
  ipcMain.handle('publish:mine', () => mine());
  ipcMain.handle('publish:capture', (e, rect) => capture(win(e), rect));
  ipcMain.handle('publish:game', (e, dir, fiche) => publish(win(e), dir, fiche));
  ipcMain.handle('publish:open', (_e, url) => { if (typeof url === 'string' && url.startsWith(SITE + '/')) shell.openExternal(url); return true; });
};
