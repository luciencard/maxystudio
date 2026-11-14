// Publier sur MaxyGame depuis MaxyStudio : une fiche courte, des captures prises automatiquement, et le jeu est en ligne.
// La fiche est gardée pour le projet : la fois suivante, « Publier » met le jeu à jour en un clic.
import { AGE_QUESTIONS, AGE_TEXT, CATEGORIES, DEVICES, AI_USE, computeAge, hasUrl } from './maxy-catalog.js';

export function initPublish(host) {
  const { $, esc, modal, toast, log, status, S } = host;
  const key = () => 'maxystudio.publish.' + host.DIR;
  const loadFiche = () => { try { return JSON.parse(localStorage.getItem(key()) || '{}'); } catch { return {}; } };
  const saveFiche = f => { try { localStorage.setItem(key(), JSON.stringify(f)); } catch { /* stockage plein */ } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let busy = false;

  if (studio.publish.onProgress) studio.publish.onProgress((text, pct) => status(`Publication : ${text} (${pct} %)`));

  async function ensureAccount() {
    const a = await studio.publish.account();
    if (a.connected) return true;
    const ok = await modal('Connecter ton compte MaxyGame', `<p class="in-note" style="font-size:13px">Pour publier, MaxyStudio a besoin de ton compte MaxyGame (Google ou Microsoft). Une page s'ouvre dans ton navigateur : connecte-toi, puis clique sur « Autoriser MaxyStudio ». C'est à faire une seule fois.</p>`, { ok: 'Ouvrir la page de connexion' });
    if (ok === null) return false;
    status('En attente de la connexion dans ton navigateur…');
    toast('Termine la connexion dans ton navigateur, puis reviens ici.');
    await studio.publish.login();
    toast('Compte MaxyGame connecté.');
    return true;
  }

  function form(f, games, error) {
    const sel = (id, opts, val, first) => `<select class="f" id="${id}" style="width:100%;box-sizing:border-box">${first ? `<option value="">${first}</option>` : ''}${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const row = (label, html) => `<label style="display:block;margin:0 0 10px"><span class="in-note" style="display:block;margin-bottom:3px">${label}</span>${html}</label>`;
    const answers = f.ageAnswers || {};
    return `<div id="pubForm" style="max-height:62vh;overflow-y:auto;overflow-x:hidden;padding-right:8px">
      ${error ? `<p style="color:#ff8a7a;font-size:13px;margin:0 0 10px">${esc(error)}</p>` : ''}
      ${games.length ? row('Publication', sel('pubGame', [['', 'Nouveau jeu'], ...games.map(g => [g.id, `Mettre à jour « ${g.title} » (${g.plays} parties)`])], f.gameId || '')) : ''}
      ${row('Nom du jeu', `<input class="f" style="width:100%;box-sizing:border-box" id="pubTitle" maxlength="80" value="${esc(f.title || S.config.name || '')}" spellcheck="false">`)}
      ${row('Description (ce qu\'on fait dans le jeu)', `<textarea class="f" id="pubDesc" rows="3" maxlength="2000" style="resize:vertical;width:100%;box-sizing:border-box">${esc(f.description || '')}</textarea>`)}
      ${row('Commandes', `<input class="f" style="width:100%;box-sizing:border-box" id="pubCtrl" maxlength="300" value="${esc(f.controls || '')}" placeholder="Flèches : bouger, Espace : sauter">`)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${row('Catégorie', sel('pubCat', CATEGORIES.map(c => [c, c]), f.category || '', 'Choisir…'))}
        ${row('Version', `<input class="f" style="width:100%;box-sizing:border-box" id="pubVer" maxlength="20" value="${esc(f.version || '1.0')}">`)}
      </div>
      ${row('Appareils', `<span style="display:flex;gap:14px;flex-wrap:wrap">${Object.entries(DEVICES).map(([k, d]) => `<label style="display:flex;gap:5px;align-items:center"><input type="checkbox" data-dev="${k}"${(f.devices || ['pc']).includes(k) ? ' checked' : ''}>${esc(d.name)}</label>`).join('')}</span>`)}
      ${row('As-tu utilisé une IA pour ce jeu ?', sel('pubAi', Object.entries(AI_USE), f.ai || 'non'))}
      ${row('Crédits (musiques, images, modèles)', `<input class="f" style="width:100%;box-sizing:border-box" id="pubCredits" maxlength="1000" value="${esc(f.credits || '')}">`)}
      <p class="in-note" style="margin:14px 0 8px;font-weight:700">Questionnaire d'âge : réponds d'après le vrai contenu du jeu.</p>
      ${AGE_QUESTIONS.map(q => row(esc(q.q), sel('pubAge-' + q.id, q.a.map((a, i) => [i, a.t]), answers[q.id] ?? '', 'Choisir…'))).join('')}
      <p class="in-note" style="margin:10px 0 0">MaxyStudio lance ton jeu quelques secondes pour prendre les captures d'écran. Le jeu est en ligne juste après.</p>
    </div>`;
  }

  function read(games) {
    const v = id => { const e = $('#' + id); return e ? e.value.trim() : ''; };
    const answers = {};
    for (const q of AGE_QUESTIONS) { const x = v('pubAge-' + q.id); if (x !== '') answers[q.id] = +x; }
    const gameId = games.length ? v('pubGame') : '';
    return {
      gameId: games.some(g => g.id === gameId) ? gameId : '', title: v('pubTitle'), description: v('pubDesc'), controls: v('pubCtrl'), category: v('pubCat'), version: v('pubVer') || '1.0',
      devices: [...document.querySelectorAll('#pubForm [data-dev]')].filter(i => i.checked).map(i => i.dataset.dev), ai: v('pubAi') || 'non', credits: v('pubCredits'), ageAnswers: answers
    };
  }

  function validate(f) {
    if (!f.title) return 'Donne un nom à ton jeu.';
    if (f.description.length < 20) return 'Décris ton jeu en une ou deux phrases.';
    if (!f.category) return 'Choisis une catégorie.';
    if (!f.devices.length) return 'Choisis au moins un appareil.';
    for (const [k, t] of [['title', 'le nom'], ['description', 'la description'], ['controls', 'les commandes'], ['credits', 'les crédits']]) if (hasUrl(f[k])) return `Pas d'adresse web dans ${t}.`;
    const age = computeAge(f.ageAnswers);
    if (!age.complete) return 'Réponds à toutes les questions du questionnaire d\'âge.';
    if (age.refused.length) return 'Ce jeu ne peut pas être publié sur MaxyGame : ' + age.refused.join(' ; ');
    return '';
  }

  /** Rectangle du jeu (4:3, au centre du cadre du moteur). */
  function stageRect() {
    const r = $('#engine').getBoundingClientRect();
    const w = Math.min(r.width, r.height * 4 / 3), h = w * 3 / 4;
    return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, width: w, height: h };
  }
  async function takeShots() {
    const started = S.mode === 'edit';
    if (started) await host.play();
    host.activateTab('game');
    const shots = [];
    for (const delay of [4000, 3500]) {
      await wait(delay);
      if (S.mode === 'edit') break;
      try { const s = await studio.publish.capture(stageRect()); if (s && s.pc) shots.push(s); } catch { /* capture impossible : le jeu est publié sans cette image */ }
    }
    if (started && S.mode !== 'edit') host.stop();
    return shots;
  }

  async function publish() {
    if (busy || !studio.publish) return;
    busy = true;
    try {
      if (S.mode !== 'edit') host.stop();
      await host.saveAll();
      if (!await ensureAccount()) return;
      let games = [];
      try { games = await studio.publish.mine(); }
      catch (e) { if (/reconnecte|connecte d'abord/i.test(String(e.message))) { if (!await ensureAccount()) return; games = await studio.publish.mine(); } else throw e; }
      let f = loadFiche();
      if (f.gameId && !games.some(g => g.id === f.gameId)) f.gameId = '';
      let error = '';
      for (;;) {
        const ok = await modal('Publier sur MaxyGame', form(f, games, error), { ok: f.gameId ? 'Mettre à jour mon jeu' : 'Publier mon jeu', focus: '#pubTitle' });
        if (ok === null) return;
        f = read(games);
        error = validate(f);
        if (!error) break;
      }
      saveFiche(f);
      const age = computeAge(f.ageAnswers);
      status('Publication : captures du jeu…');
      const shots = await takeShots();
      const r = await studio.publish.game(host.DIR, { ...f, age: age.age, ageTags: age.tags, shots });
      saveFiche({ ...f, gameId: r.id });
      status(r.updated ? 'Jeu mis à jour sur MaxyGame' : 'Jeu publié sur MaxyGame');
      log('ok', `${r.updated ? 'Jeu mis à jour' : 'Jeu publié'} sur MaxyGame (${AGE_TEXT[age.age]}) : ${r.url}`);
      const open = await modal(r.updated ? 'Ton jeu est à jour' : 'Ton jeu est en ligne', `<p class="in-note" style="font-size:13px">« ${esc(f.title)} » est sur MaxyGame, ${esc(AGE_TEXT[age.age].toLowerCase())}.<br><br><b>${esc(r.url)}</b><br><br>Pour le mettre à jour plus tard : Fichier, puis Publier sur MaxyGame.</p>`, { ok: 'Ouvrir la page du jeu', cancel: 'Fermer' });
      if (open !== null) studio.publish.open(r.url);
    } catch (e) {
      const m = host.cleanErr(e);
      toast('Publication impossible : ' + m, true);
      log('error', 'Publication sur MaxyGame : ' + m);
      status('Publication impossible');
    } finally { busy = false; }
  }

  async function accountMenu() {
    const a = await studio.publish.account();
    if (!a.connected) { try { if (await ensureAccount()) status('Compte MaxyGame connecté'); } catch (e) { toast(host.cleanErr(e), true); } return; }
    const ok = await modal('Compte MaxyGame', `<p class="in-note" style="font-size:13px">MaxyStudio publie avec le compte ${a.name ? `« ${esc(a.name)} »` : 'connecté'}.</p>`, { ok: 'Déconnecter ce compte', cancel: 'Fermer' });
    if (ok !== null) { await studio.publish.logout(); toast('Compte MaxyGame déconnecté.'); }
  }

  return { publish, accountMenu };
}
