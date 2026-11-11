// Extension « MaxyCode 3D » : les blocs 3D des projets de MaxyStudio.
// Chaque objet de la scène qui a un script est un lutin du même nom : « this object » désigne cet objet.
(function (Scratch) {
  'use strict';
  const vm = Scratch.vm;
  const runtime = vm.runtime;
  const Cast = Scratch.Cast;
  const BASE = new URL('/studio/', location.href).href;
  let core = null;
  const coreReady = Scratch.external.importModule(BASE + 'sc3d-core.js').then(m => (core = m));

  const W = {
    world: null, renderer: null, canvas: null, camera: null, defaultCam: null, objects: new Map(), bodies: new Map(), mixers: new Map(), terrains: new Set(),
    running: false, ready: Promise.resolve(), follow: null, fps: null, keys: new Set(), mdx: 0, mdy: 0, accX: 0, accY: 0, scriptDt: 1 / 30,
    lastStep: 0, hud: null, sounds: [], underMouse: '', gravity: 9.81, project: null
  };
  window.__sc3d = W;

  const project = () => window.__scProject || { type: '3d', scene: { objects: [] }, base: '' };
  const resolveUrl = rel => /^(https?|app|data|blob):/.test(rel) ? rel : project().base + String(rel).split('/').map(encodeURIComponent).join('/');
  const print = (text, level = 'log', who = '') => runtime.emit('SC_PRINT', { text: String(text), level, who });

  // ---------- Entrées ----------
  addEventListener('keydown', e => W.keys.add(e.code));
  addEventListener('keyup', e => W.keys.delete(e.code));
  addEventListener('blur', () => W.keys.clear());
  addEventListener('mousemove', e => { if (document.pointerLockElement) { W.accX += e.movementX; W.accY += e.movementY; } });
  // Les blocs lisent le mouvement de la souris accumulé pendant la dernière image du moteur Scratch.
  const step = runtime._step;
  runtime._step = function () {
    const now = performance.now();
    W.scriptDt = W.lastStep ? Math.min(0.1, (now - W.lastStep) / 1000) : 1 / 30;
    W.lastStep = now;
    W.mdx = W.accX; W.mdy = W.accY; W.accX = 0; W.accY = 0;
    return step.call(this);
  };

  function gamepadAxis(i) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const v = pads.length ? pads[0].axes[i] || 0 : 0;
    return Math.abs(v) < 0.15 ? 0 : v;
  }
  function axis(name) {
    const k = c => W.keys.has(c) ? 1 : 0;
    let v;
    if (name === 'vertical') v = (k('KeyW') || k('ArrowUp')) - (k('KeyS') || k('ArrowDown')) - gamepadAxis(1);
    else v = (k('KeyD') || k('ArrowRight')) - (k('KeyA') || k('ArrowLeft')) + gamepadAxis(0);
    return Math.max(-1, Math.min(1, v));
  }

  // ---------- Monde ----------
  function stageBox() { return Scratch.renderer.canvas.parentElement; }
  function ensureCanvas() {
    if (W.canvas && W.canvas.isConnected) return;
    const THREE = core.THREE;
    W.canvas = document.createElement('canvas');
    W.canvas.className = 'sc3d-canvas';
    Object.assign(W.canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' });
    const box = stageBox();
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    box.appendChild(W.canvas);
    W.renderer = new THREE.WebGLRenderer({ canvas: W.canvas, antialias: true });
    W.renderer.shadowMap.enabled = true;
    W.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    W.renderer.outputColorSpace = THREE.SRGBColorSpace;
    W.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    box.addEventListener('mousedown', onPointerDown, true);
    box.addEventListener('mousemove', onPointerMove, true);
  }
  function pick(e) {
    if (!W.world) return null;
    const THREE = core.THREE;
    const r = W.canvas.getBoundingClientRect();
    // Souris capturée : on vise le centre de l'écran (le viseur)
    const ndc = document.pointerLockElement ? new THREE.Vector2(0, 0)
      : new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, W.camera);
    const hits = ray.intersectObjects([...W.objects.values()], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.def) o = o.parent;
      if (o && o.visible) return o;
    }
    return null;
  }
  function onPointerDown(e) {
    if (!W.running) return;
    const o = pick(e);
    if (!o) return;
    const t = runtime.targets.find(x => x.isOriginal && !x.isStage && x.getName() === o.name);
    if (t) runtime.startHats('sc3dengine_whenClicked', null, t);
  }
  function onPointerMove(e) { if (W.running) { const o = pick(e); W.underMouse = o ? o.name : ''; } }

  function register(obj) {
    W.objects.set(obj.userData.id, obj);
    const def = obj.userData.def;
    if (def.kind === 'terrain') W.terrains.add(obj);
    if (def.rigidbody && def.rigidbody.enabled) W.bodies.set(obj, { v: new core.THREE.Vector3(), grounded: false, gravity: +def.rigidbody.gravity || 1, bounce: +def.rigidbody.bounce || 0 });
  }

  async function startWorld() {
    await coreReady;
    const THREE = core.THREE;
    stopWorld();
    const p = project();
    W.project = p;
    if (p.type !== '3d') return;
    ensureCanvas();
    W.canvas.style.display = 'block';
    W.world = await core.buildWorld(p.scene || { objects: [] }, resolveUrl, { onError: m => print(m, 'error') });
    W.gravity = +(W.world.env.gravity ?? 9.81);
    for (const obj of W.world.byId.values()) {
      obj.traverse(o => { if (o.userData.def && o.userData.id) register(o); });
    }
    W.world.scene.traverse(o => {
      if (o.userData.animations && o.userData.animations.length) W.mixers.set(o, { mixer: new THREE.AnimationMixer(o), action: null });
    });
    const camObj = [...W.objects.values()].find(o => o.isCamera && o.userData.def.camera && o.userData.def.camera.main) || [...W.objects.values()].find(o => o.isCamera);
    W.defaultCam = new THREE.PerspectiveCamera(60, 4 / 3, 0.05, 2000);
    W.defaultCam.position.set(0, 4, 9);
    W.defaultCam.lookAt(0, 0, 0);
    W.camera = camObj || W.defaultCam;
    W.running = true;
    W.last = performance.now();
  }
  function stopWorld() {
    W.running = false;
    W.follow = null; W.fps = null;
    W.objects.clear(); W.bodies.clear(); W.terrains.clear();
    for (const m of W.mixers.values()) m.mixer.stopAllAction();
    W.mixers.clear();
    W.sounds.forEach(a => a.pause()); W.sounds = [];
    if (W.hud) W.hud.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }

  runtime.on('PROJECT_START', () => { W.ready = startWorld().catch(e => print('Erreur 3D : ' + (e.message || e), 'error')); });
  runtime.on('PROJECT_STOP_ALL', () => { W.running = false; W.sounds.forEach(a => a.pause()); if (document.pointerLockElement) document.exitPointerLock(); });

  // ---------- Physique simple (boîtes alignées) ----------
  const boxes = new Map();
  function collidersExcept(obj) {
    const out = [];
    for (const o of W.objects.values()) {
      if (o === obj || !o.visible || !o.userData.def.collider || o.userData.def.kind === 'terrain') continue;
      let p = o, related = false;
      while (p) { if (p === obj) { related = true; break; } p = p.parent; }
      p = obj; while (p) { if (p === o) { related = true; break; } p = p.parent; }
      if (related) continue;
      let b = boxes.get(o);
      if (!b) { b = core.worldBox(o); boxes.set(o, b); }
      if (!b.isEmpty()) out.push([o, b]);
    }
    return out;
  }
  // Déplace un objet axe par axe et le repousse hors des collisions. Retourne les axes bloqués.
  function moveWithCollision(obj, delta, body) {
    const blocked = { x: false, y: false, z: false };
    if (!obj.userData.def.collider) { obj.position.add(delta); return blocked; }
    const others = collidersExcept(obj);
    for (const ax of ['x', 'y', 'z']) {
      const d = delta[ax];
      if (!d) continue;
      // Un objet déjà chevauché avant ce mouvement (par exemple un cube qui tourne sous la balle)
      // ne repousse pas sur les côtés : sinon l'objet serait éjecté de plus en plus loin.
      const before = core.worldBox(obj);
      const overlapping = new Set(others.filter(([, b]) => before.intersectsBox(b)).map(([o]) => o));
      obj.position[ax] += d;
      const me = core.worldBox(obj);
      if (me.isEmpty()) continue;
      for (const [o, b] of others) {
        if (!me.intersectsBox(b)) continue;
        if (overlapping.has(o) && ax !== 'y') continue;
        if (overlapping.has(o) && d > 0) continue;
        const push = d > 0 ? b.min[ax] - me.max[ax] - 1e-4 : b.max[ax] - me.min[ax] + 1e-4;
        obj.position[ax] += push;
        me.min[ax] += push; me.max[ax] += push;
        blocked[ax] = true;
        if (body && ax === 'y' && d < 0) body.grounded = true;
      }
    }
    groundOnTerrain(obj, body, blocked);
    return blocked;
  }
  // Hauteur du sol des terrains sous un point (la plus haute), ou null
  function groundAt(x, z, except) {
    let best = null;
    for (const t of W.terrains) {
      if (t === except || !t.parent || !t.visible) continue;
      const h = core.terrainHeightWorld(t, x, z);
      if (h != null && (best == null || h > best)) best = h;
    }
    return best;
  }
  function groundOnTerrain(obj, body, blocked) {
    if (!W.terrains.size || W.terrains.has(obj)) return;
    const me = core.worldBox(obj);
    if (me.isEmpty()) return;
    const h = groundAt((me.min.x + me.max.x) / 2, (me.min.z + me.max.z) / 2, obj);
    if (h == null) return;
    if (me.min.y < h - 1e-4) {
      obj.position.y += h - me.min.y;
      blocked.y = true;
      if (body) body.grounded = true;
    } else if (body && me.min.y - h < 0.03 && body.v.y <= 0) body.grounded = true;
  }
  function simulate(dt) {
    boxes.clear();
    const THREE = core.THREE;
    for (const [obj, body] of W.bodies) {
      if (!obj.parent) continue;
      body.v.y -= W.gravity * body.gravity * dt;
      body.grounded = false;
      const blocked = moveWithCollision(obj, new THREE.Vector3().copy(body.v).multiplyScalar(dt), body);
      for (const ax of ['x', 'y', 'z']) if (blocked[ax]) body.v[ax] = -body.v[ax] * body.bounce;
      boxes.delete(obj);
    }
    for (const m of W.mixers.values()) m.mixer.update(dt);
    core.updateEffects(W.world.scene, dt, false);
    for (const o of W.objects.values()) {
      if (o.userData.def.temp && o.userData.fx && o.userData.fx.done) {
        o.parent && o.parent.remove(o);
        W.objects.delete(o.userData.id);
      }
    }
    updateCamera(dt);
  }
  function crosshair(show) {
    if (!W.cross) {
      if (!show) return;
      W.cross = document.createElement('div');
      W.cross.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 3v6M11 13v6M3 11h6M13 11h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="11" r="1.5" fill="#fff"/></svg>';
      Object.assign(W.cross.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: '3', pointerEvents: 'none', filter: 'drop-shadow(0 0 2px rgba(0,0,0,.6))' });
      stageBox().appendChild(W.cross);
    }
    W.cross.style.display = show ? 'block' : 'none';
  }
  function updateCamera(dt) {
    const THREE = core.THREE;
    crosshair(!!(W.fps && W.running && document.pointerLockElement));
    if (W.fps && W.fps.obj.parent) {
      const f = W.fps;
      if (document.pointerLockElement) {
        f.yaw -= W.mdx * 0.0025; f.pitch -= W.mdy * 0.0025;
        f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch));
        W.mdx = 0; W.mdy = 0;
      }
      f.obj.rotation.y = f.yaw;
      const p = new THREE.Vector3(); f.obj.getWorldPosition(p);
      W.camera = W.defaultCam;
      W.camera.position.set(p.x, p.y + f.eye, p.z);
      W.camera.rotation.set(f.pitch, f.yaw + Math.PI, 0, 'YXZ');
    } else if (W.follow && W.follow.obj.parent) {
      const f = W.follow;
      const p = new THREE.Vector3(); f.obj.getWorldPosition(p);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(f.obj.getWorldQuaternion(new THREE.Quaternion()));
      fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); fwd.normalize();
      const want = p.clone().addScaledVector(fwd, -f.dist).add(new THREE.Vector3(0, f.height, 0));
      W.camera = W.defaultCam;
      W.camera.position.lerp(want, Math.min(1, dt * 6));
      W.camera.lookAt(p.x, p.y + 1, p.z);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!W.world || !W.renderer) return;
    const dt = Math.min(0.05, (now - (W.last || now)) / 1000);
    W.last = now;
    if (W.running && !window.__scPaused) simulate(dt);
    render();
  }
  function render() {
    const c = W.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) W.renderer.setSize(w * dpr, h * dpr, false);
    if (W.camera.isPerspectiveCamera && Math.abs(W.camera.aspect - w / h) > 1e-3) { W.camera.aspect = w / h; W.camera.updateProjectionMatrix(); }
    W.renderer.render(W.world.scene, W.camera);
  }
  requestAnimationFrame(frame);
  // Pas à pas depuis l'éditeur (bouton « Image suivante »)
  W.stepOnce = () => { if (W.world) { simulate(1 / 30); render(); } };

  // ---------- API pour les scripts JavaScript (maxyjs.js) ----------
  W.api = {
    move: (o, v, body) => moveWithCollision(o, v, body),
    touching: (o, name) => touching(o, name),
    physics: (o, on) => { if (!on) W.bodies.delete(o); else if (!W.bodies.has(o)) W.bodies.set(o, { v: new core.THREE.Vector3(), grounded: false, gravity: 1, bounce: 0 }); },
    playAnim: (o, name, once) => playAnim(o, name, once),
    remove: o => { o.parent && o.parent.remove(o); W.objects.delete(o.userData.id); W.bodies.delete(o); W.mixers.delete(o); }
  };

  // ---------- Outils pour les blocs ----------
  function self(util) { return byName(util.target.getName()); }
  function byName(name) {
    name = Cast.toString(name);
    for (const o of W.objects.values()) if (o.name === name && o.parent) return o;
    const low = name.toLowerCase();
    for (const o of W.objects.values()) if (o.name.toLowerCase() === low && o.parent) return o;
    return null;
  }
  function target(name, util) {
    const n = Cast.toString(name).trim();
    return (!n || n === 'myself' || n === 'this object') ? self(util) : byName(n);
  }
  const num = v => Cast.toNumber(v);
  const deg = v => num(v) * Math.PI / 180;
  function withObj(name, util, fn) {
    const go = () => { const o = target(name, util); if (o) return fn(o); };
    return W.world ? go() : W.ready.then(go);
  }
  function addObject(def, util) {
    return W.ready.then(async () => {
      if (!W.world) return;
      def.collider = def.kind === 'particles' ? false : def.collider !== false;
      const obj = await core.buildObject(def, resolveUrl, { onError: m => print(m, 'error') });
      W.world.scene.add(obj);
      register(obj);
      if (obj.userData.animations && obj.userData.animations.length) W.mixers.set(obj, { mixer: new core.THREE.AnimationMixer(obj), action: null });
    });
  }
  function playAnim(obj, name, once) {
    const m = W.mixers.get(obj);
    if (!m) return;
    const clips = obj.userData.animations;
    const n = Cast.toString(name).toLowerCase();
    const clip = clips.find(c => c.name.toLowerCase() === n) || clips.find(c => c.name.toLowerCase().includes(n)) || clips[Math.max(0, Math.round(num(name)) - 1)] || clips[0];
    if (!clip) return;
    const act = m.mixer.clipAction(clip);
    if (m.action === act && !once && act.isRunning()) return;
    act.reset();
    act.setLoop(once ? core.THREE.LoopOnce : core.THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = !!once;
    if (m.action && m.action !== act) m.action.fadeOut(0.2);
    act.fadeIn(0.2).play();
    m.action = act;
  }
  function hud() {
    if (!W.hud) {
      W.hud = document.createElement('div');
      Object.assign(W.hud.style, { position: 'absolute', left: '50%', top: '6%', transform: 'translateX(-50%)', padding: '6px 14px', borderRadius: '8px', background: 'rgba(20,22,30,.62)', color: '#fff', font: '600 15px/1.35 system-ui,sans-serif', zIndex: '3', pointerEvents: 'none', textAlign: 'center', maxWidth: '86%' });
      stageBox().appendChild(W.hud);
    }
    return W.hud;
  }
  function touching(obj, name, util) {
    boxes.clear();
    const me = core.worldBox(obj).expandByScalar(0.03);
    if (me.isEmpty()) return false;
    const n = Cast.toString(name).trim().toLowerCase();
    for (const [o, b] of collidersExcept(obj)) {
      if ((n === 'anything' || n === 'any' || o.name.toLowerCase() === n) && me.intersectsBox(b)) return true;
    }
    for (const t of W.terrains) {
      if (t === obj || !t.visible || !t.userData.def.collider || !(n === 'anything' || n === 'any' || t.name.toLowerCase() === n)) continue;
      const h = core.terrainHeightWorld(t, (me.min.x + me.max.x) / 2, (me.min.z + me.max.z) / 2);
      if (h != null && me.min.y <= h + 0.06) return true;
    }
    return false;
  }
  const V = (x, y, z) => new core.THREE.Vector3(num(x), num(y), num(z));

  const OBJ = { type: Scratch.ArgumentType.STRING, defaultValue: 'myself' };
  const N = (v = 0) => ({ type: Scratch.ArgumentType.NUMBER, defaultValue: v });
  const S = (v = '') => ({ type: Scratch.ArgumentType.STRING, defaultValue: v });
  const XYZ = (x = 0, y = 0, z = 0) => ({ X: N(x), Y: N(y), Z: N(z) });
  const cmd = (opcode, text, args = {}) => ({ opcode, blockType: Scratch.BlockType.COMMAND, text, arguments: args });
  const rep = (opcode, text, args = {}) => ({ opcode, blockType: Scratch.BlockType.REPORTER, text, arguments: args, disableMonitor: true });
  const bool = (opcode, text, args = {}) => ({ opcode, blockType: Scratch.BlockType.BOOLEAN, text, arguments: args });

  class MaxyCode3D {
    getInfo() {
      return {
        id: 'sc3dengine', name: '3D', color1: '#3d7bd9', color2: '#2f63b3', color3: '#24508f',
        blocks: [
          cmd('setPosition', 'set position to x: [X] y: [Y] z: [Z]', XYZ()),
          cmd('changePosition', 'change position by x: [X] y: [Y] z: [Z]', XYZ(0, 0, 0)),
          cmd('moveForward', 'move forward [D]', { D: N(0.1) }),
          cmd('moveSideways', 'move sideways [D]', { D: N(0.1) }),
          cmd('rotateBy', 'rotate by x: [X] y: [Y] z: [Z] degrees', XYZ(0, 5, 0)),
          cmd('setRotation', 'set rotation to x: [X] y: [Y] z: [Z]', XYZ()),
          cmd('lookAtObject', 'look at object [OBJ]', { OBJ: S('Camera') }),
          cmd('lookAtPoint', 'look at x: [X] y: [Y] z: [Z]', XYZ()),
          cmd('setScale', 'set scale to x: [X] y: [Y] z: [Z]', XYZ(1, 1, 1)),
          rep('prop', '[PROP] of object [OBJ]', { PROP: { type: Scratch.ArgumentType.STRING, menu: 'props', defaultValue: 'x position' }, OBJ }),
          rep('distanceTo', 'distance to object [OBJ]', { OBJ: S('Camera') }),
          cmd('setColor', 'set color to [COLOR]', { COLOR: S('#ff6680') }),
          cmd('setOpacity', 'set opacity to [O] %', { O: N(100) }),
          cmd('setTexture', 'set texture to [ASSET]', { ASSET: S('assets/texture.png') }),
          cmd('showObject', 'show object [OBJ]', { OBJ }),
          cmd('hideObject', 'hide object [OBJ]', { OBJ }),
          cmd('playAnimOnce', 'play animation [NAME] once', { NAME: S('Jump') }),
          cmd('playAnim', 'play animation [NAME]', { NAME: S('Walk') }),
          cmd('stopAnim', 'stop animations'),
          rep('animNames', 'animations of this object'),
          cmd('createShape', 'create [SHAPE] named [NAME] at x: [X] y: [Y] z: [Z]', { SHAPE: { type: Scratch.ArgumentType.STRING, menu: 'shapes', defaultValue: 'cube' }, NAME: S('Cube 2'), ...XYZ(0, 3, 0) }),
          cmd('createModel', 'create model [ASSET] named [NAME] at x: [X] y: [Y] z: [Z]', { ASSET: S('assets/model.glb'), NAME: S('Modèle'), ...XYZ() }),
          cmd('cloneObject', 'clone object [OBJ] as [NAME]', { OBJ, NAME: S('Copie') }),
          cmd('deleteObject', 'delete object [OBJ]', { OBJ: S('Copie') }),
          bool('exists', 'object [OBJ] exists?', { OBJ: S('Copie') }),
          rep('myName', 'name of this object'),
          cmd('setPhysics', 'turn physics [ONOFF]', { ONOFF: { type: Scratch.ArgumentType.STRING, menu: 'onoff', defaultValue: 'on' } }),
          cmd('setVelocity', 'set velocity to x: [X] y: [Y] z: [Z]', XYZ()),
          cmd('changeVelocity', 'change velocity by x: [X] y: [Y] z: [Z]', XYZ(0, 5, 0)),
          cmd('jump', 'jump with force [F]', { F: N(6) }),
          cmd('setGravity', 'set world gravity to [G]', { G: N(9.81) }),
          bool('onGround', 'on ground?'),
          bool('touching', 'touching object [OBJ]?', { OBJ: S('anything') }),
          { opcode: 'whenTouch', blockType: Scratch.BlockType.HAT, isEdgeActivated: true, text: 'when this object touches [OBJ]', arguments: { OBJ: S('anything') } },
          rep('velocity', '[AXIS] velocity', { AXIS: { type: Scratch.ArgumentType.STRING, menu: 'axes3', defaultValue: 'y' } }),
          cmd('camFollow', 'camera follow [OBJ] distance [D] height [H]', { OBJ, D: N(6), H: N(3) }),
          cmd('camFps', 'first person camera on [OBJ] eye height [H]', { OBJ, H: N(1.6) }),
          cmd('camPos', 'set camera position to x: [X] y: [Y] z: [Z]', XYZ(0, 4, 9)),
          cmd('camLook', 'point camera at x: [X] y: [Y] z: [Z]', XYZ()),
          cmd('camFov', 'set camera field of view to [F]', { F: N(60) }),
          cmd('camFree', 'stop camera follow'),
          rep('axis', 'axis [AXIS]', { AXIS: { type: Scratch.ArgumentType.STRING, menu: 'axes', defaultValue: 'horizontal' } }),
          rep('mouseMove', 'mouse movement [XY]', { XY: { type: Scratch.ArgumentType.STRING, menu: 'xy', defaultValue: 'x' } }),
          cmd('lockMouse', 'lock mouse pointer'),
          cmd('unlockMouse', 'unlock mouse pointer'),
          { opcode: 'whenClicked', blockType: Scratch.BlockType.HAT, isEdgeActivated: false, text: 'when this object clicked' },
          rep('underMouse', 'object under mouse'),
          cmd('startParticles', 'start particles [OBJ]', { OBJ: S('Feu') }),
          cmd('stopParticles', 'stop particles [OBJ]', { OBJ: S('Feu') }),
          cmd('burstParticles', 'burst [N] particles from [OBJ]', { N: N(30), OBJ: S('Feu') }),
          cmd('particleRate', 'set particle rate of [OBJ] to [N]', { OBJ: S('Feu'), N: N(50) }),
          cmd('createEffect', 'create effect [EFFECT] named [NAME] at x: [X] y: [Y] z: [Z]', { EFFECT: { type: Scratch.ArgumentType.STRING, menu: 'effects', defaultValue: 'explosion' }, NAME: S('Effet'), ...XYZ(0, 1, 0) }),
          rep('terrainHeight', 'terrain height at x: [X] z: [Z]', { X: N(0), Z: N(0) }),
          cmd('sky', 'set sky colors top [TOP] bottom [BOTTOM]', { TOP: S('#5d9fe8'), BOTTOM: S('#dcecfb') }),
          cmd('fog', 'set fog from [NEAR] to [FAR]', { NEAR: N(20), FAR: N(90) }),
          cmd('fogOff', 'remove fog'),
          cmd('sun', 'set sun brightness to [B]', { B: N(1.6) }),
          cmd('ambient', 'set ambient light to [B]', { B: N(0.55) }),
          cmd('message', 'show message [TEXT]', { TEXT: S('Bienvenue !') }),
          cmd('hideMessage', 'hide message'),
          cmd('playFile', 'play sound file [ASSET]', { ASSET: S('assets/son.mp3') }),
          cmd('stopFiles', 'stop sound files'),
          rep('deltaTime', 'delta time'),
          cmd('print', 'print [TEXT]', { TEXT: S('Bonjour') })
        ],
        menus: {
          props: { acceptReporters: false, items: ['x position', 'y position', 'z position', 'x rotation', 'y rotation', 'z rotation', 'x scale', 'y scale', 'z scale'] },
          shapes: { acceptReporters: false, items: ['cube', 'sphere', 'cylinder', 'cone', 'capsule', 'plane', 'torus'] },
          onoff: { acceptReporters: false, items: ['on', 'off'] },
          axes: { acceptReporters: false, items: ['horizontal', 'vertical'] },
          axes3: { acceptReporters: false, items: ['x', 'y', 'z'] },
          xy: { acceptReporters: false, items: ['x', 'y'] },
          effects: { acceptReporters: true, items: ['explosion', 'feu', 'fumee', 'etincelles', 'magie', 'poussiere', 'pluie', 'neige'] }
        }
      };
    }
    setPosition(a, u) { return withObj('', u, o => { o.position.copy(V(a.X, a.Y, a.Z)); const b = W.bodies.get(o); if (b) b.v.set(0, 0, 0); }); }
    changePosition(a, u) { return withObj('', u, o => moveWithCollision(o, V(a.X, a.Y, a.Z), W.bodies.get(o))); }
    moveForward(a, u) { return withObj('', u, o => { const d = new core.THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion); d.y = 0; d.normalize().multiplyScalar(num(a.D)); moveWithCollision(o, d, W.bodies.get(o)); }); }
    moveSideways(a, u) { return withObj('', u, o => { const d = new core.THREE.Vector3(-1, 0, 0).applyQuaternion(o.quaternion); d.y = 0; d.normalize().multiplyScalar(num(a.D)); moveWithCollision(o, d, W.bodies.get(o)); }); }
    rotateBy(a, u) { return withObj('', u, o => { o.rotation.x += deg(a.X); o.rotation.y += deg(a.Y); o.rotation.z += deg(a.Z); if (W.fps && W.fps.obj === o) W.fps.yaw = o.rotation.y; }); }
    setRotation(a, u) { return withObj('', u, o => { o.rotation.set(deg(a.X), deg(a.Y), deg(a.Z)); if (W.fps && W.fps.obj === o) W.fps.yaw = o.rotation.y; }); }
    lookAtObject(a, u) {
      return withObj('', u, o => {
        const t = target(a.OBJ, u); if (!t) return;
        const p = new core.THREE.Vector3(); t.getWorldPosition(p);
        o.lookAt(p);
      });
    }
    lookAtPoint(a, u) { return withObj('', u, o => o.lookAt(V(a.X, a.Y, a.Z))); }
    setScale(a, u) { return withObj('', u, o => o.scale.copy(V(a.X, a.Y, a.Z))); }
    prop(a, u) {
      return withObj(a.OBJ, u, o => {
        const [ax, kind] = Cast.toString(a.PROP).split(' ');
        const v = kind === 'rotation' ? o.rotation[ax] * 180 / Math.PI : kind === 'scale' ? o.scale[ax] : o.position[ax];
        return Math.round(v * 1000) / 1000;
      }) ?? 0;
    }
    distanceTo(a, u) {
      return withObj('', u, o => {
        const t = target(a.OBJ, u); if (!t) return 0;
        const p = new core.THREE.Vector3(), q = new core.THREE.Vector3();
        return Math.round(o.getWorldPosition(p).distanceTo(t.getWorldPosition(q)) * 1000) / 1000;
      }) ?? 0;
    }
    setColor(a, u) {
      return withObj('', u, o => o.traverse(m => {
        if (!m.isMesh || !m.material || !m.material.color) return;
        if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; }
        m.material.color.set(Cast.toString(a.COLOR));
      }));
    }
    setOpacity(a, u) {
      return withObj('', u, o => o.traverse(m => {
        if (!m.isMesh || !m.material) return;
        if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; }
        const op = Math.max(0, Math.min(100, num(a.O))) / 100;
        m.material.transparent = op < 1; m.material.opacity = op;
      }));
    }
    setTexture(a, u) {
      return withObj('', u, o => o.traverse(m => {
        if (!m.isMesh || !m.material) return;
        if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; }
        m.material.map = core.loadTexture(resolveUrl(Cast.toString(a.ASSET)));
        m.material.needsUpdate = true;
      }));
    }
    showObject(a, u) { return withObj(a.OBJ, u, o => { o.visible = true; }); }
    hideObject(a, u) { return withObj(a.OBJ, u, o => { o.visible = false; }); }
    playAnim(a, u) { return withObj('', u, o => playAnim(o, a.NAME, false)); }
    playAnimOnce(a, u) { return withObj('', u, o => playAnim(o, a.NAME, true)); }
    stopAnim(a, u) { return withObj('', u, o => { const m = W.mixers.get(o); if (m) { m.mixer.stopAllAction(); m.action = null; } }); }
    animNames(a, u) { return withObj('', u, o => (o.userData.animations || []).map(c => c.name).join(', ')) ?? ''; }
    createShape(a) {
      const shape = core && core.SHAPES.includes(a.SHAPE) ? a.SHAPE : 'cube';
      return coreReady.then(() => addObject(core.defaultObject(shape, Cast.toString(a.NAME), { position: [num(a.X), num(a.Y), num(a.Z)] })));
    }
    createModel(a) {
      return coreReady.then(() => addObject(core.defaultObject('model', Cast.toString(a.NAME), { model: Cast.toString(a.ASSET), position: [num(a.X), num(a.Y), num(a.Z)] })));
    }
    cloneObject(a, u) {
      return W.ready.then(() => {
        const o = target(a.OBJ, u); if (!o) return;
        const def = JSON.parse(JSON.stringify(o.userData.def));
        def.id = core.newId(); def.name = Cast.toString(a.NAME); def.parent = null;
        def.position = o.position.toArray(); def.rotation = [o.rotation.x, o.rotation.y, o.rotation.z].map(r => r * 180 / Math.PI); def.scale = o.scale.toArray();
        return addObject(def);
      });
    }
    deleteObject(a, u) {
      return withObj(a.OBJ, u, o => {
        o.parent && o.parent.remove(o);
        W.objects.delete(o.userData.id); W.bodies.delete(o); W.mixers.delete(o);
      });
    }
    exists(a, u) { return !!target(a.OBJ, u); }
    myName(a, u) { return u.target.getName(); }
    setPhysics(a, u) {
      return withObj('', u, o => {
        if (a.ONOFF === 'off') { W.bodies.delete(o); return; }
        if (!W.bodies.has(o)) W.bodies.set(o, { v: new core.THREE.Vector3(), grounded: false, gravity: 1, bounce: 0 });
      });
    }
    setVelocity(a, u) { return withObj('', u, o => { const b = W.bodies.get(o); if (b) b.v.copy(V(a.X, a.Y, a.Z)); }); }
    changeVelocity(a, u) { return withObj('', u, o => { const b = W.bodies.get(o); if (b) b.v.add(V(a.X, a.Y, a.Z)); }); }
    jump(a, u) { return withObj('', u, o => { const b = W.bodies.get(o); if (b && b.grounded) { b.v.y = num(a.F); b.grounded = false; } }); }
    setGravity(a) { W.gravity = num(a.G); }
    onGround(a, u) { const o = self(u); const b = o && W.bodies.get(o); return !!(b && b.grounded); }
    touching(a, u) { const o = self(u); return !!(o && touching(o, a.OBJ, u)); }
    whenTouch(a, u) { if (!W.running) return false; const o = self(u); return !!(o && touching(o, a.OBJ, u)); }
    velocity(a, u) { const o = self(u); const b = o && W.bodies.get(o); return b ? Math.round(b.v[a.AXIS] * 1000) / 1000 : 0; }
    camFollow(a, u) { return withObj(a.OBJ, u, o => { W.fps = null; W.follow = { obj: o, dist: num(a.D), height: num(a.H) }; if (W.camera !== W.defaultCam) W.defaultCam.position.copy(W.camera.position); }); }
    camFps(a, u) { return withObj(a.OBJ, u, o => { W.follow = null; W.fps = { obj: o, eye: num(a.H), yaw: o.rotation.y, pitch: 0 }; }); }
    camPos(a) { return W.ready.then(() => { if (!W.camera) return; W.follow = W.fps = null; W.camera.position.copy(V(a.X, a.Y, a.Z)); }); }
    camLook(a) { return W.ready.then(() => { if (!W.camera) return; W.follow = W.fps = null; W.camera.lookAt(V(a.X, a.Y, a.Z)); }); }
    camFov(a) {
      return W.ready.then(() => {
        for (const c of [W.camera, W.defaultCam]) if (c && c.isPerspectiveCamera) { c.fov = Math.max(10, Math.min(150, num(a.F))); c.updateProjectionMatrix(); }
      });
    }
    camFree() { W.follow = null; W.fps = null; }
    axis(a) { return axis(a.AXIS); }
    mouseMove(a) { return a.XY === 'y' ? -W.mdy : W.mdx; }
    lockMouse() { const c = Scratch.renderer.canvas; if (c.requestPointerLock && document.pointerLockElement !== c) c.requestPointerLock(); }
    unlockMouse() { if (document.pointerLockElement) document.exitPointerLock(); }
    whenClicked() { return true; }
    underMouse() { return W.underMouse; }
    sky(a) { return W.ready.then(() => { if (!W.world) return; core.applyEnvironment(W.world, { ...W.world.env, skyTop: Cast.toString(a.TOP), skyBottom: Cast.toString(a.BOTTOM) }); }); }
    fog(a) { return W.ready.then(() => { if (!W.world) return; core.applyEnvironment(W.world, { ...W.world.env, fog: { enabled: true, color: W.world.env.skyBottom, near: num(a.NEAR), far: num(a.FAR) } }); }); }
    fogOff() { return W.ready.then(() => { if (W.world) core.applyEnvironment(W.world, { ...W.world.env, fog: { ...W.world.env.fog, enabled: false } }); }); }
    sun(a) { return W.ready.then(() => { if (W.world) core.applyEnvironment(W.world, { ...W.world.env, sun: { ...W.world.env.sun, intensity: num(a.B) } }); }); }
    ambient(a) { return W.ready.then(() => { if (W.world) core.applyEnvironment(W.world, { ...W.world.env, ambient: num(a.B) }); }); }
    startParticles(a, u) { return withObj(a.OBJ, u, o => { const f = o.userData.fx; if (f) { f.playing = true; f.restart(); } }); }
    stopParticles(a, u) { return withObj(a.OBJ, u, o => { const f = o.userData.fx; if (f) f.playing = false; }); }
    burstParticles(a, u) { return withObj(a.OBJ, u, o => { const f = o.userData.fx; if (f) f.burst(Math.max(0, Math.min(3000, Math.round(num(a.N)))), o); }); }
    particleRate(a, u) { return withObj(a.OBJ, u, o => { const f = o.userData.fx; if (f) f.cfg.rate = Math.max(0, num(a.N)); }); }
    createEffect(a) {
      return coreReady.then(() => {
        const p = core.particlePreset(Cast.toString(a.EFFECT));
        const def = core.defaultObject('particles', Cast.toString(a.NAME) || 'Effet', { particles: p, position: [num(a.X), num(a.Y), num(a.Z)] });
        def.temp = p.loop === false;
        return addObject(def);
      });
    }
    terrainHeight(a) {
      const calc = () => { const h = groundAt(num(a.X), num(a.Z), null); return h == null ? 0 : Math.round(h * 1000) / 1000; };
      return W.world ? calc() : W.ready.then(calc);
    }
    message(a) { const h = hud(); h.textContent = Cast.toString(a.TEXT); h.style.display = h.textContent ? 'block' : 'none'; }
    hideMessage() { if (W.hud) W.hud.style.display = 'none'; }
    playFile(a) { const s = new Audio(resolveUrl(Cast.toString(a.ASSET))); W.sounds.push(s); s.play().catch(() => print('Son introuvable : ' + a.ASSET, 'error')); s.onended = () => { W.sounds = W.sounds.filter(x => x !== s); }; }
    stopFiles() { W.sounds.forEach(s => s.pause()); W.sounds = []; }
    deltaTime() { return Math.round(W.scriptDt * 10000) / 10000; }
    print(a, u) { print(Cast.toString(a.TEXT), 'log', u.target.getName()); }
  }
  // Comme les blocs de mouvement de Scratch, chaque commande demande un redessin :
  // une boucle « forever » ne fait alors qu'un tour par image au lieu de milliers.
  const ext = new MaxyCode3D();
  for (const b of ext.getInfo().blocks) {
    if (b.blockType !== Scratch.BlockType.COMMAND || typeof ext[b.opcode] !== 'function') continue;
    const fn = ext[b.opcode].bind(ext);
    ext[b.opcode] = (args, util) => { runtime.requestRedraw(); return fn(args, util); };
  }
  Scratch.extensions.register(ext);
})(Scratch);
