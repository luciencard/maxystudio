/* MaxyStudio 2.0 - plugins (dans l'esprit des plugins de Roblox Studio).
   Un plugin est un dossier avec plugin.json et un module JavaScript qui exporte activate(api).
   Il ajoute des boutons à la barre Plugins, des éléments au menu Plugins, et agit sur la scène, les fichiers
   et le jeu avec l'API ci-dessous. La documentation complète est dans PLUGINS.md (menu Plugins > Créer un plugin). */

const API_VERSION = '1.0';

export function initPlugins(host) {
  const { $, esc, icon, S } = host;
  const handlers = { play: [], stop: [], select: [], save: [], beforeExport: [] };
  const menuItems = [];
  const loaded = [];

  // ---------------- API donnée à chaque plugin ----------------
  function makeApi(meta) {
    const tag = `[${meta.name}]`;
    const safe = (fn, ...args) => {
      try { return fn(...args); } catch (e) { host.log('error', `${tag} ${e && e.message || e}`); }
    };
    const storeKey = k => `maxystudio.plugin.${meta.id}.${k}`;
    return Object.freeze({
      apiVersion: API_VERSION,
      plugin: Object.freeze({ id: meta.id, name: meta.name, version: meta.version }),

      project: Object.freeze({
        get name() { return S.config.name; },
        get type() { return S.type; },
        files: () => host.allFiles(),
        exists: rel => host.allFiles().includes(rel),
        read: rel => studio.readFile(host.DIR, rel),
        async write(rel, text) { await host.writeText(rel, String(text)); await host.refreshTree(); },
        openScript: (rel, line) => host.openScript(rel, line)
      }),

      scene: Object.freeze({
        /** Copie de la scène (modifier la copie ne change rien : utiliser update). */
        get: () => JSON.parse(JSON.stringify(S.scene)),
        find: id => { const o = host.findObj(id); return o ? JSON.parse(JSON.stringify(o)) : null; },
        /** Modifie la scène en une fois (annulable avec Ctrl+Z). */
        async update(fn) {
          if (S.mode !== 'edit') throw new Error('Arrête le jeu avant de modifier la scène.');
          host.snapshot();
          await fn(S.scene);
          await host.reloadScene();
        },
        /** Crée un objet comme le menu Objet (cube, sphere, plane, light, camera, empty... ou un lutin en 2D). */
        create: (kind, props = {}, parentId = null) => host.createObject(kind, props, parentId),
        async remove(id) {
          await this.update(scene => {
            const ids = new Set([id, ...host.descendants(id).map(o => o.id)]);
            scene.objects = scene.objects.filter(o => !ids.has(o.id));
          });
        }
      }),

      selection: Object.freeze({
        get: () => S.sel,
        set: id => host.select(id)
      }),

      game: Object.freeze({
        play: () => (S.mode === 'edit' ? host.play() : undefined),
        stop: () => (S.mode !== 'edit' ? host.stop() : undefined),
        get playing() { return S.mode !== 'edit'; }
      }),

      ui: Object.freeze({
        toast: (msg, isError) => host.toast(`${meta.name} : ${msg}`, isError),
        /** Ajoute un bouton à la barre Plugins (en haut à droite). */
        addButton({ label, icon: ic = meta.icon || 'plug', title, onClick }) {
          const b = document.createElement('button');
          b.className = 'un-btn plug';
          b.title = title || `${meta.name} : ${label}`;
          b.innerHTML = icon(ic, 14) + `<span>${esc(label)}</span>`;
          b.onclick = () => safe(onClick);
          $('#pluginBar').appendChild(b);
          $('#pluginBar').hidden = false;
          return b;
        },
        /** Ajoute un élément au menu Plugins. */
        addMenuItem({ label, icon: ic = meta.icon || 'plug', onClick }) {
          menuItems.push({ label, ic, fn: () => safe(onClick), plugin: meta.name });
        },
        /** Fenêtre avec du HTML ; onOpen(corps) permet de brancher ses boutons. Renvoie true (OK) ou null (Annuler). */
        dialog(title, html, { ok = 'OK', cancel = 'Annuler', onOpen } = {}) {
          const p = host.modal(title, html, { ok, cancel });
          if (onOpen) safe(onOpen, $('#modalBody'));
          return p;
        },
        prompt: (title, value = '') => host.ask(title, value),
        confirm: (title, text, ok = 'Continuer') => host.confirmBox(title, text, ok)
      }),

      console: Object.freeze({
        log: msg => host.log('log', `${tag} ${msg}`),
        warn: msg => host.log('warn', `${tag} ${msg}`),
        error: msg => host.log('error', `${tag} ${msg}`),
        ok: msg => host.log('ok', `${tag} ${msg}`)
      }),

      /** Événements : play, stop, select (id), save, beforeExport (renvoie une liste de problèmes). */
      on(event, fn) {
        if (!handlers[event]) throw new Error(`Événement inconnu : ${event}`);
        handlers[event].push({ fn, meta });
      },

      storage: Object.freeze({
        get(k, def = null) { try { const v = localStorage.getItem(storeKey(k)); return v == null ? def : JSON.parse(v); } catch { return def; } },
        set(k, v) { localStorage.setItem(storeKey(k), JSON.stringify(v)); }
      }),

      openUrl: url => studio.openExternal(url)
    });
  }

  // ---------------- Chargement ----------------
  async function loadAll() {
    let list = [];
    try { list = await studio.plugins.list(); } catch (e) { host.log('warn', 'Plugins : liste illisible.'); }
    for (const p of list) {
      if (!p.enabled) continue;
      if (p.broken) { host.log('warn', `Plugin « ${p.id} » ignoré : ${p.broken}`); continue; }
      try {
        const mod = await import(`/plugins/${p.id}/${p.main}?v=${encodeURIComponent(p.version)}`);
        if (typeof mod.activate !== 'function') throw new Error('le module doit exporter une fonction activate(api).');
        await mod.activate(makeApi(p));
        loaded.push(p);
        host.log('log', `Plugin chargé : ${p.name} ${p.version}`);
      } catch (e) {
        host.log('error', `Plugin « ${p.name} » non chargé : ${e && e.message || e}`);
      }
    }
  }

  // ---------------- Événements envoyés par l'éditeur ----------------
  function emit(event, ...args) {
    for (const h of handlers[event]) {
      try { h.fn(...args); } catch (e) { host.log('error', `[${h.meta.name}] ${e && e.message || e}`); }
    }
  }
  /** Vérifications avant l'export : chaque plugin renvoie [{ level: 'error' | 'warn', message }]. */
  async function beforeExport() {
    const problems = [];
    for (const h of handlers.beforeExport) {
      try {
        const list = (await h.fn()) || [];
        for (const p of list) problems.push({ level: p.level === 'error' ? 'error' : 'warn', message: String(p.message), plugin: h.meta.name });
      } catch (e) { host.log('error', `[${h.meta.name}] ${e && e.message || e}`); }
    }
    for (const p of problems) host.log(p.level, `[${p.plugin}] ${p.message}`);
    const errors = problems.filter(p => p.level === 'error');
    if (!errors.length) return true;
    const ok = await host.modal('Problèmes avant l\'export',
      `<p class="in-note" style="font-size:13px">${errors.length} problème${errors.length > 1 ? 's' : ''} trouvé${errors.length > 1 ? 's' : ''} par les plugins :</p>
       <ul class="pl-problems">${errors.slice(0, 12).map(p => `<li><b>${esc(p.plugin)}</b> ${esc(p.message)}</li>`).join('')}</ul>`,
      { ok: 'Exporter quand même', cancel: 'Annuler' });
    return !!ok;
  }

  // ---------------- Menu Plugins et gestionnaire ----------------
  function menu() {
    const items = menuItems.length
      ? ['Plugins installés', ...menuItems.map(it => ({ label: it.label, ic: it.ic, fn: it.fn }))]
      : [{ label: 'Aucun plugin actif', ic: 'plug', disabled: true, fn: () => {} }];
    return [
      ...items,
      '-',
      { label: 'Ajouter un plugin…', ic: 'plus', fn: () => manager('add') },
      { label: 'Gérer les plugins…', ic: 'sliders', fn: () => manager('installed') },
      { label: 'Ouvrir le dossier des plugins', ic: 'external', fn: () => studio.plugins.openFolder() },
      '-',
      { label: 'Créer un plugin (guide)', ic: 'book', fn: () => studio.openExternal('https://maxygame.web.app/plugins/guide') }
    ];
  }

  const WARNING = 'Un plugin est un programme : il peut lire et modifier tes projets. Installe seulement des plugins venant de personnes de confiance.';

  async function manager(tab = 'installed') {
    const draw = async (body, current) => {
      const [installed, catalog] = await Promise.all([studio.plugins.list(), studio.plugins.catalog()]);
      const tabs = `<div class="pl-tabs"><button data-tab="installed" class="${current === 'installed' ? 'on' : ''}">Installés (${installed.length})</button><button data-tab="add" class="${current === 'add' ? 'on' : ''}">Ajouter un plugin</button></div>`;
      let html = '';
      if (current === 'installed') {
        html = installed.length ? installed.map(p => `
          <div class="pl-item${p.broken ? ' broken' : ''}">
            <div class="pl-ic">${icon(p.icon || 'plug', 18)}</div>
            <div class="pl-txt"><b>${esc(p.name)}</b> <span class="pl-ver">${esc(p.version || '')}</span>${p.author ? ` <span class="pl-auth">par ${esc(p.author)}</span>` : ''}
              <p>${esc(p.broken ? 'Plugin invalide : ' + p.broken : p.description || '')}</p></div>
            <label class="in-check"><input type="checkbox" data-toggle="${esc(p.id)}"${p.enabled ? ' checked' : ''}${p.broken ? ' disabled' : ''}>Actif</label>
            <button class="un-btn sm" data-remove="${esc(p.id)}">${icon('trash', 12)}Retirer</button>
          </div>`).join('') : '<p class="in-note">Aucun plugin installé. Ouvre l\'onglet « Ajouter un plugin ».</p>';
      } else {
        html = `<p class="pl-warn">${icon('alertTri', 14)}${esc(WARNING)}</p>
          <div class="pl-src"><button class="un-btn" data-from="file">${icon('download', 13)}Depuis un fichier .maxyplugin</button><button class="un-btn" data-from="folder">${icon('folderOpen', 13)}Depuis un dossier</button></div>
          <h4 class="pl-h">Plugins fournis avec MaxyStudio</h4>
          ${catalog.map(p => `
          <div class="pl-item">
            <div class="pl-ic">${icon(p.icon || 'plug', 18)}</div>
            <div class="pl-txt"><b>${esc(p.name)}</b> <span class="pl-ver">${esc(p.version)}</span> <span class="pl-auth">par ${esc(p.author)}</span><p>${esc(p.description)}</p></div>
            <button class="un-btn sm${p.installed ? '' : ' primary'}" data-install="${esc(p.id)}">${p.installed ? 'Réinstaller' : 'Installer'}</button>
          </div>`).join('')}`;
      }
      body.innerHTML = tabs + `<div class="pl-list">${html}</div><p class="in-note pl-reload" hidden>Les changements s'appliquent après « Recharger ».</p>`;
      const changed = () => { body.querySelector('.pl-reload').hidden = false; $('#modalOk').textContent = 'Recharger'; };
      body.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => draw(body, b.dataset.tab); });
      body.querySelectorAll('[data-toggle]').forEach(c => { c.onchange = async () => { await studio.plugins.setEnabled(c.dataset.toggle, c.checked); changed(); }; });
      body.querySelectorAll('[data-remove]').forEach(b => {
        b.onclick = async () => { await studio.plugins.remove(b.dataset.remove); await draw(body, 'installed'); changed(); };
      });
      body.querySelectorAll('[data-install]').forEach(b => {
        b.onclick = async () => {
          try { const m = await studio.plugins.installCatalog(b.dataset.install); host.toast(`Plugin installé : ${m.name}`); await draw(body, 'add'); changed(); }
          catch (e) { host.toast(host.cleanErr(e), true); }
        };
      });
      body.querySelectorAll('[data-from]').forEach(b => {
        b.onclick = async () => {
          try {
            const m = await studio.plugins.installFrom(b.dataset.from);
            if (m) { host.toast(`Plugin installé : ${m.name}`); await draw(body, 'installed'); changed(); }
          } catch (e) { host.toast(host.cleanErr(e), true); }
        };
      });
    };
    const p = host.modal('Plugins', '<p class="in-note">Chargement…</p>', { ok: 'Fermer', cancel: '' });
    $('#modalBack .un-modal').classList.add('wide');
    await draw($('#modalBody'), tab);
    const r = await p;
    $('#modalBack .un-modal').classList.remove('wide');
    if (r && $('#modalOk').textContent === 'Recharger') location.reload();
  }

  return { loadAll, emit, beforeExport, menu, manager, get loaded() { return loaded.slice(); } };
}
