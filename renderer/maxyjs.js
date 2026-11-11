// Scripts JavaScript de MaxyStudio : un objet peut avoir un script .js à la place d'un script MaxyCode.
// Le script exporte une classe qui étend Maxy.Script :
//
//   export default class extends Maxy.Script {
//     start() { this.speed = 4; }
//     update(dt) { this.x += Maxy.axis('horizontal') * this.speed; }
//   }
//
// Le code s'exécute tel quel dans le moteur (pas de traduction) : c'est le langage le plus rapide de MaxyStudio.
// Variables de la Scène, messages, interface et clips sont partagés avec MaxyCode.

const D2R = Math.PI / 180;
let session = 0;
let state = null;

// ---------- Entrées ----------
const keys = new Set(), pressed = new Set();
const norm = k => String(k).toLowerCase().replace(/^key(?=[a-z]$)/, '').replace(/^digit(?=\d$)/, '');
addEventListener('keydown', e => { const c = norm(e.code), k = norm(e.key === ' ' ? 'space' : e.key); if (!keys.has(c)) { pressed.add(c); pressed.add(k); } keys.add(c); keys.add(k); });
addEventListener('keyup', e => { keys.delete(norm(e.code)); keys.delete(norm(e.key === ' ' ? 'space' : e.key)); });
addEventListener('blur', () => keys.clear());
function pad(i) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const v = pads.length ? pads[0].axes[i] || 0 : 0;
  return Math.abs(v) < 0.15 ? 0 : v;
}

// ---------- Objets ----------
function print(text, level = 'log', who = '') {
  if (state) state.runtime.emit('SC_PRINT', { text: String(text), level, who });
}
const show = v => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

/** Objet 2D : un lutin du moteur Scratch. */
class Sprite2D {
  constructor(target) { this.t = target; }
  get name() { return this.t.getName(); }
  get x() { return this.t.x; } set x(v) { this.t.setXY(+v, this.t.y); }
  get y() { return this.t.y; } set y(v) { this.t.setXY(this.t.x, +v); }
  get direction() { return this.t.direction; } set direction(v) { this.t.setDirection(+v); }
  get size() { return this.t.size; } set size(v) { this.t.setSize(+v); }
  get visible() { return this.t.visible; } set visible(v) { this.t.setVisible(!!v); }
  get costume() { const c = this.t.getCostumes()[this.t.currentCostume]; return c ? c.name : ''; }
  set costume(v) {
    const list = this.t.getCostumes();
    const i = typeof v === 'number' ? v - 1 : list.findIndex(c => c.name === String(v));
    if (i >= 0 && i < list.length) this.t.setCostume(i);
  }
  get ghost() { return this.t.effects.ghost; } set ghost(v) { this.t.setEffect('ghost', +v); }
  goTo(x, y) { this.t.setXY(+x, +y); }
  move(steps) { const a = (90 - this.t.direction) * D2R; this.t.setXY(this.t.x + Math.cos(a) * steps, this.t.y + Math.sin(a) * steps); }
  turn(deg) { this.t.setDirection(this.t.direction + +deg); }
  pointTowards(x, y) { this.t.setDirection(90 - Math.atan2(y - this.t.y, x - this.t.x) / D2R); }
  say(text, seconds) {
    const t = this.t, rt = state.runtime;
    rt.emit('SAY', t, 'say', text == null ? '' : show(text));
    if (seconds) setTimeout(() => rt.emit('SAY', t, 'say', ''), seconds * 1000);
  }
  touching(what = 'anything') {
    const w = String(what).toLowerCase();
    if (w === 'edge' || w === 'bord') return this.t.isTouchingEdge();
    if (w === 'mouse' || w === 'souris') return this.t.isTouchingObject('_mouse_');
    if (w === 'anything' || w === 'tout') return state.runtime.targets.some(o => o !== this.t && o.isOriginal && !o.isStage && this.t.isTouchingSprite(o.getName()));
    return this.t.isTouchingSprite(String(what));
  }
  distanceTo(name) { const o = Maxy.find(name); return o ? Math.hypot(o.x - this.x, o.y - this.y) : Infinity; }
}

/** Objet 3D : un objet three.js du monde de MaxyStudio. */
class Object3D {
  constructor(obj) { this.o = obj; }
  get W() { return window.__sc3d; }
  get name() { return this.o.name; }
  get object3D() { return this.o; }
  get position() { return this.o.position; }
  get rotation() { return this.o.rotation; }
  get scale() { return this.o.scale; }
  get x() { return this.o.position.x; } set x(v) { this.o.position.x = +v; }
  get y() { return this.o.position.y; } set y(v) { this.o.position.y = +v; }
  get z() { return this.o.position.z; } set z(v) { this.o.position.z = +v; }
  get visible() { return this.o.visible; } set visible(v) { this.o.visible = !!v; }
  get body() { return this.W.bodies.get(this.o) || null; }
  get velocity() { const b = this.body; return b ? b.v : null; }
  get onGround() { const b = this.body; return !!(b && b.grounded); }
  /** Déplace l'objet en tenant compte des collisions (comme les blocs de mouvement). */
  move(dx, dy = 0, dz = 0) { const v = this.o.position.clone().set(+dx, +dy, +dz); this.W.api.move(this.o, v, this.body); }
  moveForward(d) {
    const v = this.o.position.clone().set(0, 0, 1).applyQuaternion(this.o.quaternion);
    v.y = 0; if (v.lengthSq() < 1e-9) return; v.normalize().multiplyScalar(+d);
    this.W.api.move(this.o, v, this.body);
  }
  rotate(x = 0, y = 0, z = 0) { this.o.rotation.x += x * D2R; this.o.rotation.y += y * D2R; this.o.rotation.z += z * D2R; }
  lookAt(a, y, z) {
    if (typeof a === 'string') { const t = Maxy.find(a); if (t && t.o) this.o.lookAt(t.o.getWorldPosition(this.o.position.clone())); }
    else this.o.lookAt(+a, +y, +z);
  }
  physics(on = true) { this.W.api.physics(this.o, !!on); }
  jump(force = 6) { const b = this.body; if (b && b.grounded) { b.v.y = +force; b.grounded = false; } }
  setColor(c) {
    this.o.traverse(m => {
      if (!m.isMesh || !m.material || !m.material.color) return;
      if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; }
      m.material.color.set(c);
    });
  }
  playAnimation(name, once = false) { this.W.api.playAnim(this.o, name, once); }
  touching(name = 'anything') { return this.W.api.touching(this.o, name); }
  distanceTo(name) { const t = Maxy.find(name); return t && t.o ? this.o.getWorldPosition(this.o.position.clone()).distanceTo(t.o.getWorldPosition(this.o.position.clone())) : Infinity; }
  destroy() { this.W.api.remove(this.o); }
}

/** La Scène (script du monde ou de l'arrière-plan). */
class StageHandle {
  constructor(target) { this.t = target; }
  get name() { return 'Scène'; }
}

// ---------- Classe de base des scripts ----------
class Script {
  get name() { return this.$.name; }
  get object() { return this.$; }
  log(...a) { print(a.map(show).join(' '), 'log', this.$.name); }
}
// Raccourcis : this.x, this.move(), this.say()… renvoient vers l'objet du script
for (const C of [Sprite2D, Object3D]) {
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(C.prototype))) {
    if (k === 'constructor' || k in Script.prototype) continue;
    if (d.get || d.set) Object.defineProperty(Script.prototype, k, { configurable: true, get() { return this.$[k]; }, set(v) { this.$[k] = v; } });
    else if (typeof d.value === 'function') Object.defineProperty(Script.prototype, k, { configurable: true, writable: true, value(...a) { const f = this.$[k]; if (typeof f !== 'function') throw new Error(`${k}() n'existe pas pour ${this.$.name}`); return f.apply(this.$, a); } });
  }
}
Script.prototype.playClip = function (clip, once = false) { const a = window.__maxyAnim; if (a) return a.play(this.$.name, clip, once); };
Script.prototype.stopClip = function () { const a = window.__maxyAnim; if (a) a.stop(this.$.name); };

// ---------- API globale Maxy ----------
function stage() { return state.runtime.getTargetForStage(); }
const vars = new Proxy({}, {
  get(_o, name) {
    if (typeof name !== 'string' || !state) return undefined;
    const st = stage();
    const v = Object.values(st.variables).find(x => x.name === name && (x.type === '' || x.type === 'list'));
    return v ? v.value : undefined;
  },
  set(_o, name, value) {
    if (!state) return true;
    const st = stage();
    const list = Array.isArray(value);
    let v = Object.values(st.variables).find(x => x.name === name && x.type === (list ? 'list' : ''));
    if (!v) { st.createVariable(`maxyjs_${list ? 'l' : 'v'}_${name}`, name, list ? 'list' : ''); v = Object.values(st.variables).find(x => x.name === name && x.type === (list ? 'list' : '')); }
    if (v) v.value = list ? value.slice() : value;
    return true;
  },
  has(_o, name) { return state ? Object.values(stage().variables).some(x => x.name === name) : false; },
  ownKeys() { return state ? Object.values(stage().variables).filter(x => !x.name.startsWith('_')).map(x => x.name) : []; },
  getOwnPropertyDescriptor(_o, name) { return state && Object.values(stage().variables).some(x => x.name === name) ? { enumerable: true, configurable: true, value: vars[name] } : undefined; }
});
const Maxy = {
  Script,
  vars,
  get dt() { return state ? state.dt : 0; },
  get time() { return state ? (performance.now() - state.t0) / 1000 : 0; },
  get frame() { return state ? state.frame : 0; },
  get scene() { return window.__maxySceneName || ''; },
  get is3D() { return !!(state && state.is3d); },
  get world() { return window.__sc3d || null; },
  THREE: null,
  key(k) { return keys.has(norm(k)); },
  keyPressed(k) { return pressed.has(norm(k)); },
  axis(name) {
    const k = c => (keys.has(c) ? 1 : 0);
    const v = name === 'vertical'
      ? (k('w') || k('z') || k('arrowup')) - (k('s') || k('arrowdown')) - pad(1)
      : (k('d') || k('arrowright')) - (k('a') || k('q') || k('arrowleft')) + pad(0);
    return Math.max(-1, Math.min(1, v));
  },
  get mouse() {
    const m = state && state.runtime.ioDevices.mouse;
    return m ? { x: m.getScratchX(), y: m.getScratchY(), down: m.getIsDown() } : { x: 0, y: 0, down: false };
  },
  find(name) {
    if (!state) return null;
    if (state.is3d) {
      const W = window.__sc3d; if (!W) return null;
      for (const o of W.objects.values()) if (o.name === name && o.parent) return new Object3D(o);
      return null;
    }
    const t = state.runtime.getSpriteTargetByName(String(name));
    return t ? new Sprite2D(t) : null;
  },
  send(message, data) {
    if (!state) return;
    // Les scripts .js reçoivent le message par hat() (même chemin que les messages de MaxyCode)
    state.msgData = data;
    try { state.runtime.startHats('event_whenbroadcastreceived', { BROADCAST_OPTION: String(message) }); }
    finally { state.msgData = undefined; }
  },
  ui(name) {
    const get = () => (window.__maxyUi ? window.__maxyUi.get(name) : null);
    return {
      get text() { const e = get(); return e ? e.textContent : ''; },
      set text(v) { const e = get(); if (e && e.dataset.ui !== 'bar' && e.dataset.ui !== 'image') e.textContent = show(v); },
      set value(v) { const e = get(); const f = e && e.dataset.ui === 'bar' && e.firstChild; if (f) f.style.width = Math.max(0, Math.min(100, +v)) + '%'; },
      show() { const e = get(); if (e) e.style.display = e.dataset.ui ? 'flex' : ''; },
      hide() { const e = get(); if (e) e.style.display = 'none'; }
    };
  },
  goToScene(name) { const g = window.__maxyGoToScene; if (typeof g === 'function') setTimeout(() => g(String(name)), 0); },
  random(a = 0, b = 1) { return Number.isInteger(a) && Number.isInteger(b) ? a + Math.floor(Math.random() * (b - a + 1)) : a + Math.random() * (b - a); },
  wait(seconds) { return new Promise(r => setTimeout(r, Math.max(0, seconds) * 1000)); },
  log(...a) { print(a.map(show).join(' ')); },
  warn(...a) { print(a.map(show).join(' '), 'warn'); },
  error(...a) { print(a.map(show).join(' '), 'error'); }
};
window.Maxy = Maxy;

// ---------- Cycle de vie ----------
function where(e, rel) {
  const s = String(e && e.stack || '');
  const file = encodeURI(rel).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = s.match(new RegExp(file + '[^:\\s]*:(\\d+):(\\d+)'));
  return m ? `, ligne ${m[1]}` : '';
}
function fail(inst, what, e) {
  inst.__dead = true;
  print(`${inst.__rel}${where(e, inst.__rel)} : ${e && e.message || e} (dans ${what}). Ce script est arrêté.`, 'error', inst.__who);
}
function call(inst, fn, ...a) {
  if (inst.__dead || typeof inst[fn] !== 'function') return;
  try {
    const r = inst[fn](...a);
    if (r && typeof r.then === 'function') r.catch(e => fail(inst, fn + '()', e));
  } catch (e) { fail(inst, fn + '()', e); }
}
function tick(now) {
  if (!state || state.id !== session) return;
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - state.last) / 1000);
  state.last = now;
  if (!state.on || window.__scPaused) return;
  state.dt = dt; state.frame++;
  for (const i of state.list) call(i, 'update', dt);
  pressed.clear();
}

/** Lance les scripts .js de la scène (appelé par l'extension Interface au démarrage du jeu). */
export async function start({ runtime, project, base, bust = '' }) {
  const id = ++session;
  const sc = project.scene || {};
  const is3d = project.type === '3d';
  state = { id, runtime, is3d, list: [], on: true, dt: 0, frame: 0, t0: performance.now(), last: performance.now() };
  const jobs = [];
  const stageRel = is3d ? sc.worldScript : sc.stage && sc.stage.script;
  if (stageRel && /\.js$/i.test(stageRel)) jobs.push({ rel: stageRel, who: 'Scène', handle: () => new StageHandle(runtime.getTargetForStage()), target: runtime.getTargetForStage() });
  for (const o of sc.objects || []) {
    if (!o.script || !/\.js$/i.test(o.script)) continue;
    jobs.push({
      rel: o.script, who: o.name,
      handle: () => {
        if (!is3d) { const t = runtime.getSpriteTargetByName(o.name); return t ? new Sprite2D(t) : null; }
        const W = window.__sc3d;
        for (const ob of (W ? W.objects.values() : [])) if (ob.userData.id === o.id) return new Object3D(ob);
        return null;
      },
      target: () => runtime.getSpriteTargetByName(o.name)
    });
  }
  if (!jobs.length) return;
  if (is3d) {
    await new Promise(r => setTimeout(r, 0));
    const W = window.__sc3d;
    if (W) await W.ready;
    try { Maxy.THREE = (await import(new URL('/studio/sc3d-core.js', location.href).href)).THREE; } catch { /* sans 3D */ }
  }
  const modules = new Map();
  for (const j of jobs) {
    if (!modules.has(j.rel)) {
      const url = base + j.rel.split('/').map(encodeURIComponent).join('/') + bust;
      modules.set(j.rel, import(url).catch(e => { print(`${j.rel} : ${e.message || e}`, 'error', j.who); return null; }));
    }
  }
  for (const j of jobs) {
    const mod = await modules.get(j.rel);
    if (id !== session) return;
    if (!mod) continue;
    const C = mod.default;
    let inst;
    try {
      if (typeof C === 'function') inst = new C();
      else if (C && typeof C === 'object') inst = Object.assign(new Script(), C);
      else { print(`${j.rel} : le script doit exporter une classe (export default class extends Maxy.Script { … }).`, 'error', j.who); continue; }
    } catch (e) { print(`${j.rel}${where(e, j.rel)} : ${e.message || e}`, 'error', j.who); continue; }
    const h = j.handle();
    if (!h) { print(`${j.rel} : objet « ${j.who} » introuvable dans le jeu.`, 'error', j.who); continue; }
    Object.defineProperty(inst, '$', { value: h, enumerable: false });
    inst.__rel = j.rel; inst.__who = j.who; inst.__target = typeof j.target === 'function' ? j.target() : j.target;
    state.list.push(inst);
  }
  for (const i of state.list) call(i, 'start');
  requestAnimationFrame(t => { if (state && state.id === id) { state.last = t; tick(t); } });
}
export function stop() { if (state) state.on = false; }
/** Clic sur un objet ou message envoyé par MaxyCode : prévient les scripts .js concernés. */
export function hat(opcode, fields, target) {
  if (!state || !state.on) return;
  if (opcode === 'event_whenbroadcastreceived' && fields && fields.BROADCAST_OPTION != null) {
    const msg = String(fields.BROADCAST_OPTION);
    const data = state.msgData;
    for (const i of state.list) call(i, 'onMessage', msg, data);
  } else if ((opcode === 'event_whenthisspriteclicked' || opcode === 'sc3dengine_whenClicked') && target) {
    for (const i of state.list) if (i.__target === target) call(i, 'onClick');
  }
}
