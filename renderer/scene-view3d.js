// Vue Scène 3D de l'éditeur : caméra libre, grille, gizmos, sélection et dépôt d'assets.
import * as core from './sc3d-core.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';

const { THREE } = core;
const R2D = 180 / Math.PI;

// Petite icône (lumière, caméra, objet vide) visible et cliquable dans la vue Scène.
function iconSprite(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = kind === 'light' ? '#ffd47a' : kind === 'camera' ? '#8bc1ff' : kind === 'particles' ? '#ff9f4a' : '#c8ccd4';
  g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4;
  g.beginPath();
  if (kind === 'camera') { g.roundRect(8, 18, 34, 28, 6); g.moveTo(42, 32); g.lineTo(56, 22); g.lineTo(56, 42); g.closePath(); }
  else if (kind === 'light') { g.arc(32, 28, 16, 0, Math.PI * 2); g.rect(25, 44, 14, 10); }
  else if (kind === 'particles') { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 9 : 22; g[i ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath(); }
  else { g.arc(32, 32, 12, 0, Math.PI * 2); }
  g.stroke(); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.7, 0.7, 0.7);
  s.renderOrder = 10;
  s.userData.isIcon = true;
  return s;
}

export class SceneView3D {
  constructor(container, opts) {
    this.el = container;
    this.opts = opts;
    this.world = null;
    this.selected = null;
    this.tool = 'translate';
    this.snap = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 3000);
    this.camera.position.set(7, 6, 10);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.18;
    this.orbit.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.target.set(0, 0.5, 0);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value;
      if (e.value) this.opts.onBeforeChange && this.opts.onBeforeChange();
      else this.commitTransform();
    });
    this.gizmo.addEventListener('objectChange', () => this.opts.onLiveTransform && this.selected && this.opts.onLiveTransform(this.defOf(this.selected)));
    this.helperRoot = new THREE.Group();
    this.grid = new THREE.GridHelper(200, 200, 0x5a5d66, 0x3a3c42);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.55;
    this.helperRoot.add(this.grid);
    this.box = new THREE.Box3Helper(new THREE.Box3(), 0xffa733);
    this.box.visible = false;
    this.helperRoot.add(this.box);
    // Cercle du pinceau de sculpture du terrain
    this.brush = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffa733, transparent: true, opacity: 0.9, depthTest: false }));
    this.brush.renderOrder = 20; this.brush.visible = false;
    this.helperRoot.add(this.brush);
    this.sculpt = null; this.stroke = null; this.hover = null;
    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    this.viewHelper.center = this.orbit.target;

    this.keys = new Set();
    this.bindInput();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.clock = new THREE.Clock();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  async load(sceneDef) {
    const world = await core.buildWorld(sceneDef, this.opts.resolveUrl, { onError: m => this.opts.onError && this.opts.onError(m) });
    if (this.world) this.world.scene.remove(this.helperRoot, this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);
    this.world = world;
    world.scene.add(this.helperRoot);
    world.scene.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);
    for (const obj of world.byId.values()) this.decorate(obj);
    if (this.selected) this.select(this.selected.userData.id);
  }

  decorate(obj) {
    const def = obj.userData.def;
    if (def.kind === 'light' || def.kind === 'camera' || def.kind === 'empty' || def.kind === 'particles') {
      const ic = iconSprite(def.kind);
      ic.userData.owner = obj;
      obj.add(ic);
      if (def.kind === 'camera') {
        const helper = new THREE.CameraHelper(new THREE.PerspectiveCamera(def.camera ? +def.camera.fov || 60 : 60, 4 / 3, 0.3, 2));
        helper.userData.isIcon = true;
        obj.add(helper);
        helper.camera.position.set(0, 0, 0);
        helper.matrixAutoUpdate = true;
        helper.update();
      }
    }
  }

  defOf(obj) { return obj && obj.userData.def; }
  objById(id) { return this.world ? this.world.byId.get(id) : null; }

  // Reconstruit un objet après une modification dans l'inspecteur.
  async updateObject(def) {
    if (!this.world) return;
    const old = this.world.byId.get(def.id);
    const obj = await core.buildObject(def, this.opts.resolveUrl, { onError: m => this.opts.onError && this.opts.onError(m) });
    this.decorate(obj);
    const parent = def.parent ? this.world.byId.get(def.parent) : this.world.scene;
    if (old) {
      for (const ch of [...old.children]) if (ch.userData.id) obj.add(ch);
      old.parent && old.parent.remove(old);
    }
    (parent || this.world.scene).add(obj);
    this.world.byId.set(def.id, obj);
    if (this.selected === old || (this.selected && this.selected.userData.id === def.id)) this.select(def.id);
  }
  // Mise à jour rapide de la seule transformation (pendant qu'on fait glisser une valeur).
  setTransform(def) {
    const o = this.objById(def.id);
    if (o) core.applyTransform(o, def);
  }
  async addObject(def) { await this.updateObject(def); }
  removeObject(id) {
    const o = this.objById(id);
    if (!o) return;
    if (this.selected === o) this.select(null);
    o.parent && o.parent.remove(o);
    this.world.byId.delete(id);
  }
  setEnvironment(env) { if (this.world) core.applyEnvironment(this.world, env); }

  select(id) {
    const o = id ? this.objById(id) : null;
    this.selected = o;
    if (o) { this.gizmo.attach(o); this.applyTool(); }
    else this.gizmo.detach();
  }
  setTool(t) { this.tool = t; this.applyTool(); }
  /** Sculpture du terrain sélectionné : { tool: raise|lower|smooth|flatten, radius, strength } ou null. */
  setSculpt(s) { this.sculpt = s; if (!s) { this.brush.visible = false; this.stroke = null; } this.applyTool(); }
  sculptTarget() { return this.sculpt && this.selected && this.selected.userData.def.kind === 'terrain' ? this.selected : null; }
  terrainHit(clientX, clientY) {
    const t = this.sculptTarget();
    if (!t) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const h = ray.intersectObject(t, false)[0];
    return h ? h.point : null;
  }
  applyBrush(dt) {
    const obj = this.sculptTarget();
    if (!obj || !this.stroke || !this.hover) return;
    const def = obj.userData.def, t = def.terrain, H = core.terrainHeights(t);
    const res = Math.round(Math.sqrt(H.length)) - 1, N = res + 1, size = +t.size || 60, step = size / res;
    const local = obj.worldToLocal(this.hover.clone());
    const r = Math.max(0.2, this.sculpt.radius / (Math.abs(obj.scale.x) || 1));
    const ci = (local.x / size + 0.5) * res, cj = (local.z / size + 0.5) * res, rc = r / step;
    const k = (this.sculpt.strength || 1) * dt, tool = this.sculpt.tool;
    for (let j = Math.max(0, Math.floor(cj - rc)); j <= Math.min(res, Math.ceil(cj + rc)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rc)); i <= Math.min(res, Math.ceil(ci + rc)); i++) {
        const d = Math.hypot((i - ci) * step, (j - cj) * step);
        if (d > r) continue;
        const w = 0.5 + 0.5 * Math.cos(Math.PI * d / r), q = j * N + i;
        if (tool === 'raise') H[q] += 4 * k * w;
        else if (tool === 'lower') H[q] -= 4 * k * w;
        else if (tool === 'flatten') H[q] += (this.stroke.flat - H[q]) * Math.min(1, 6 * k * w);
        else if (tool === 'smooth') {
          const avg = (H[j * N + Math.max(0, i - 1)] + H[j * N + Math.min(res, i + 1)] + H[Math.max(0, j - 1) * N + i] + H[Math.min(res, j + 1) * N + i]) / 4;
          H[q] += (avg - H[q]) * Math.min(1, 8 * k * w);
        }
      }
    }
    core.refreshTerrainGeometry(obj.geometry, t);
  }
  applyTool() {
    if (this.sculptTarget()) { this.gizmo.enabled = false; if (this.gizmo.getHelper) this.gizmo.getHelper().visible = false; else this.gizmo.visible = false; return; }
    if (!this.selected || this.tool === 'hand') { this.gizmo.enabled = false; if (this.gizmo.getHelper) this.gizmo.getHelper().visible = false; else this.gizmo.visible = false; return; }
    this.gizmo.enabled = true;
    if (this.gizmo.getHelper) this.gizmo.getHelper().visible = true; else this.gizmo.visible = true;
    this.gizmo.setMode(this.tool);
  }
  setSpace(space) { this.gizmo.setSpace(space); }
  setGrid(on) { this.grid.visible = on; }

  commitTransform() {
    const o = this.selected;
    if (!o) return;
    const def = o.userData.def;
    def.position = o.position.toArray().map(v => +v.toFixed(4));
    def.rotation = [o.rotation.x, o.rotation.y, o.rotation.z].map(r => +(r * R2D).toFixed(3));
    def.scale = o.scale.toArray().map(v => +v.toFixed(4));
    this.opts.onChange && this.opts.onChange(def);
  }

  focus(id) {
    const o = id ? this.objById(id) : this.selected;
    if (!o) return;
    const b = core.worldBox(o);
    const center = new THREE.Vector3(), size = new THREE.Vector3();
    if (b.isEmpty()) o.getWorldPosition(center), size.set(2, 2, 2);
    else b.getCenter(center), b.getSize(size);
    const r = Math.max(1, size.length());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, r * 1.4 + 1);
  }

  fit() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    if (!this.world || !this.el.offsetParent) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fly(dt);
    if (this.viewHelper.animating) this.viewHelper.update(dt);
    this.orbit.update();
    core.updateEffects(this.world.scene, dt, true);
    if (this.stroke) this.applyBrush(dt);
    if (this.sculptTarget() && this.hover) {
      this.brush.visible = true;
      this.brush.position.copy(this.hover).add(new THREE.Vector3(0, 0.05, 0));
      this.brush.scale.setScalar(this.sculpt.radius);
    } else this.brush.visible = false;
    if (this.selected && !this.sculptTarget()) { this.box.box.copy(core.worldBox(this.selected)); this.box.visible = !this.box.box.isEmpty(); }
    else this.box.visible = false;
    const r = this.renderer;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    r.setViewport(0, 0, w, h); r.setScissorTest(false);
    r.clear();
    const icons = [];
    this.world.scene.traverse(o => { if (o.userData.isIcon) icons.push(o); });
    icons.forEach(o => { o.visible = true; });
    r.render(this.world.scene, this.camera);
    this.viewHelper.render(r);
    // Aperçu de la caméra sélectionnée, comme dans Unity
    const cam = this.selected && this.selected.isCamera ? this.selected : null;
    if (cam) {
      const pw = Math.round(w * 0.28), ph = Math.round(pw * 3 / 4);
      cam.aspect = 4 / 3; cam.updateProjectionMatrix();
      icons.forEach(o => { o.visible = false; });
      const gh = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
      const vis = [this.grid.visible, this.box.visible, gh.visible];
      this.grid.visible = this.box.visible = gh.visible = false;
      r.setScissorTest(true);
      r.setViewport(12, 12, pw, ph); r.setScissor(12, 12, pw, ph);
      r.clear();
      r.render(this.world.scene, cam);
      r.setScissorTest(false);
      [this.grid.visible, this.box.visible, gh.visible] = vis;
      icons.forEach(o => { o.visible = true; });
    }
  }

  // Déplacement façon Unity : clic droit maintenu + ZQSD/WASD, A/E pour monter et descendre.
  fly(dt) {
    if (!this.rmb || !this.keys.size) return;
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 18 : 6) * dt;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const mv = new THREE.Vector3();
    if (this.keys.has('KeyW')) mv.add(fwd);
    if (this.keys.has('KeyS')) mv.sub(fwd);
    if (this.keys.has('KeyD')) mv.add(right);
    if (this.keys.has('KeyA')) mv.sub(right);
    if (this.keys.has('KeyE')) mv.y += 1;
    if (this.keys.has('KeyQ')) mv.y -= 1;
    if (!mv.lengthSq()) return;
    mv.normalize().multiplyScalar(speed);
    this.camera.position.add(mv);
    this.orbit.target.add(mv);
  }

  pickAt(clientX, clientY) {
    if (!this.world) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = [...this.world.byId.values()];
    const hits = ray.intersectObjects(targets, true).filter(h => !(h.object.isLine || h.object.isPoints || h.object.type === 'CameraHelper' || (h.object.parent && h.object.parent === this.brush)));
    for (const h of hits) {
      let o = h.object.userData.owner || h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o) return { obj: o, point: h.point };
    }
    return { obj: null, point: ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) };
  }

  bindInput() {
    const c = this.renderer.domElement;
    let down = null;
    c.addEventListener('pointerdown', e => {
      c.focus();
      if (e.button === 2) this.rmb = true;
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this.sculptTarget()) {
        const p = this.terrainHit(e.clientX, e.clientY);
        if (p) {
          const obj = this.sculptTarget();
          const lp = obj.worldToLocal(p.clone());
          this.opts.onBeforeChange && this.opts.onBeforeChange();
          this.hover = p;
          this.stroke = { flat: core.terrainHeightLocal(obj.userData.def.terrain, lp.x, lp.z) ?? 0 };
          down = null;
          c.setPointerCapture(e.pointerId);
        }
      }
    });
    c.addEventListener('pointermove', e => { if (this.sculptTarget()) this.hover = this.terrainHit(e.clientX, e.clientY) || (this.stroke ? this.hover : null); });
    c.addEventListener('pointerleave', () => { if (!this.stroke) this.hover = null; });
    addEventListener('pointerup', e => {
      if (e.button === 2) this.rmb = false;
      if (e.button === 0 && this.stroke) {
        this.stroke = null;
        const obj = this.sculptTarget();
        if (obj) {
          const t = obj.userData.def.terrain;
          core.setTerrainHeights(t, core.terrainHeights(t));
          this.opts.onChange && this.opts.onChange(obj.userData.def);
        }
        return;
      }
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved || this.gizmo.dragging || e.target !== c) return;
      if (this.gizmo.axis) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      this.opts.onSelect && this.opts.onSelect(hit && hit.obj ? hit.obj.userData.id : null);
    });
    c.addEventListener('pointerdown', e => { if (e.button === 0 && this.viewHelper.handleClick(e)) down = null; });
    c.addEventListener('dblclick', () => this.focus());
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('keydown', e => { this.keys.add(e.code); if (e.key === 'Control') this.setSnap(true); });
    c.addEventListener('keyup', e => { this.keys.delete(e.code); if (e.key === 'Control') this.setSnap(this.snap); });
    c.addEventListener('blur', () => { this.keys.clear(); this.rmb = false; });
    // Dépôt d'un asset du panneau Projet
    c.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/sc-asset')) { e.preventDefault(); this.el.classList.add('drop'); } });
    c.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    c.addEventListener('drop', e => {
      this.el.classList.remove('drop');
      const rel = e.dataTransfer.getData('text/sc-asset');
      if (!rel) return;
      e.preventDefault();
      const hit = this.pickAt(e.clientX, e.clientY);
      this.opts.onDropAsset && this.opts.onDropAsset(rel, hit && hit.point ? hit.point.toArray() : [0, 0, 0], hit && hit.obj ? hit.obj.userData.id : null);
    });
  }
  setSnap(on) {
    const s = on || this.snap;
    this.gizmo.setTranslationSnap(s ? 0.5 : null);
    this.gizmo.setRotationSnap(s ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(s ? 0.1 : null);
  }
  setSnapMode(on) { this.snap = on; this.setSnap(on); }
}
