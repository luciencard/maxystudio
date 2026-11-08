// Éditeur d'animation : un clip (assets/animations/*.anim) contient des images clés pour la position,
// la rotation et l'échelle (3D) ou x, y, taille et direction (2D). Le moteur de jeu les lit dans scui-ext.js.

export const PROPS_3D = [['position.0', 'Position X'], ['position.1', 'Position Y'], ['position.2', 'Position Z'], ['rotation.0', 'Rotation X'], ['rotation.1', 'Rotation Y'], ['rotation.2', 'Rotation Z'], ['scale.0', 'Échelle X'], ['scale.1', 'Échelle Y'], ['scale.2', 'Échelle Z']];
export const PROPS_2D = [['x', 'X'], ['y', 'Y'], ['size', 'Taille'], ['direction', 'Direction']];

export function newClip() { return { format: 'maxy-anim', version: 1, length: 2, loop: true, ease: true, tracks: {} }; }

/** Valeurs du clip au temps t (même calcul que scui-ext.js). */
export function sampleClip(clip, t) {
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
const valueOf = (def, prop) => { const [p, i] = prop.split('.'); return i == null ? +def[p] : +def[p][+i]; };
const near = (a, b) => Math.abs(a - b) < 0.005;
const r3 = v => Math.round(v * 1000) / 1000;

export class AnimEditor {
  /** ctx : { type, def(), clips(), read(rel), write(rel, clip), create(), link(def, rel), preview(def, vals), restore(def), icon(n, s), esc(s) } */
  constructor(tools, view, ctx) {
    this.tools = tools; this.view = view; this.ctx = ctx;
    this.rel = null; this.clip = null; this.t = 0; this.playing = false; this.selT = null; this.previewDef = null;
    this.props = ctx.type === '3d' ? PROPS_3D : PROPS_2D;
  }
  async open(rel) {
    this.stop();
    this.rel = rel || null;
    this.clip = rel ? await this.ctx.read(rel) : null;
    if (this.clip) { this.clip.tracks = this.clip.tracks || {}; this.clip.length = +this.clip.length || 2; }
    this.t = 0; this.selT = null;
    this.render();
    this.apply();
  }
  save() { if (this.rel && this.clip) this.ctx.write(this.rel, this.clip); }
  keyTimes() {
    const set = new Map();
    for (const keys of Object.values(this.clip.tracks)) for (const [t] of keys) if (![...set.keys()].some(k => near(k, t))) set.set(t, true);
    return [...set.keys()].sort((a, b) => a - b);
  }
  /** Enregistre la pose actuelle de l'objet sélectionné au temps du curseur. */
  addKey() {
    const def = this.ctx.def();
    if (!this.clip || !def) return false;
    const t = r3(this.t);
    for (const [prop] of this.props) {
      const v = r3(valueOf(def, prop));
      const keys = this.clip.tracks[prop] || (this.clip.tracks[prop] = []);
      const k = keys.find(x => near(x[0], t));
      if (k) k[1] = v; else keys.push([t, v]);
      keys.sort((a, b) => a[0] - b[0]);
    }
    if (t > this.clip.length) this.clip.length = Math.ceil(t * 2) / 2;
    this.selT = t;
    this.save(); this.render(); this.apply();
    return true;
  }
  deleteKey() {
    if (!this.clip || this.selT == null) return;
    for (const p of Object.keys(this.clip.tracks)) {
      this.clip.tracks[p] = this.clip.tracks[p].filter(k => !near(k[0], this.selT));
      if (!this.clip.tracks[p].length) delete this.clip.tracks[p];
    }
    this.selT = null;
    this.save(); this.render(); this.apply();
  }
  moveKey(from, to) {
    to = r3(Math.max(0, Math.min(this.clip.length, to)));
    for (const keys of Object.values(this.clip.tracks)) {
      for (const k of keys) if (near(k[0], from)) k[0] = to;
      keys.sort((a, b) => a[0] - b[0]);
    }
    this.selT = to;
  }
  /** Montre l'objet à la pose du clip au temps t (sans modifier la scène). */
  apply() {
    const def = this.ctx.def();
    if (this.previewDef && this.previewDef !== def) { this.ctx.restore(this.previewDef); this.previewDef = null; }
    if (!def || !this.clip || !Object.keys(this.clip.tracks).length) { if (this.previewDef) { this.ctx.restore(this.previewDef); this.previewDef = null; } return; }
    this.previewDef = def;
    this.ctx.preview(def, sampleClip(this.clip, this.t));
  }
  restore() { if (this.previewDef) { this.ctx.restore(this.previewDef); this.previewDef = null; } }
  play() {
    if (!this.clip) return;
    if (this.playing) return this.stop();
    this.playing = true;
    let last = performance.now();
    if (this.t >= this.clip.length) this.t = 0;
    const tick = now => {
      if (!this.playing) return;
      this.t += (now - last) / 1000; last = now;
      if (this.t > this.clip.length) {
        if (this.clip.loop) this.t %= this.clip.length;
        else { this.t = this.clip.length; this.playing = false; }
      }
      this.apply(); this.drawCursor();
      if (this.playing) this.raf = requestAnimationFrame(tick); else this.render();
    };
    this.raf = requestAnimationFrame(tick);
    this.render();
  }
  stop() { this.playing = false; cancelAnimationFrame(this.raf); }

  render() {
    const { icon, esc } = this.ctx;
    const clips = this.ctx.clips();
    const def = this.ctx.def();
    this.tools.innerHTML = `<select class="f" id="animClip" title="Clip d'animation"><option value="">(aucun clip)</option>${clips.map(c => `<option value="${esc(c)}"${c === this.rel ? ' selected' : ''}>${esc(c.split('/').pop().replace(/\.anim$/, ''))}</option>`).join('')}</select>
      <button class="un-btn sm" id="animNew">${icon('plus', 12)}Nouveau clip</button>
      <button class="un-btn sm${this.playing ? ' on' : ''}" id="animPlay"${this.clip ? '' : ' disabled'}>${icon(this.playing ? 'pause' : 'play', 12)}${this.playing ? 'Pause' : 'Lecture'}</button>
      <button class="un-btn sm primary" id="animKey"${this.clip && def ? '' : ' disabled'} title="Enregistre la pose de l'objet sélectionné au temps du curseur (K)">${icon('plus', 12)}Image clé</button>
      <button class="un-btn sm" id="animDel"${this.selT != null ? '' : ' disabled'} title="Supprimer l'image clé sélectionnée">${icon('trash', 12)}</button>`;
    this.tools.querySelector('#animClip').onchange = e => this.ctx.choose(e.target.value);
    this.tools.querySelector('#animNew').onclick = () => this.ctx.create();
    this.tools.querySelector('#animPlay').onclick = () => this.play();
    this.tools.querySelector('#animKey').onclick = () => this.addKey();
    this.tools.querySelector('#animDel').onclick = () => this.deleteKey();
    if (!this.clip) {
      this.view.innerHTML = `<div class="an-empty"><b>Aucun clip ouvert.</b> Sélectionne un objet, puis clique sur « Nouveau clip ». Place le curseur du temps, déplace l'objet dans la vue Scène et clique sur « Image clé » (K) : MaxyStudio fait la transition entre les poses.</div>`;
      return;
    }
    const c = this.clip, L = c.length;
    const linked = def && def.animator && def.animator.clip === this.rel;
    const step = L <= 3 ? 0.25 : L <= 8 ? 0.5 : 1;
    let ticks = '';
    for (let t = 0; t <= L + 1e-6; t += step) ticks += `<span style="left:${t / L * 100}%">${+t.toFixed(2)} s</span>`;
    const keys = this.keyTimes();
    const rows = this.props.map(([p, label]) => {
      const tr = c.tracks[p] || [];
      return `<div class="an-row"><div class="an-lbl">${esc(label)}</div><div class="an-lane" data-lane>${tr.map(([t, v]) => `<i class="an-key${this.selT != null && near(t, this.selT) ? ' sel' : ''}" data-key="${t}" style="left:${t / L * 100}%" title="${+t.toFixed(3)} s : ${+(+v).toFixed(3)}"></i>`).join('')}</div></div>`;
    }).join('');
    this.view.innerHTML = `<div class="an-head">
        <span>${def ? `Objet : <b>${esc(def.name)}</b>` : '<span class="un-dim">Sélectionne un objet pour enregistrer des poses</span>'}</span>
        ${def ? (linked ? `<label class="in-check"><input type="checkbox" id="animAuto"${def.animator.autoplay !== false ? ' checked' : ''}>Joue au démarrage du jeu</label>` : `<button class="un-btn sm" id="animLink">Lier ce clip à « ${esc(def.name)} »</button>`) : ''}
        <span class="grow"></span>
        <label>Durée (s) <input class="f" id="animLen" value="${L}" style="width:52px"></label>
        <label class="in-check"><input type="checkbox" id="animLoop"${c.loop ? ' checked' : ''}>En boucle</label>
        <label class="in-check"><input type="checkbox" id="animEase"${c.ease ? ' checked' : ''}>Adoucir</label>
        <span class="an-time" id="animTime">${this.t.toFixed(2)} s</span>
      </div>
      <div class="an-grid"><div class="an-row an-rulerrow"><div class="an-lbl">${keys.length} image${keys.length > 1 ? 's' : ''} clé${keys.length > 1 ? 's' : ''}</div><div class="an-ruler" data-lane>${ticks}</div></div>${rows}<div class="an-cursor" id="animCursor"></div></div>`;
    const v = this.view;
    const on = (id, ev, fn) => { const el = v.querySelector(id); if (el) el[ev] = fn; };
    on('#animLink', 'onclick', () => { this.ctx.link(def, this.rel); this.render(); });
    on('#animAuto', 'onchange', e => { this.ctx.autoplay(def, e.target.checked); });
    on('#animLen', 'onchange', e => { const n = parseFloat(String(e.target.value).replace(',', '.')); if (n > 0.05) { c.length = Math.round(n * 100) / 100; this.save(); } this.render(); });
    on('#animLoop', 'onchange', e => { c.loop = e.target.checked; this.save(); });
    on('#animEase', 'onchange', e => { c.ease = e.target.checked; this.save(); this.apply(); });
    // Curseur du temps : clic ou glisser sur la règle et les pistes ; les losanges se déplacent
    v.querySelectorAll('[data-lane]').forEach(lane => lane.onmousedown = ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const r = lane.getBoundingClientRect();
      const timeAt = x => Math.max(0, Math.min(L, Math.round((x - r.left) / r.width * L * 20) / 20));
      const key = ev.target.dataset && ev.target.dataset.key;
      this.stop();
      if (key != null) {
        let from = +key; this.selT = from; this.t = from;
        let moved = false;
        const move = m => { const to = Math.round(timeAt(m.clientX) * 20) / 20; if (Math.abs(to - from) < 1e-6) return; moved = true; this.moveKey(from, to); from = to; this.t = to; this.render(); this.apply(); };
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (moved) this.save(); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
      } else {
        this.selT = null;
        const move = m => { this.t = timeAt(m.clientX); this.drawCursor(); this.apply(); };
        move(ev);
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.render(); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
      }
      this.render(); this.apply();
    });
    this.drawCursor();
  }
  drawCursor() {
    const cur = this.view.querySelector('#animCursor'), lane = this.view.querySelector('.an-ruler');
    if (!cur || !lane || !this.clip) return;
    const g = this.view.querySelector('.an-grid').getBoundingClientRect(), r = lane.getBoundingClientRect();
    cur.style.left = (r.left - g.left + this.t / this.clip.length * r.width) + 'px';
    const tm = this.view.querySelector('#animTime');
    if (tm) tm.textContent = this.t.toFixed(2) + ' s';
  }
}
