// Extension « Interface » : boutons, textes, champs et images pour les projets de type Application.
(function (Scratch) {
  'use strict';
  const vm = Scratch.vm;
  const runtime = vm.runtime;
  const Cast = Scratch.Cast;
  const project = () => window.__scProject || { base: '' };
  const resolveUrl = rel => /^(https?|app|data|blob):/.test(rel) ? rel : project().base + String(rel).split('/').map(encodeURIComponent).join('/');

  // Changement de scène : l'extension est rechargée. Seule la dernière copie reste active (sinon l'interface serait en double).
  const GEN = window.__scuiGen = (window.__scuiGen || 0) + 1;
  const alive = () => GEN === window.__scuiGen;
  if (typeof window.__scuiDispose === 'function') { try { window.__scuiDispose(); } catch (e) { /* ignoré */ } }

  let layer = null;
  const els = new Map();
  let clicked = { id: '', t: 0 };

  function root() {
    if (layer && layer.isConnected) return layer;
    const box = Scratch.renderer.canvas.parentElement;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    layer = document.createElement('div');
    layer.className = 'scui-layer';
    const st = document.createElement('style');
    st.textContent = `
      .scui-layer{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:18px;box-sizing:border-box;overflow:auto;font:15px/1.4 system-ui,"Segoe UI",sans-serif;color:#1f2430;pointer-events:none}
      .scui-layer.row{flex-direction:row;flex-wrap:wrap;justify-content:center;align-content:flex-start}
      .scui-layer.center{justify-content:center}
      .scui-layer > *{pointer-events:auto;max-width:100%;box-sizing:border-box}
      .scui-btn{border:0;border-radius:10px;padding:9px 18px;background:#855cd6;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 0 rgba(0,0,0,.18);transition:transform .08s,filter .15s}
      .scui-btn:hover{filter:brightness(1.08)}.scui-btn:active{transform:translateY(1px) scale(.98)}
      .scui-label{font-weight:500;white-space:pre-wrap;text-align:center}
      .scui-title{font-size:24px;font-weight:800}
      .scui-input{border:2px solid #d9dce3;border-radius:10px;padding:8px 12px;font:15px system-ui,sans-serif;min-width:220px;outline:none;background:#fff;color:#1f2430}
      .scui-input:focus{border-color:#855cd6}
      .scui-img{max-height:45%;border-radius:8px}
      .scui-alert{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);background:#1f2430;color:#fff;border-radius:10px;padding:9px 16px;font-weight:600;z-index:5;animation:scui-in .2s ease-out}
      @keyframes scui-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}`;
    layer.appendChild(st);
    box.appendChild(layer);
    return layer;
  }
  function put(id, el) {
    id = Cast.toString(id);
    const old = els.get(id);
    el.dataset.id = id;
    if (old && old.isConnected) old.replaceWith(el); else root().appendChild(el);
    els.set(id, el);
    return el;
  }
  function clearAll() {
    for (const el of els.values()) el.remove();
    els.clear();
    if (layer) { layer.className = 'scui-layer'; layer.style.background = ''; }
  }

  // ---------- Interface dessinée dans l'éditeur (onglet Interface de MaxyStudio) ----------
  // Même mise en forme que ui-editor.js : positions en % de l'écran, textes pour un écran de 480 px de large.
  let hudLayer = null;
  const hud = new Map();
  function uiStyle(e) {
    const u = n => `calc(var(--u, 1px) * ${+n || 0})`;
    const al = e.type === 'bar' || e.align === 'left' ? 'flex-start' : e.align === 'right' ? 'flex-end' : 'center';
    const st = {
      position: 'absolute', left: (+e.x - +e.w / 2) + '%', top: (+e.y - +e.h / 2) + '%', width: (+e.w) + '%', height: (+e.h) + '%',
      boxSizing: 'border-box', display: e.visible === false ? 'none' : 'flex', alignItems: 'center', justifyContent: al, textAlign: e.align || 'center',
      padding: e.type === 'bar' ? u(3) : `0 ${u(8)}`, overflow: 'hidden', whiteSpace: 'pre-wrap', lineHeight: '1.15', margin: '0',
      fontFamily: '"Segoe UI", system-ui, sans-serif', fontWeight: e.bold ? '700' : '500', fontSize: u(e.size || 18), color: e.color || '#ffffff',
      background: e.bgOn ? (e.bg || '#1f2430') : 'transparent', borderRadius: u(e.radius), border: '0',
      textShadow: e.shadow ? `0 ${u(1.5)} ${u(3)} rgba(0,0,0,.6)` : 'none', opacity: String(e.opacity ?? 1),
      cursor: e.type === 'button' ? 'pointer' : 'default', boxShadow: e.type === 'button' && e.bgOn ? `0 ${u(3)} 0 rgba(0,0,0,.25)` : 'none',
      pointerEvents: e.type === 'button' ? 'auto' : 'none'
    };
    if (e.type === 'image') st.background = e.image ? `center / contain no-repeat url("${resolveUrl(e.image)}")` : 'transparent';
    return st;
  }
  function hudRoot() {
    if (hudLayer && hudLayer.isConnected) return hudLayer;
    const box = Scratch.renderer.canvas.parentElement;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    hudLayer = document.createElement('div');
    hudLayer.className = 'scui-hud';
    Object.assign(hudLayer.style, { position: 'absolute', inset: '0', zIndex: '4', pointerEvents: 'none', overflow: 'hidden' });
    box.appendChild(hudLayer);
    const fit = () => hudLayer.style.setProperty('--u', (box.clientWidth / 480) + 'px');
    new ResizeObserver(fit).observe(box);
    fit();
    return hudLayer;
  }
  function buildHud() {
    for (const el of hud.values()) el.remove();
    hud.clear();
    const list = (project().scene && project().scene.ui) || [];
    if (!list.length) return;
    const root = hudRoot();
    for (const e of list) {
      const el = document.createElement(e.type === 'button' ? 'button' : 'div');
      Object.assign(el.style, uiStyle(e));
      el.dataset.ui = e.type;
      if (e.type === 'bar') {
        const f = document.createElement('div');
        Object.assign(f.style, { height: '100%', width: Math.max(0, Math.min(100, +e.value || 0)) + '%', background: e.barColor || '#3ddc84', borderRadius: `calc(var(--u, 1px) * ${Math.max(0, (+e.radius || 0) - 2)})`, transition: 'width .15s' });
        el.appendChild(f);
      } else if (e.type !== 'image') el.textContent = e.text || '';
      if (e.type === 'button') {
        el.tabIndex = -1;
        el.onclick = () => { clicked = { id: e.name, t: performance.now() }; runtime.startHats('scuiapp_whenButton'); };
        el.onmousedown = ev => ev.stopPropagation();
      }
      root.appendChild(el);
      hud.set(e.name, el);
    }
  }
  window.__maxyUi = { get: id => getEl(id) };
  const getEl = id => { id = Cast.toString(id); return els.get(id) || hud.get(id) || [...hud.entries()].find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1]; };
  runtime.on('PROJECT_START', () => { if (alive()) { clearAll(); buildHud(); startAnims(); startJs(); } });

  // ---------- Scripts JavaScript (maxyjs.js) ----------
  let jsMod = null;
  const hasJs = () => {
    const sc = project().scene || {};
    return [sc.worldScript, sc.stage && sc.stage.script, ...(sc.objects || []).map(o => o.script)].some(r => r && /\.js$/i.test(r));
  };
  function startJs() {
    if (!hasJs()) { if (jsMod) jsMod.stop(); return; }
    import(new URL('/studio/maxyjs.js', location.href).href).then(m => {
      jsMod = m;
      return m.start({ runtime, project: project(), base: project().base, bust: window.__maxyJsBust || '' });
    }).catch(e => runtime.emit('SC_PRINT', { text: 'Scripts JavaScript : ' + (e.message || e), level: 'error' }));
  }
  runtime.on('PROJECT_STOP_ALL', () => { if (alive() && jsMod) jsMod.stop(); });
  // Clics et messages de MaxyCode : transmis aussi aux scripts .js
  const startHats = runtime.startHats;
  runtime.startHats = function (opcode, fields, target) {
    if (jsMod && alive()) { try { jsMod.hat(opcode, fields, target); } catch (e) { /* ignoré */ } }
    return startHats.apply(this, arguments);
  };

  // ---------- Clips d'animation (assets/animations/*.anim, éditeur d'animation de MaxyStudio) ----------
  // Même calcul que anim-editor.js.
  const clips = new Map();
  const anims = new Map();
  let animOn = false, animLast = 0;
  const clipRel = name => { name = Cast.toString(name).trim(); return /\.anim$/i.test(name) ? name : `assets/animations/${name}.anim`; };
  function loadClip(rel) {
    if (!clips.has(rel)) clips.set(rel, fetch(resolveUrl(rel)).then(r => (r.ok ? r.json() : null)).catch(() => null));
    return clips.get(rel);
  }
  function sampleClip(clip, t) {
    const out = {};
    for (const [prop, keys] of Object.entries(clip.tracks || {})) {
      if (!keys.length) continue;
      if (t <= keys[0][0]) { out[prop] = keys[0][1]; continue; }
      const last = keys[keys.length - 1];
      if (t >= last[0]) { out[prop] = last[1]; continue; }
      let i = 0;
      while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
      const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
      let f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      if (clip.ease) f = f * f * (3 - 2 * f);
      out[prop] = v0 + (v1 - v0) * f;
    }
    return out;
  }
  function applyPose(name, vals) {
    const W = window.__sc3d;
    if (project().type === '3d') {
      if (!W) return;
      let obj = null;
      for (const o of W.objects.values()) if (o.name === name && o.parent) { obj = o; break; }
      if (!obj) return;
      for (const [k, v] of Object.entries(vals)) {
        const [p, i] = k.split('.');
        if (p === 'position') obj.position.setComponent(+i, v);
        else if (p === 'rotation') obj.rotation[['x', 'y', 'z'][+i]] = v * Math.PI / 180;
        else if (p === 'scale') obj.scale.setComponent(+i, v);
      }
      return;
    }
    const t = runtime.getSpriteTargetByName(name);
    if (!t) return;
    if ('x' in vals || 'y' in vals) t.setXY('x' in vals ? vals.x : t.x, 'y' in vals ? vals.y : t.y);
    if ('size' in vals) t.setSize(vals.size);
    if ('direction' in vals) t.setDirection(vals.direction);
  }
  function animTick(now) {
    if (!alive()) return;
    requestAnimationFrame(animTick);
    const dt = animLast ? Math.min(0.1, (now - animLast) / 1000) : 0;
    animLast = now;
    if (!animOn || window.__scPaused || !anims.size) return;
    for (const [name, a] of anims) {
      if (!a.playing) continue;
      const L = +a.clip.length || 1;
      a.t += dt;
      if (a.t >= L) {
        if (a.clip.loop && !a.once) a.t %= L;
        else { a.t = L; a.playing = false; }
      }
      applyPose(name, sampleClip(a.clip, a.t));
    }
    runtime.requestRedraw();
  }
  requestAnimationFrame(animTick);
  function startAnims() {
    anims.clear(); clips.clear(); animOn = true;
    const sc = project().scene || {};
    for (const o of sc.objects || []) {
      if (!o.animator || !o.animator.clip || o.animator.autoplay === false) continue;
      loadClip(o.animator.clip).then(c => { if (c && animOn) anims.set(o.name, { clip: c, t: 0, playing: true, once: false }); });
    }
  }
  runtime.on('PROJECT_STOP_ALL', () => { if (alive()) animOn = false; });
  window.__scuiDispose = () => {
    animOn = false; anims.clear();
    for (const el of hud.values()) el.remove();
    hud.clear();
    clearAll();
    if (layer) layer.remove();
    if (hudLayer) hudLayer.remove();
  };
  window.__maxyAnim = {
    play: (name, clip, once) => loadClip(clipRel(clip)).then(c => { if (c) { animOn = true; anims.set(name, { clip: c, t: 0, playing: true, once: !!once }); } }),
    stop: name => anims.delete(name)
  };

  const S = (v = '') => ({ type: Scratch.ArgumentType.STRING, defaultValue: v });
  const cmd = (opcode, text, args = {}) => ({ opcode, blockType: Scratch.BlockType.COMMAND, text, arguments: args });

  class MaxyCodeUI {
    getInfo() {
      return {
        id: 'scuiapp', name: 'Interface', color1: '#e6457a', color2: '#c73a69', color3: '#a32f56',
        blocks: [
          cmd('addTitle', 'add title [ID] text [TEXT]', { ID: S('titre'), TEXT: S('Mon application') }),
          cmd('addLabel', 'add label [ID] text [TEXT]', { ID: S('info'), TEXT: S('Bonjour !') }),
          cmd('addButton', 'add button [ID] text [TEXT]', { ID: S('ok'), TEXT: S('OK') }),
          cmd('addInput', 'add text field [ID] hint [TEXT]', { ID: S('nom'), TEXT: S('Ton prénom') }),
          cmd('addImage', 'add image [ID] from [ASSET]', { ID: S('logo'), ASSET: S('assets/image.png') }),
          { opcode: 'whenButton', blockType: Scratch.BlockType.HAT, isEdgeActivated: false, text: 'when button [ID] clicked', arguments: { ID: S('ok') } },
          cmd('setText', 'set text of [ID] to [TEXT]', { ID: S('info'), TEXT: S('Merci !') }),
          { opcode: 'textOf', blockType: Scratch.BlockType.REPORTER, text: 'text of [ID]', arguments: { ID: S('nom') }, disableMonitor: true },
          cmd('setStyle', 'set [PROP] of [ID] to [VALUE]', { PROP: { type: Scratch.ArgumentType.STRING, menu: 'props', defaultValue: 'color' }, ID: S('ok'), VALUE: S('#4c97ff') }),
          cmd('removeEl', 'remove element [ID]', { ID: S('info') }),
          cmd('playClip', 'play clip [NAME]', { NAME: S('Porte') }),
          cmd('playClipOnce', 'play clip [NAME] once', { NAME: S('Porte') }),
          cmd('stopClip', 'stop clip'),
          { opcode: 'clipPlaying', blockType: Scratch.BlockType.BOOLEAN, text: 'clip playing?' },
          cmd('showEl', 'show element [ID]', { ID: S('Menu') }),
          cmd('hideEl', 'hide element [ID]', { ID: S('Menu') }),
          cmd('setBar', 'set bar [ID] to [V] %', { ID: S('Vie'), V: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 } }),
          cmd('setImage', 'set image of [ID] to [ASSET]', { ID: S('Image'), ASSET: S('assets/image.png') }),
          cmd('clearUi', 'clear interface'),
          cmd('layout', 'arrange elements in [MODE]', { MODE: { type: Scratch.ArgumentType.STRING, menu: 'modes', defaultValue: 'column' } }),
          cmd('background', 'set app background to [COLOR]', { COLOR: S('#f4f1ff') }),
          cmd('alert', 'show notification [TEXT]', { TEXT: S('Enregistré') }),
          // Scènes (tous les types de projets) : changer de niveau en gardant les variables de la Scène
          cmd('goToScene', 'go to scene [NAME]', { NAME: S('Niveau 2') }),
          { opcode: 'sceneName', blockType: Scratch.BlockType.REPORTER, text: 'scene name', disableMonitor: true },
          // Débogueur de MaxyStudio : point de contrôle ajouté automatiquement avant chaque ligne en mode débogage
          cmd('debugLine', 'debug line [ID]', { ID: S('') })
        ],
        menus: {
          props: { acceptReporters: false, items: ['color', 'background', 'text size', 'width', 'visible'] },
          modes: { acceptReporters: false, items: ['column', 'row', 'center'] }
        }
      };
    }
    goToScene(args, util) {
      const go = window.__maxyGoToScene;
      if (typeof go !== 'function') return;
      // Laisse ce script finir son tour avant de recharger le moteur
      setTimeout(() => go(String(args.NAME)), 0);
      if (util && util.thread) util.thread.status = 4; // arrête ce script : la nouvelle scène prend la suite
    }
    sceneName() { return window.__maxySceneName || ''; }
    debugLine(args, util) { const f = window.__maxyDebug; return typeof f === 'function' ? f(String(args.ID), util) : undefined; }
    addTitle(a) { const el = document.createElement('div'); el.className = 'scui-label scui-title'; el.textContent = Cast.toString(a.TEXT); put(a.ID, el); }
    addLabel(a) { const el = document.createElement('div'); el.className = 'scui-label'; el.textContent = Cast.toString(a.TEXT); put(a.ID, el); }
    addButton(a) {
      const el = document.createElement('button');
      el.className = 'scui-btn'; el.textContent = Cast.toString(a.TEXT);
      const id = Cast.toString(a.ID);
      el.onclick = () => { clicked = { id, t: performance.now() }; runtime.startHats('scuiapp_whenButton'); };
      put(id, el);
    }
    addInput(a) {
      const el = document.createElement('input');
      el.className = 'scui-input'; el.placeholder = Cast.toString(a.TEXT); el.spellcheck = false;
      el.addEventListener('keydown', e => e.stopPropagation());
      put(a.ID, el);
    }
    addImage(a) { const el = document.createElement('img'); el.className = 'scui-img'; el.alt = ''; el.src = resolveUrl(Cast.toString(a.ASSET)); put(a.ID, el); }
    whenButton(a) { return Cast.toString(a.ID) === clicked.id && performance.now() - clicked.t < 500; }
    setText(a) { const el = getEl(a.ID); if (!el || el.dataset.ui === 'bar' || el.dataset.ui === 'image') return; if (el.tagName === 'INPUT') el.value = Cast.toString(a.TEXT); else el.textContent = Cast.toString(a.TEXT); }
    textOf(a) { const el = getEl(a.ID); return el ? (el.tagName === 'INPUT' ? el.value : el.textContent) : ''; }
    setStyle(a) {
      const el = getEl(a.ID); if (!el) return;
      const v = Cast.toString(a.VALUE);
      if (a.PROP === 'color') el.style.color = v;
      else if (a.PROP === 'background') el.style.background = v;
      else if (a.PROP === 'text size') el.style.fontSize = (Cast.toNumber(v) || 15) + 'px';
      else if (a.PROP === 'width') el.style.width = (Cast.toNumber(v) || 0) ? Cast.toNumber(v) + 'px' : '';
      else if (a.PROP === 'visible') el.style.display = /^(false|no|non|off|0)$/i.test(v) ? 'none' : (el.dataset.ui ? 'flex' : '');
    }
    playClip(a, u, once = false) {
      const name = u && u.target && !u.target.isStage ? u.target.getName() : '';
      if (!name) return;
      return loadClip(clipRel(a.NAME)).then(c => {
        if (!c) return runtime.emit('SC_PRINT', { text: `Clip introuvable : ${clipRel(a.NAME)}`, level: 'error', who: name });
        animOn = true;
        anims.set(name, { clip: c, t: 0, playing: true, once });
      });
    }
    playClipOnce(a, u) { return this.playClip(a, u, true); }
    stopClip(a, u) { if (u && u.target) anims.delete(u.target.getName()); }
    clipPlaying(a, u) { const x = u && u.target && anims.get(u.target.getName()); return !!(x && x.playing); }
    showEl(a) { const el = getEl(a.ID); if (el) el.style.display = el.dataset.ui ? 'flex' : ''; }
    hideEl(a) { const el = getEl(a.ID); if (el) el.style.display = 'none'; }
    setBar(a) { const el = getEl(a.ID); const f = el && el.dataset.ui === 'bar' && el.firstChild; if (f) f.style.width = Math.max(0, Math.min(100, Cast.toNumber(a.V))) + '%'; }
    setImage(a) {
      const el = getEl(a.ID); if (!el) return;
      const src = resolveUrl(Cast.toString(a.ASSET));
      if (el.tagName === 'IMG') el.src = src; else el.style.background = `center / contain no-repeat url("${src}")`;
    }
    removeEl(a) { const el = els.get(Cast.toString(a.ID)); if (el) { el.remove(); els.delete(Cast.toString(a.ID)); } }
    clearUi() { clearAll(); }
    layout(a) { const r = root(); r.classList.remove('row', 'center'); if (a.MODE !== 'column') r.classList.add(a.MODE); }
    background(a) { root().style.background = Cast.toString(a.COLOR); }
    alert(a) {
      const el = document.createElement('div'); el.className = 'scui-alert'; el.textContent = Cast.toString(a.TEXT);
      root().appendChild(el); setTimeout(() => el.remove(), 2600);
    }
  }
  Scratch.extensions.register(new MaxyCodeUI());
})(Scratch);
