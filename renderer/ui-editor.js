// Éditeur d'interface (HUD) : textes, boutons, images, barres et panneaux placés par-dessus le jeu.
// Les positions et tailles sont en % de l'écran du jeu ; les tailles de texte sont données pour un écran de 480 px de large.
// La même mise en forme est recopiée dans scui-ext.js (moteur de jeu) : garder les deux identiques.

export const UI_TYPES = [['text', 'Texte'], ['button', 'Bouton'], ['image', 'Image'], ['bar', 'Barre'], ['panel', 'Panneau']];
export const UI_ICON = { text: 'edit', button: 'play', image: 'image', bar: 'sliders', panel: 'layers' };

export function defaultUiElement(type, name, id) {
  const base = { id, name, type, x: 50, y: 50, w: 40, h: 10, text: '', size: 18, color: '#ffffff', bgOn: false, bg: '#1f2430', radius: 0, bold: true, shadow: true, align: 'center', opacity: 1, visible: true };
  const by = {
    text: { text: 'Texte', size: 20 },
    button: { w: 30, h: 11, text: 'Jouer', bgOn: true, bg: '#855cd6', radius: 10, shadow: false },
    image: { w: 20, h: 26, image: '', shadow: false },
    bar: { w: 36, h: 5, value: 100, barColor: '#3ddc84', bgOn: true, bg: '#1f2430', radius: 6, shadow: false },
    panel: { w: 60, h: 50, bgOn: true, bg: '#1f2430', radius: 14, opacity: 0.85, shadow: false }
  };
  return Object.assign(base, by[type] || by.text);
}

/** Style d'un élément (identique dans scui-ext.js). u(n) = n pixels d'un écran de 480 px. */
export function uiStyle(e, url) {
  const u = n => `calc(var(--u, 1px) * ${+n || 0})`;
  const al = e.type === 'bar' || e.align === 'left' ? 'flex-start' : e.align === 'right' ? 'flex-end' : 'center';
  const st = {
    position: 'absolute', left: (+e.x - +e.w / 2) + '%', top: (+e.y - +e.h / 2) + '%', width: (+e.w) + '%', height: (+e.h) + '%',
    boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: al, textAlign: e.align || 'center',
    padding: e.type === 'bar' ? u(3) : `0 ${u(8)}`, overflow: 'hidden', whiteSpace: 'pre-wrap', lineHeight: '1.15', margin: '0',
    fontFamily: '"Segoe UI", system-ui, sans-serif', fontWeight: e.bold ? '700' : '500', fontSize: u(e.size || 18), color: e.color || '#ffffff',
    background: e.bgOn ? (e.bg || '#1f2430') : 'transparent', borderRadius: u(e.radius), border: '0',
    textShadow: e.shadow ? `0 ${u(1.5)} ${u(3)} rgba(0,0,0,.6)` : 'none', opacity: String(e.opacity ?? 1),
    cursor: e.type === 'button' ? 'pointer' : 'default', boxShadow: e.type === 'button' && e.bgOn ? `0 ${u(3)} 0 rgba(0,0,0,.25)` : 'none'
  };
  if (e.type === 'image') Object.assign(st, { background: e.image ? `center / contain no-repeat url("${url(e.image)}")` : (e.bgOn ? e.bg : 'rgba(255,255,255,.08)') });
  return st;
}
export function uiNode(e, url) {
  const el = document.createElement(e.type === 'button' ? 'button' : 'div');
  el.className = 'mxui mxui-' + e.type;
  fillUiNode(el, e, url);
  return el;
}
export function fillUiNode(el, e, url) {
  el.removeAttribute('style');
  Object.assign(el.style, uiStyle(e, url));
  if (e.type === 'bar') {
    el.textContent = '';
    const f = document.createElement('div');
    f.className = 'mxui-fill';
    Object.assign(f.style, { height: '100%', width: Math.max(0, Math.min(100, +e.value || 0)) + '%', background: e.barColor || '#3ddc84', borderRadius: `calc(var(--u, 1px) * ${Math.max(0, (+e.radius || 0) - 2)})`, transition: 'width .15s' });
    el.appendChild(f);
  } else if (e.type !== 'image') el.textContent = e.text || '';
  else el.textContent = '';
}

export class UiEditor {
  /** ctx : { scene(), selected(), select(id), before(), changed(live), url(rel), background(), editText(e) } */
  constructor(box, list, ctx) {
    this.box = box; this.list = list; this.ctx = ctx;
    this.stage = document.createElement('div');
    this.stage.className = 'ui-stage';
    box.appendChild(this.stage);
    new ResizeObserver(() => this.fit()).observe(box);
    this.stage.addEventListener('mousedown', e => this.down(e));
    this.stage.addEventListener('dblclick', e => {
      const n = e.target.closest('[data-ui]');
      const el = n && this.find(n.dataset.ui);
      if (el && el.type !== 'image' && el.type !== 'bar') this.ctx.editText(el);
    });
  }
  els() { const s = this.ctx.scene(); return (s && s.ui) || []; }
  find(id) { return this.els().find(e => e.id === id); }
  fit() {
    const w = this.box.clientWidth - 32, h = this.box.clientHeight - 32;
    if (w <= 0 || h <= 0) return;
    const sw = Math.max(120, Math.min(w, h * 4 / 3));
    this.stage.style.width = sw + 'px';
    this.stage.style.height = sw * 3 / 4 + 'px';
    this.stage.style.setProperty('--u', (sw / 480) + 'px');
  }
  render() {
    if (!this.box.offsetParent) { this.dirty = true; return; }
    this.dirty = false;
    this.fit();
    this.stage.style.background = this.ctx.background();
    const sel = this.ctx.selected();
    this.stage.innerHTML = '';
    for (const e of this.els()) {
      const n = uiNode(e, this.ctx.url);
      n.dataset.ui = e.id;
      if (e.visible === false) n.style.opacity = String(0.35 * (e.opacity ?? 1));
      if (n.tagName === 'BUTTON') n.tabIndex = -1;
      this.stage.appendChild(n);
      if (e.id === sel) {
        const f = document.createElement('div');
        f.className = 'ui-sel';
        Object.assign(f.style, { left: (e.x - e.w / 2) + '%', top: (e.y - e.h / 2) + '%', width: e.w + '%', height: e.h + '%' });
        f.innerHTML = '<i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i>';
        this.stage.appendChild(f);
      }
    }
    if (!this.els().length) {
      const t = document.createElement('div');
      t.className = 'ui-empty';
      t.textContent = 'Ajoute un texte, un bouton, une image, une barre ou un panneau avec les boutons du haut. Ils s\'affichent par-dessus le jeu.';
      this.stage.appendChild(t);
    }
    this.list.innerHTML = this.els().map(e => `<div class="ui-row${e.id === sel ? ' sel' : ''}${e.visible === false ? ' off' : ''}" data-row="${e.id}"><span>${({ text: 'T', button: 'B', image: 'I', bar: '%', panel: 'P' })[e.type] || '?'}</span>${e.name.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</div>`).join('') || '<p class="ui-none">Aucun élément</p>';
    this.list.querySelectorAll('[data-row]').forEach(r => r.onclick = () => this.ctx.select(r.dataset.row));
  }
  down(ev) {
    if (ev.button !== 0) return;
    const handle = ev.target.dataset && ev.target.dataset.h;
    const node = ev.target.closest('[data-ui]');
    let e = handle ? this.find(this.ctx.selected()) : node ? this.find(node.dataset.ui) : null;
    if (!e) { this.ctx.select(null); return; }
    ev.preventDefault();
    if (e.id !== this.ctx.selected()) { this.ctx.select(e.id); e = this.find(e.id); }
    const r = this.stage.getBoundingClientRect();
    const start = { mx: ev.clientX, my: ev.clientY, x: e.x, y: e.y, w: e.w, h: e.h };
    let moved = false;
    const snap = v => Math.round(v * 2) / 2;
    const move = m => {
      const dx = (m.clientX - start.mx) / r.width * 100, dy = (m.clientY - start.my) / r.height * 100;
      if (!moved && Math.hypot(m.clientX - start.mx, m.clientY - start.my) < 3) return;
      if (!moved) { moved = true; this.ctx.before(); }
      if (!handle) {
        let x = snap(start.x + dx), y = snap(start.y + dy);
        if (Math.abs(x - 50) < 1.2) x = 50;
        if (Math.abs(y - 50) < 1.2) y = 50;
        e.x = x; e.y = y;
      } else {
        // Le coin opposé reste en place
        const l0 = start.x - start.w / 2, t0 = start.y - start.h / 2, r0 = start.x + start.w / 2, b0 = start.y + start.h / 2;
        let l = l0, t = t0, rr = r0, b = b0;
        if (handle.includes('w')) l = Math.min(r0 - 2, snap(l0 + dx)); else rr = Math.max(l0 + 2, snap(r0 + dx));
        if (handle.includes('n')) t = Math.min(b0 - 2, snap(t0 + dy)); else b = Math.max(t0 + 2, snap(b0 + dy));
        e.w = +(rr - l).toFixed(2); e.h = +(b - t).toFixed(2); e.x = +((l + rr) / 2).toFixed(2); e.y = +((t + b) / 2).toFixed(2);
      }
      this.render();
      this.ctx.changed(true);
    };
    const up = () => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      if (moved) this.ctx.changed(false);
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }
}
