// ScratchCode 3D : code partagé entre la vue Scène de l'éditeur et le moteur de jeu.
// Une scène est un fichier JSON (scenes/*.scene) : { environment, objects: [...] }.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export { THREE };

export const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
export const SOUND_EXT = ['mp3', 'wav', 'ogg', 'm4a'];
export const SHAPES = ['cube', 'sphere', 'cylinder', 'cone', 'capsule', 'plane', 'torus'];
export const SHAPE_NAMES = { cube: 'Cube', sphere: 'Sphère', cylinder: 'Cylindre', cone: 'Cône', capsule: 'Capsule', plane: 'Plan', torus: 'Tore' };
export const extOf = p => String(p).split('.').pop().toLowerCase();

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultEnvironment() {
  return {
    skyTop: '#5d9fe8', skyBottom: '#dcecfb', ambient: 0.55,
    sun: { color: '#fff6e5', intensity: 1.6, direction: [-0.6, -1, -0.4], shadows: true },
    fog: { enabled: false, color: '#dcecfb', near: 40, far: 160 },
    gravity: 9.81
  };
}

export function defaultObject(kind, name, extra = {}) {
  const o = {
    id: newId(), name: name || kind, kind, parent: null, active: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], script: '', collider: !['light', 'camera', 'empty', 'particles'].includes(kind),
    rigidbody: { enabled: false, gravity: 1, bounce: 0 }
  };
  if (SHAPES.includes(kind)) o.mesh = { color: '#c9ccd4', texture: '', opacity: 1, metalness: 0, roughness: 0.75, castShadow: true, receiveShadow: true };
  if (kind === 'model') o.model = '';
  if (kind === 'light') o.light = { type: 'point', color: '#ffffff', intensity: 2, range: 12 };
  if (kind === 'camera') o.camera = { fov: 60, main: true };
  if (kind === 'plane') o.scale = [10, 1, 10];
  if (kind === 'terrain') { o.terrain = defaultTerrain(); generateTerrain(o.terrain); }
  if (kind === 'particles') o.particles = particlePreset('feu');
  return Object.assign(o, extra);
}

const geoCache = new Map();
export function geometryFor(shape) {
  if (geoCache.has(shape)) return geoCache.get(shape);
  let g;
  switch (shape) {
    case 'sphere': g = new THREE.SphereGeometry(0.5, 32, 20); break;
    case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
    case 'cone': g = new THREE.ConeGeometry(0.5, 1, 32); break;
    case 'capsule': g = new THREE.CapsuleGeometry(0.5, 1, 8, 20); break;
    case 'plane': g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); break;
    case 'torus': g = new THREE.TorusGeometry(0.4, 0.15, 16, 40); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  geoCache.set(shape, g);
  return g;
}

const texLoader = new THREE.TextureLoader();
const texCache = new Map();
export function loadTexture(url) {
  if (!url) return null;
  if (!texCache.has(url)) {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(url, t);
  }
  return texCache.get(url);
}

// Les modèles sont chargés une fois puis clonés (SkeletonUtils garde les squelettes animés).
const modelCache = new Map();
function loadModelSource(url) {
  if (modelCache.has(url)) return modelCache.get(url);
  const ext = extOf(url.split('?')[0]);
  const p = new Promise((resolve, reject) => {
    const done = (root, animations = []) => resolve({ root, animations });
    if (ext === 'glb' || ext === 'gltf') new GLTFLoader().load(url, g => done(g.scene, g.animations), undefined, reject);
    else if (ext === 'fbx') new FBXLoader().load(url, o => { o.scale.multiplyScalar(0.01); done(o, o.animations || []); }, undefined, reject);
    else if (ext === 'obj') new OBJLoader().load(url, o => done(o), undefined, reject);
    else if (ext === 'dae') new ColladaLoader().load(url, c => done(c.scene, c.scene.animations || []), undefined, reject);
    else if (ext === 'stl' || ext === 'ply') {
      (ext === 'stl' ? new STLLoader() : new PLYLoader()).load(url, geo => {
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xc9ccd4, roughness: 0.7, vertexColors: !!geo.attributes.color });
        done(new THREE.Mesh(geo, mat));
      }, undefined, reject);
    } else reject(new Error('Format de modèle non pris en charge : .' + ext));
  });
  modelCache.set(url, p);
  p.catch(() => modelCache.delete(url));
  return p;
}
export async function loadModel(url) {
  const src = await loadModelSource(url);
  const root = SkeletonUtils.clone(src.root);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, animations: src.animations };
}

function makeMaterial(m, resolveUrl) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(m.color || '#c9ccd4'), metalness: +m.metalness || 0, roughness: m.roughness == null ? 0.75 : +m.roughness,
    transparent: (m.opacity ?? 1) < 1, opacity: m.opacity ?? 1
  });
  if (m.texture) mat.map = loadTexture(resolveUrl(m.texture));
  return mat;
}

export function applyTransform(obj, def) {
  obj.position.fromArray(def.position.map(Number));
  obj.rotation.set(...def.rotation.map(d => THREE.MathUtils.degToRad(+d)));
  obj.scale.fromArray(def.scale.map(Number));
}

// Crée l'objet three.js qui correspond à une définition de la scène.
export async function buildObject(def, resolveUrl, opts = {}) {
  let obj;
  if (def.mesh && SHAPES.includes(def.kind)) {
    obj = new THREE.Mesh(geometryFor(def.kind), makeMaterial(def.mesh, resolveUrl));
    obj.castShadow = def.mesh.castShadow !== false;
    obj.receiveShadow = def.mesh.receiveShadow !== false;
  } else if (def.kind === 'model') {
    obj = new THREE.Group();
    if (def.model) {
      try {
        const { root, animations } = await loadModel(resolveUrl(def.model));
        obj.add(root);
        obj.userData.animations = animations;
        if (def.mesh && def.mesh.tint) root.traverse(o => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.set(def.mesh.tint); } });
      } catch (e) {
        obj.add(new THREE.Mesh(geometryFor('cube'), new THREE.MeshStandardMaterial({ color: 0xdb5c5c, wireframe: true })));
        opts.onError && opts.onError(`Modèle introuvable ou illisible : ${def.model} (${e.message || e})`);
      }
    }
  } else if (def.kind === 'light') {
    const l = def.light || {};
    const color = new THREE.Color(l.color || '#ffffff');
    if (l.type === 'spot') { obj = new THREE.SpotLight(color, +l.intensity || 2, +l.range || 15, Math.PI / 6, 0.4); obj.target.position.set(0, -1, 0); obj.add(obj.target); }
    else if (l.type === 'directional') { obj = new THREE.DirectionalLight(color, +l.intensity || 1); obj.target.position.set(0, -1, 0); obj.add(obj.target); }
    else obj = new THREE.PointLight(color, +l.intensity || 2, +l.range || 12);
    obj.castShadow = !!l.shadows;
  } else if (def.kind === 'terrain') {
    if (!def.terrain) { def.terrain = defaultTerrain(); generateTerrain(def.terrain); }
    obj = new THREE.Mesh(buildTerrainGeometry(def.terrain), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    obj.castShadow = true; obj.receiveShadow = true;
  } else if (def.kind === 'particles') {
    if (!def.particles) def.particles = particlePreset('feu');
    obj = new THREE.Group();
    const fx = new Particles(def.particles);
    obj.userData.fx = fx;
    obj.add(fx.points);
  } else if (def.kind === 'camera') {
    obj = new THREE.PerspectiveCamera(def.camera ? +def.camera.fov || 60 : 60, 4 / 3, 0.05, 2000);
  } else {
    obj = new THREE.Group();
  }
  obj.name = def.name;
  obj.userData.id = def.id;
  obj.userData.def = def;
  applyTransform(obj, def);
  obj.visible = def.active !== false;
  return obj;
}

// Ciel en dégradé : une grande sphère dessinée à l'intérieur.
export function makeSky(top, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }'
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.name = '__sky';
  sky.renderOrder = -1;
  return sky;
}

export function applyEnvironment(world, env) {
  env = Object.assign(defaultEnvironment(), env || {});
  const { scene } = world;
  if (!world.sky) { world.sky = makeSky(env.skyTop, env.skyBottom); scene.add(world.sky); }
  world.sky.material.uniforms.top.value.set(env.skyTop);
  world.sky.material.uniforms.bottom.value.set(env.skyBottom);
  if (!world.hemi) { world.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1); scene.add(world.hemi); }
  world.hemi.color.set(env.skyTop).lerp(new THREE.Color('#ffffff'), 0.6);
  world.hemi.groundColor.set('#5a5048');
  world.hemi.intensity = +env.ambient;
  if (!world.sun) {
    world.sun = new THREE.DirectionalLight(0xffffff, 1);
    world.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(world.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 0.5, far: 200 });
    world.sun.shadow.bias = -0.0004;
    scene.add(world.sun, world.sun.target);
  }
  const d = new THREE.Vector3(...env.sun.direction).normalize();
  world.sun.position.copy(d).multiplyScalar(-60);
  world.sun.color.set(env.sun.color);
  world.sun.intensity = +env.sun.intensity;
  world.sun.castShadow = env.sun.shadows !== false;
  scene.fog = env.fog && env.fog.enabled ? new THREE.Fog(env.fog.color, +env.fog.near, +env.fog.far) : null;
  world.env = env;
}

// Construit toute la scène. Retourne { scene, byId: Map(id -> Object3D), env }.
export async function buildWorld(sceneDef, resolveUrl, opts = {}) {
  const scene = new THREE.Scene();
  const world = { scene, byId: new Map(), env: null };
  applyEnvironment(world, sceneDef.environment);
  const defs = sceneDef.objects || [];
  const built = await Promise.all(defs.map(d => buildObject(d, resolveUrl, opts)));
  defs.forEach((d, i) => world.byId.set(d.id, built[i]));
  defs.forEach((d, i) => {
    const parent = d.parent && world.byId.get(d.parent);
    (parent || scene).add(built[i]);
  });
  return world;
}

// Boîte englobante en coordonnées du monde (un plan reçoit une épaisseur pour servir de sol).
const _box = new THREE.Box3();
export function worldBox(obj, out = new THREE.Box3()) {
  out.makeEmpty();
  obj.updateWorldMatrix(true, true);
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    out.union(_box);
  });
  if (!out.isEmpty() && out.max.y - out.min.y < 0.05) out.min.y -= 0.2;
  return out;
}

// ---------------- Terrain ----------------
// Hauteurs d'une grille (res + 1) x (res + 1), enregistrées en base64 (entiers 16 bits, au centimètre).
export const TERRAIN_PRESETS = [['plat', 'Plat'], ['collines', 'Collines'], ['montagnes', 'Montagnes'], ['ile', 'Île'], ['dunes', 'Dunes']];
export function defaultTerrain() {
  return {
    preset: 'collines', seed: 1, size: 60, res: 96, height: 8,
    colors: { sand: '#d9c58f', grass: '#5b9a3e', rock: '#857e72', snow: '#f2f4f7' },
    levels: { sand: 0.4, snow: 12 }, data: ''
  };
}
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((seed | 0) + 1013, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, seed, octaves = 5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += amp * vnoise(x * freq, y * freq, seed + i * 31); norm += amp; amp *= 0.5; freq *= 2; }
  return sum / norm;
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function terrainShape(preset, u, v, seed, height) {
  const n = fbm(u * 4, v * 4, seed, 5);
  switch (preset) {
    case 'plat': return 0;
    case 'montagnes': { const r = 1 - Math.abs(2 * fbm(u * 3, v * 3, seed + 7, 6) - 1); return (r * r * 1.6 + n * 0.4 - 0.55) * height * 1.6; }
    case 'ile': { const d = Math.hypot(u - 0.5, v - 0.5) * 2; return ((n * 1.2 + 0.25) * (1 - smooth(0.35, 0.95, d)) - 0.15) * height * 1.2; }
    case 'dunes': return (Math.sin((u * 9 + n * 2.2) * Math.PI) * 0.5 + 0.5) * height * 0.35 + (n - 0.5) * height * 0.3;
    default: return (n - 0.32) * height * 1.5;
  }
}
function encodeHeights(arr) {
  const i16 = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(arr[i] * 100)));
  const b = new Uint8Array(i16.buffer);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function decodeHeights(str) {
  const bin = atob(str);
  const b = new Uint8Array(bin.length & ~1);
  for (let i = 0; i < b.length; i++) b[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(b.buffer);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 100;
  return out;
}
function resampleHeights(arr, N) {
  const M = Math.round(Math.sqrt(arr.length));
  if (M * M !== arr.length || M < 2) return null;
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const gx = i / (N - 1) * (M - 1), gz = j / (N - 1) * (M - 1);
    const x0 = Math.min(M - 2, Math.floor(gx)), z0 = Math.min(M - 2, Math.floor(gz)), fx = gx - x0, fz = gz - z0;
    const a = arr[z0 * M + x0], b = arr[z0 * M + x0 + 1], c = arr[(z0 + 1) * M + x0], d = arr[(z0 + 1) * M + x0 + 1];
    out[j * N + i] = (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
  return out;
}
function shapeHeights(t, N) {
  const arr = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) arr[j * N + i] = terrainShape(t.preset, i / (N - 1), j / (N - 1), t.seed | 0, +t.height || 8);
  return arr;
}
const terrainCache = new WeakMap();
const terrainRes = t => Math.max(8, Math.min(192, Math.round(+t.res || 96)));
/** Hauteurs du terrain (tableau partagé : le modifier puis appeler setTerrainHeights pour l'enregistrer). */
export function terrainHeights(t) {
  const N = terrainRes(t) + 1;
  const c = terrainCache.get(t);
  if (c && c.data === t.data && c.arr.length === N * N) return c.arr;
  let arr = null;
  if (t.data) { try { arr = decodeHeights(t.data); } catch { arr = null; } }
  if (arr && arr.length !== N * N) arr = resampleHeights(arr, N);
  if (!arr) arr = shapeHeights(t, N);
  setTerrainHeights(t, arr);
  return arr;
}
export function setTerrainHeights(t, arr) {
  t.data = encodeHeights(arr);
  terrainCache.set(t, { data: t.data, arr });
}
export function generateTerrain(t) { setTerrainHeights(t, shapeHeights(t, terrainRes(t) + 1)); }

export function buildTerrainGeometry(t) {
  const res = terrainRes(t), size = +t.size || 60;
  const g = new THREE.PlaneGeometry(size, size, res, res).rotateX(-Math.PI / 2);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  refreshTerrainGeometry(g, t);
  return g;
}
const _ca = new THREE.Color(), _cs = new THREE.Color(), _cg = new THREE.Color(), _cr = new THREE.Color(), _cn = new THREE.Color();
/** Recalcule le relief et les couleurs (sable en bas, roche sur les pentes, neige en haut). */
export function refreshTerrainGeometry(g, t) {
  const H = terrainHeights(t), pos = g.attributes.position, col = g.attributes.color;
  for (let k = 0; k < pos.count; k++) pos.setY(k, H[k]);
  pos.needsUpdate = true;
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  const nrm = g.attributes.normal, c = t.colors || {}, lv = t.levels || {};
  _cs.set(c.sand || '#d9c58f'); _cg.set(c.grass || '#5b9a3e'); _cr.set(c.rock || '#857e72'); _cn.set(c.snow || '#f2f4f7');
  const sandL = lv.sand == null ? 0.4 : +lv.sand, snowL = lv.snow == null ? 12 : +lv.snow;
  for (let k = 0; k < pos.count; k++) {
    const h = H[k], ny = nrm.getY(k);
    _ca.copy(_cg).lerp(_cs, 1 - smooth(sandL - 0.2, sandL + 0.6, h));
    _ca.lerp(_cr, smooth(0.86, 0.66, ny));
    _ca.lerp(_cn, smooth(snowL - 1, snowL + 1, h) * (ny > 0.6 ? 1 : 0.35));
    const n = 0.93 + hash2(k, 7, 3) * 0.14;
    col.setXYZ(k, _ca.r * n, _ca.g * n, _ca.b * n);
  }
  col.needsUpdate = true;
}
/** Hauteur exacte (sur les triangles) en coordonnées locales, ou null hors du terrain. */
export function terrainHeightLocal(t, x, z) {
  const res = terrainRes(t), N = res + 1, size = +t.size || 60, H = terrainHeights(t);
  const gx = (x / size + 0.5) * res, gz = (z / size + 0.5) * res;
  if (!(gx >= 0 && gz >= 0 && gx <= res && gz <= res)) return null;
  const i = Math.min(res - 1, Math.floor(gx)), j = Math.min(res - 1, Math.floor(gz)), fx = gx - i, fz = gz - j;
  const A = H[j * N + i], D = H[j * N + i + 1], B = H[(j + 1) * N + i], C = H[(j + 1) * N + i + 1];
  return fx + fz <= 1 ? A + (D - A) * fx + (B - A) * fz : C + (B - C) * (1 - fx) + (D - C) * (1 - fz);
}
const _tv = new THREE.Vector3(), _tw = new THREE.Vector3();
/** Hauteur du sol d'un objet terrain sous le point (x, z) du monde, ou null. */
export function terrainHeightWorld(obj, x, z) {
  const t = obj.userData.def && obj.userData.def.terrain;
  if (!t) return null;
  obj.updateWorldMatrix(true, false);
  const p = obj.worldToLocal(_tv.set(x, obj.getWorldPosition(_tw).y, z));
  const h = terrainHeightLocal(t, p.x, p.z);
  if (h == null) return null;
  p.y = h;
  return obj.localToWorld(p).y;
}

// ---------------- Particules ----------------
const P = o => Object.assign({ playing: true, loop: true, rate: 30, burst: 0, life: 1, speed: 1, dir: 'up', spread: 20, size: 0.3, sizeEnd: 0.1, color: '#ffffff', colorEnd: '#ffffff', opacity: 1, gravity: 0, drag: 0, shape: 'point', radius: 0, blend: 'normal' }, o);
export const PARTICLE_PRESETS = {
  feu: P({ rate: 70, life: 0.9, speed: 1.8, spread: 14, size: 0.7, sizeEnd: 0.15, color: '#ffd25a', colorEnd: '#ff3d1a', opacity: 0.85, gravity: -1.5, drag: 0.6, shape: 'disc', radius: 0.3, blend: 'add' }),
  fumee: P({ rate: 14, life: 3.2, speed: 0.9, spread: 12, size: 0.7, sizeEnd: 2.6, color: '#8f8f8f', colorEnd: '#3f3f3f', opacity: 0.35, gravity: -0.4, drag: 0.3, shape: 'disc', radius: 0.3 }),
  etincelles: P({ rate: 35, life: 0.9, speed: 5, spread: 50, size: 0.14, sizeEnd: 0.03, color: '#fff4b8', colorEnd: '#ff8a00', gravity: 9.81, drag: 0.2, blend: 'add' }),
  pluie: P({ rate: 500, life: 1.1, speed: 16, dir: 'down', spread: 3, size: 0.07, sizeEnd: 0.07, color: '#c4dcff', colorEnd: '#c4dcff', opacity: 0.55, gravity: 4, shape: 'box', radius: 15 }),
  neige: P({ rate: 90, life: 7, speed: 1.2, dir: 'down', spread: 10, size: 0.16, sizeEnd: 0.16, color: '#ffffff', colorEnd: '#eaf2ff', opacity: 0.9, gravity: 0.15, drag: 0.4, shape: 'box', radius: 15 }),
  explosion: P({ loop: false, rate: 0, burst: 140, life: 1.1, speed: 9, spread: 180, size: 0.9, sizeEnd: 0.1, color: '#fff1a8', colorEnd: '#ff3d14', gravity: 2, drag: 2.5, shape: 'sphere', radius: 0.3, blend: 'add' }),
  magie: P({ rate: 45, life: 1.5, speed: 0.8, spread: 180, size: 0.22, sizeEnd: 0, color: '#8fe9ff', colorEnd: '#b46bff', gravity: -0.6, drag: 0.5, shape: 'sphere', radius: 0.7, blend: 'add' }),
  poussiere: P({ rate: 20, life: 2.4, speed: 0.5, spread: 70, size: 0.35, sizeEnd: 1.1, color: '#cbb68c', colorEnd: '#cbb68c', opacity: 0.3, gravity: 0.1, drag: 0.8, shape: 'disc', radius: 0.8 })
};
export const PARTICLE_NAMES = { feu: 'Feu', fumee: 'Fumée', etincelles: 'Étincelles', pluie: 'Pluie', neige: 'Neige', explosion: 'Explosion', magie: 'Magie', poussiere: 'Poussière' };
export function particlePreset(name) {
  const key = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const k = PARTICLE_PRESETS[key] ? key : 'feu';
  return { preset: k, ...JSON.parse(JSON.stringify(PARTICLE_PRESETS[k])) };
}

const PVERT = `attribute float aSize; attribute vec4 aColor; varying vec4 vC; uniform float uScale;
void main() { vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 0.0, 512.0); gl_Position = projectionMatrix * mv; }`;
const PFRAG = `varying vec4 vC;
void main() { float d = length(gl_PointCoord - vec2(0.5)); if (d > 0.5) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - smoothstep(0.12, 0.5, d)));
#include <colorspace_fragment>
}`;
const _pp = new THREE.Vector3(), _pd = new THREE.Vector3(), _v2 = new THREE.Vector2(), _c0 = new THREE.Color();
/** Système de particules : les particules vivent dans le monde (elles ne suivent pas l'émetteur une fois lancées). */
export class Particles {
  constructor(cfg) {
    this.cfg = cfg;
    const max = this.max = Math.max(32, Math.min(6000, Math.ceil((+cfg.rate || 0) * (+cfg.life || 1) * 1.3) + (+cfg.burst || 0) + 16));
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.n = 0; this.acc = 0; this.time = 0; this.started = false; this.playing = cfg.playing !== false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, uniforms: { uScale: { value: 400 } },
      transparent: true, depthWrite: false, blending: cfg.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.userData.isFx = true;
    this.points.raycast = () => {};
    // Les positions sont déjà dans le monde : on annule la transformation de l'émetteur au moment du rendu.
    this.points.onBeforeRender = (renderer, scene, camera) => {
      this.points.matrixWorld.identity();
      this.points.modelViewMatrix.copy(camera.matrixWorldInverse);
      const h = renderer.getDrawingBufferSize(_v2).y;
      mat.uniforms.uScale.value = h / (2 * Math.tan((camera.isPerspectiveCamera ? camera.fov : 60) * Math.PI / 360));
    };
    this.c0 = new THREE.Color(cfg.color || '#ffffff'); this.c1 = new THREE.Color(cfg.colorEnd || cfg.color || '#ffffff');
  }
  spawn(count, m) {
    const c = this.cfg, s = +c.speed || 0, r = +c.radius || 0, down = c.dir === 'down';
    const cosMax = Math.cos(THREE.MathUtils.degToRad(Math.max(0, Math.min(180, +c.spread || 0))));
    for (let q = 0; q < count && this.n < this.max; q++) {
      const i = this.n++;
      let x = 0, y = 0, z = 0;
      if (c.shape === 'sphere') { do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; } while (x * x + y * y + z * z > 1); x *= r; y *= r; z *= r; }
      else if (c.shape === 'disc') { const a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * r; x = Math.cos(a) * d; z = Math.sin(a) * d; }
      else if (c.shape === 'box') { x = (Math.random() * 2 - 1) * r; z = (Math.random() * 2 - 1) * r; }
      _pp.set(x, y, z).applyMatrix4(m);
      const ct = 1 - Math.random() * (1 - cosMax), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = Math.random() * 6.2832;
      _pd.set(st * Math.cos(ph), down ? -ct : ct, st * Math.sin(ph)).transformDirection(m).multiplyScalar(s * (0.8 + Math.random() * 0.4));
      this.pos[i * 3] = _pp.x; this.pos[i * 3 + 1] = _pp.y; this.pos[i * 3 + 2] = _pp.z;
      this.vel[i * 3] = _pd.x; this.vel[i * 3 + 1] = _pd.y; this.vel[i * 3 + 2] = _pd.z;
      this.age[i] = 0; this.life[i] = Math.max(0.05, (+c.life || 1) * (0.8 + Math.random() * 0.4));
    }
  }
  burst(count, emitter) { emitter.updateWorldMatrix(true, false); this.spawn(count, emitter.matrixWorld); }
  restart() { this.started = false; this.time = 0; this.acc = 0; }
  get done() { return this.cfg.loop === false && this.started && this.time > (+this.cfg.life || 1) && this.n === 0; }
  update(dt, emitter, preview = false) {
    const c = this.cfg, life = +c.life || 1;
    emitter.updateWorldMatrix(true, false);
    const m = emitter.matrixWorld;
    if (!this.started) { this.started = true; this.time = 0; if (this.playing && +c.burst > 0) this.spawn(+c.burst | 0, m); }
    this.time += dt;
    if (this.playing && emitter.visible && (c.loop !== false || this.time < life)) {
      this.acc += (+c.rate || 0) * dt;
      const k = Math.floor(this.acc);
      this.acc -= k;
      if (k) this.spawn(k, m);
    }
    // Aperçu dans l'éditeur : un effet qui ne boucle pas est rejoué après une courte pause
    if (preview && c.loop === false && this.n === 0 && this.time > life + 0.6) this.restart();
    const g = +c.gravity || 0, keep = Math.max(0, 1 - (+c.drag || 0) * dt), P3 = this.pos, V3 = this.vel;
    for (let i = 0; i < this.n;) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const L = --this.n;
        for (let a = 0; a < 3; a++) { P3[i * 3 + a] = P3[L * 3 + a]; V3[i * 3 + a] = V3[L * 3 + a]; }
        this.age[i] = this.age[L]; this.life[i] = this.life[L];
        continue;
      }
      V3[i * 3 + 1] -= g * dt;
      for (let a = 0; a < 3; a++) { V3[i * 3 + a] *= keep; P3[i * 3 + a] += V3[i * 3 + a] * dt; }
      i++;
    }
    const geo = this.points.geometry, ap = geo.attributes.position.array, ac = geo.attributes.aColor.array, as = geo.attributes.aSize.array;
    const s0 = +c.size || 0, s1 = c.sizeEnd == null ? s0 : +c.sizeEnd, op = c.opacity == null ? 1 : +c.opacity;
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      ap[i * 3] = P3[i * 3]; ap[i * 3 + 1] = P3[i * 3 + 1]; ap[i * 3 + 2] = P3[i * 3 + 2];
      _c0.copy(this.c0).lerp(this.c1, t);
      ac[i * 4] = _c0.r; ac[i * 4 + 1] = _c0.g; ac[i * 4 + 2] = _c0.b;
      ac[i * 4 + 3] = op * Math.min(1, t / 0.08) * Math.min(1, (1 - t) / 0.35);
      as[i] = s0 + (s1 - s0) * t;
    }
    geo.attributes.position.needsUpdate = geo.attributes.aColor.needsUpdate = geo.attributes.aSize.needsUpdate = true;
    geo.setDrawRange(0, this.n);
    return this.n;
  }
}
/** Fait avancer tous les systèmes de particules d'une scène. */
export function updateEffects(root, dt, preview = false) {
  root.traverse(o => { if (o.userData.fx) o.userData.fx.update(dt, o, preview); });
}
