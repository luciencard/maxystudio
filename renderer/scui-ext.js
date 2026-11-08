// Extension « Interface » : boutons, textes, champs et images pour les projets de type Application.
(function (Scratch) {
  'use strict';
  const vm = Scratch.vm;
  const runtime = vm.runtime;
  const Cast = Scratch.Cast;
  const project = () => window.__scProject || { base: '' };
  const resolveUrl = rel => /^(https?|app|data|blob):/.test(rel) ? rel : project().base + String(rel).split('/').map(encodeURIComponent).join('/');

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
  runtime.on('PROJECT_START', clearAll);

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
    setText(a) { const el = els.get(Cast.toString(a.ID)); if (!el) return; if (el.tagName === 'INPUT') el.value = Cast.toString(a.TEXT); else el.textContent = Cast.toString(a.TEXT); }
    textOf(a) { const el = els.get(Cast.toString(a.ID)); return el ? (el.tagName === 'INPUT' ? el.value : el.textContent) : ''; }
    setStyle(a) {
      const el = els.get(Cast.toString(a.ID)); if (!el) return;
      const v = Cast.toString(a.VALUE);
      if (a.PROP === 'color') el.style.color = v;
      else if (a.PROP === 'background') el.style.background = v;
      else if (a.PROP === 'text size') el.style.fontSize = (Cast.toNumber(v) || 15) + 'px';
      else if (a.PROP === 'width') el.style.width = (Cast.toNumber(v) || 0) ? Cast.toNumber(v) + 'px' : '';
      else if (a.PROP === 'visible') el.style.display = /^(false|no|non|off|0)$/i.test(v) ? 'none' : '';
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
