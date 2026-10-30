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
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], script: '', collider: kind !== 'light' && kind !== 'camera' && kind !== 'empty',
    rigidbody: { enabled: false, gravity: 1, bounce: 0 }
  };
  if (SHAPES.includes(kind)) o.mesh = { color: '#c9ccd4', texture: '', opacity: 1, metalness: 0, roughness: 0.75, castShadow: true, receiveShadow: true };
  if (kind === 'model') o.model = '';
  if (kind === 'light') o.light = { type: 'point', color: '#ffffff', intensity: 2, range: 12 };
  if (kind === 'camera') o.camera = { fov: 60, main: true };
  if (kind === 'plane') o.scale = [10, 1, 10];
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
