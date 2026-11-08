/* MaxyStudio 2.0 - éditeur de scènes (Hiérarchie, Scène, Jeu, Inspecteur, Projet, Console) */
import * as core from './sc3d-core.js';
import { SceneView3D } from './scene-view3d.js';
import { SceneView2D } from './scene-view2d.js';
import { initPlugins } from './plugins.js';
import { compileMaxyCode, originalLine, originOf, findImports, STDLIB } from './maxycode.js';

hydrateIcons();
const $ = s => document.querySelector(s);
const DIR = new URLSearchParams(location.search).get('dir');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cleanErr = e => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fmt = v => String(+(+v || 0).toFixed(3));
const base = p => p.split('/').pop();
const stem = p => base(p).replace(/\.[^.]+$/, '');
const ext = p => core.extOf(p);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const LUTIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="50" r="38" fill="#855cd6" stroke="#5b3da8" stroke-width="4"/><ellipse cx="36" cy="44" rx="7" ry="9" fill="#fff"/><ellipse cx="60" cy="44" rx="7" ry="9" fill="#fff"/><circle cx="37" cy="46" r="4" fill="#2a1f4a"/><circle cx="61" cy="46" r="4" fill="#2a1f4a"/><path d="M36 64 Q48 74 60 64" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';

const S = {
  config: null, type: '2d', tree: [], base: '', scenePath: 'scenes/Main.scene', scene: null,
  sel: null, selAsset: null, mode: 'edit', paused: false, undo: [], redo: [], lastSnap: { key: '', t: 0 },
  models: new Map(), saved: new Map(), tabs: ['scene', 'game'], active: 'scene', folder: 'assets',
  folderOpen: new Set(['', 'assets', 'scripts', 'scenes']), collapsed: new Set(), closedComps: new Set(),
  logs: [], levels: { log: true, warn: true, error: true }, collapse: false, clearOnPlay: true, problems: {}
};
let view = null, monaco = null, editor = null;
let plugins = null;
const ignoreDisk = new Map();
const markOwnWrite = rel => ignoreDisk.set(rel, Date.now());

// ---------------- Petits outils d'interface ----------------
function toast(msg, err) {
  const t = $('#toast');
  t.className = 'un-toast show' + (err ? ' err' : '');
  t.innerHTML = icon(err ? 'alert' : 'check', 15) + '<span></span>';
  t.querySelector('span').textContent = msg;
  clearTimeout(t._h); t._h = setTimeout(() => { t.className = 'un-toast'; }, 3800);
}
const status = msg => { $('#statusMsg').textContent = msg; };
const savedNote = msg => { $('#statusSave').textContent = msg; clearTimeout(savedNote.t); savedNote.t = setTimeout(() => { $('#statusSave').textContent = ''; }, 2500); };

function showMenu(x, y, items) {
  const m = $('#menu'); m.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    if (typeof it === 'string') { const t = document.createElement('div'); t.className = 'mt'; t.textContent = it; m.appendChild(t); continue; }
    const b = document.createElement('button');
    b.innerHTML = icon(it.ic || 'file', 14) + '<span></span>' + (it.key ? `<span class="k">${esc(it.key)}</span>` : '');
    b.querySelector('span').textContent = it.label;
    b.disabled = !!it.disabled;
    b.onclick = () => { closeMenu(); it.fn(); };
    m.appendChild(b);
  }
  m.classList.add('show');
  m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 8)) + 'px';
}
const menuAt = (el, items) => { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 3, items); };
function closeMenu() { $('#menu').classList.remove('show'); document.querySelectorAll('.un-menu.open').forEach(b => b.classList.remove('open')); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu') && !e.target.closest('.un-menu')) closeMenu(); });

function modal(title, bodyHtml, { ok = 'OK', cancel = 'Annuler', focus } = {}) {
  return new Promise(res => {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#modalOk').textContent = ok;
    $('#modalCancel').textContent = cancel;
    $('#modalCancel').style.display = cancel ? '' : 'none';
    $('#modalBack').classList.add('show');
    const inp = $('#modalBody').querySelector(focus || 'input');
    if (inp) { inp.focus(); inp.select && inp.select(); }
    const done = v => { $('#modalBack').classList.remove('show'); document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); $('#modalOk').click(); } };
    document.addEventListener('keydown', key, true);
    $('#modalOk').onclick = () => done(inp ? inp.value.trim() : true);
    $('#modalCancel').onclick = () => done(null);
  });
}
const ask = (title, value = '') => modal(title, `<input class="f" value="${esc(value)}" spellcheck="false">`);
const confirmBox = (title, text, ok = 'Supprimer') => modal(title, `<p class="in-note" style="font-size:13px">${esc(text)}</p>`, { ok });

// ---------------- Fichiers du projet ----------------
const allFiles = (nodes = S.tree, out = []) => { for (const n of nodes) n.type === 'dir' ? allFiles(n.children, out) : out.push(n.path); return out; };
const allDirs = (nodes = S.tree, out = []) => { for (const n of nodes) if (n.type === 'dir') { out.push(n.path); allDirs(n.children, out); } return out; };
const filesBy = exts => allFiles().filter(f => exts.includes(ext(f)));
const resolveUrl = rel => S.base + String(rel).split('/').map(encodeURIComponent).join('/');
function kindOf(rel) {
  const e = ext(rel);
  if (core.MODEL_EXT.includes(e)) return 'model';
  if (core.IMAGE_EXT.includes(e)) return 'image';
  if (core.SOUND_EXT.includes(e)) return 'sound';
  if (e === 'sc') return 'sc';
  if (e === 'scene') return 'scene';
  if (e === 'prefab') return 'prefab';
  if (e === 'md') return 'md';
  if (e === 'json' || e === 'maxycode' || e === 'scratchcode') return 'json';
  return 'file';
}
const KIND_ICON = { model: 'box', image: 'image', sound: 'volume', sc: 'fileCode', scene: 'scene', prefab: 'copy', md: 'book', json: 'braces', file: 'file', dir: 'folder' };
async function refreshTree() {
  const p = await studio.readProject(DIR);
  S.config = p.config; S.tree = p.tree; S.base = p.assetBase;
  renderFolders(); renderAssets();
}
async function writeText(rel, text) { markOwnWrite(rel); await studio.writeFile(DIR, rel, text); }

// ---------------- Scène : chargement, sauvegarde, annuler ----------------
function normalizeScene(sc = S.scene) {
  sc.objects = sc.objects || [];
  if (S.type === '3d') {
    sc.environment = Object.assign(core.defaultEnvironment(), sc.environment || {});
    for (const o of sc.objects) {
      o.position = o.position || [0, 0, 0]; o.rotation = o.rotation || [0, 0, 0]; o.scale = o.scale || [1, 1, 1];
      o.rigidbody = o.rigidbody || { enabled: false, gravity: 1, bounce: 0 };
    }
  } else {
    sc.stage = sc.stage || { backdrops: [], script: '' };
    for (const o of sc.objects) { o.costumes = o.costumes || []; o.sounds = o.sounds || []; }
  }
}
async function loadScene() {
  S.scene = JSON.parse(await studio.readFile(DIR, S.scenePath));
  normalizeScene();
  await view.load(S.scene);
  renderHier(); renderInsp();
}
async function saveSceneNow() {
  if (!S.scene) return;
  await writeText(S.scenePath, JSON.stringify(S.scene, null, 2));
  savedNote('Scène enregistrée');
}
const saveScene = debounce(saveSceneNow, 450);
function snapshot(key = '') {
  const now = Date.now();
  if (key && S.lastSnap.key === key && now - S.lastSnap.t < 900) { S.lastSnap.t = now; return; }
  S.lastSnap = { key, t: now };
  S.undo.push(JSON.stringify(S.scene));
  if (S.undo.length > 120) S.undo.shift();
  S.redo = [];
}
async function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(S.scene));
  S.scene = JSON.parse(from.pop());
  normalizeScene();
  if (S.sel && S.sel[0] !== '_' && !findObj(S.sel)) S.sel = null;
  await view.load(S.scene);
  view.select(S.sel && S.sel[0] !== '_' ? S.sel : null);
  renderHier(); renderInsp(); saveScene();
}
const undo = () => restore(S.undo, S.redo).then(() => status('Annulé'));
const redo = () => restore(S.redo, S.undo).then(() => status('Rétabli'));

const findObj = id => S.scene && S.scene.objects.find(o => o.id === id);
const childrenOf = id => S.scene.objects.filter(o => (o.parent || null) === id);
function descendants(id, out = []) { for (const c of childrenOf(id)) { out.push(c); descendants(c.id, out); } return out; }
function uniqueName(name, exceptId) {
  const names = new Set(S.scene.objects.filter(o => o.id !== exceptId).map(o => o.name));
  if (!names.has(name)) return name;
  const m = name.match(/^(.*?)(?: \((\d+)\))?$/);
  let i = m[2] ? +m[2] + 1 : 2;
  while (names.has(`${m[1]} (${i})`)) i++;
  return `${m[1]} (${i})`;
}

// ---------------- Sélection ----------------
function select(id, { fromView } = {}) {
  S.sel = id;
  S.selAsset = null;
  view.select(id && id[0] !== '_' ? id : null);
  renderHier(); renderInsp(); renderAssets();
  if (plugins) plugins.emit('select', id);
}
function selectAsset(rel) {
  S.selAsset = rel;
  renderAssets(); renderInsp();
}

// ---------------- Création et modification d'objets ----------------
const SHAPES_MENU = [['cube', 'Cube'], ['sphere', 'Sphère'], ['cylinder', 'Cylindre'], ['cone', 'Cône'], ['capsule', 'Capsule'], ['plane', 'Plan'], ['torus', 'Tore']];
function spawnPoint() {
  if (S.type !== '3d' || !view.orbit) return [0, 0.5, 0];
  const t = view.orbit.target;
  return [Math.round(t.x * 2) / 2, Math.max(0.5, Math.round(t.y * 2) / 2), Math.round(t.z * 2) / 2];
}
async function ensureDefaultCostume() {
  const rel = 'assets/Lutin.svg';
  if (!allFiles().includes(rel)) { await writeText(rel, LUTIN_SVG); await refreshTree(); }
  return rel;
}
async function createObject(kind, extra = {}, parent = null) {
  if (S.mode !== 'edit') return toast('Arrête le jeu pour modifier la scène.', true);
  snapshot();
  let def;
  if (S.type === '3d') {
    const label = { empty: 'Objet vide', light: 'Lumière', camera: 'Caméra', model: 'Modèle' }[kind] || core.SHAPE_NAMES[kind] || kind;
    const spawn = spawnPoint();
    if (kind === 'plane' || kind === 'model') spawn[1] = 0;
    def = core.defaultObject(kind, uniqueName(extra.name || label), Object.assign({ position: spawn }, extra));
    def.name = uniqueName(def.name);
    def.parent = parent;
    if (parent) def.position = [0, 1, 0];
  } else {
    const costume = extra.costume || await ensureDefaultCostume();
    def = { id: core.newId(), name: uniqueName(extra.name || stem(costume) || 'Lutin'), kind: 'sprite', x: extra.x || 0, y: extra.y || 0, size: 100, direction: 90, visible: true, rotationStyle: 'all around', draggable: false, costumes: [costume], sounds: [], script: '' };
  }
  S.scene.objects.push(def);
  await view.addObject(def);
  select(def.id);
  saveScene();
  status(`« ${def.name} » créé`);
  return def;
}
async function duplicateSel() {
  const o = findObj(S.sel);
  if (!o || S.mode !== 'edit') return;
  snapshot();
  const map = new Map();
  const copies = [o, ...(S.type === '3d' ? descendants(o.id) : [])].map(src => {
    const c = JSON.parse(JSON.stringify(src));
    c.id = core.newId(); map.set(src.id, c.id);
    return c;
  });
  for (const c of copies) if (c.parent && map.has(c.parent)) c.parent = map.get(c.parent);
  copies[0].name = uniqueName(o.name);
  for (const c of copies.slice(1)) c.name = uniqueName(c.name);
  if (S.type === '3d') copies[0].position = copies[0].position.map((v, i) => i === 0 ? +v + 1 : v);
  else { copies[0].x += 20; copies[0].y -= 20; }
  S.scene.objects.push(...copies);
  for (const c of copies) await view.addObject(c);
  select(copies[0].id);
  saveScene();
}
async function deleteSel() {
  const o = findObj(S.sel);
  if (!o || S.mode !== 'edit') return;
  snapshot();
  const gone = new Set([o.id, ...descendants(o.id).map(d => d.id)]);
  S.scene.objects = S.scene.objects.filter(x => !gone.has(x.id));
  for (const id of gone) view.removeObject(id);
  select(null);
  saveScene();
  status(`« ${o.name} » supprimé`);
}
async function renameSel() {
  const o = findObj(S.sel);
  if (!o) return;
  const row = document.querySelector(`.un-row[data-id="${o.id}"] .nm`);
  if (!row) return;
  const inp = document.createElement('input');
  inp.className = 'rename'; inp.value = o.name; inp.spellcheck = false;
  row.replaceWith(inp); inp.focus(); inp.select();
  const done = ok => {
    if (ok && inp.value.trim() && inp.value.trim() !== o.name) { snapshot(); o.name = uniqueName(inp.value.trim(), o.id); view.updateObject(o); saveScene(); }
    renderHier(); renderInsp();
  };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  inp.onblur = () => done(true);
}
function reparent(id, parentId) {
  const o = findObj(id);
  if (!o || id === parentId) return;
  if (parentId && descendants(id).some(d => d.id === parentId)) return toast('Impossible : cet objet est un parent de la cible.', true);
  snapshot();
  o.parent = parentId || null;
  view.updateObject(o);
  renderHier(); saveScene();
}
function reorder2d(id, beforeId) {
  const arr = S.scene.objects;
  const i = arr.findIndex(o => o.id === id);
  if (i < 0) return;
  snapshot();
  const [o] = arr.splice(i, 1);
  const j = beforeId ? arr.findIndex(x => x.id === beforeId) : arr.length;
  arr.splice(j < 0 ? arr.length : j, 0, o);
  view.load(S.scene);
  renderHier(); saveScene();
}

// Modification d'une valeur par l'inspecteur (avec regroupement pour Annuler)
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o == null ? o : o[k], obj);
function applyChange(target, path, value, how) {
  snapshot((target.id || 'env') + path);
  setPath(target, path, value);
  if (how === 'transform') view.setTransform(target);
  else if (how === 'env') view.setEnvironment(S.scene.environment);
  else if (how === 'rebuild' || how === 'rebuild+insp') view.updateObject(target);
  else if (how === 'name') { target.name = uniqueName(String(value).trim() || 'Objet', target.id); view.updateObject(target); renderHier(); }
  else if (how === 'draw') view.updateObject(target);
  if (how === 'rebuild+insp') renderInsp();
  if (path === 'active' || path === 'visible') renderHier();
  saveScene();
}

// ---------------- Hiérarchie ----------------
const OBJ_ICON = { empty: 'empty', cube: 'box', sphere: 'sphere', cylinder: 'box', cone: 'box', capsule: 'box', plane: 'grid', torus: 'sphere', model: 'box', light: 'light', camera: 'camera', sprite: 'sprite' };
function renderHier() {
  const box = $('#hier');
  if (!S.scene) { box.innerHTML = ''; return; }
  const q = $('#hierSearch').value.trim().toLowerCase();
  let html = '';
  const row = (o, depth, hasKids) => {
    const k = o.kind === 'sprite' ? 'sprite' : o.kind;
    const off = o.active === false || o.visible === false;
    return `<div class="un-row${S.sel === o.id ? ' sel' : ''}${off ? ' off' : ''}" data-id="${o.id}" draggable="true" style="padding-left:${6 + depth * 14}px">
      <span class="tw" data-tw="${o.id}">${hasKids ? icon(S.collapsed.has(o.id) ? 'chevronRight' : 'chevronDown', 12) : ''}</span>
      <span class="oi k-${k}">${icon(OBJ_ICON[o.kind] || 'box', 14)}</span><span class="nm">${esc(o.name)}</span>${o.script ? `<span class="tag" title="${esc(o.script)}">script</span>` : ''}</div>`;
  };
  if (S.type === '3d') {
    html += `<div class="un-row root${S.sel === '__env' ? ' sel' : ''}" data-id="__env" style="padding-left:6px"><span class="tw">${icon('chevronDown', 12)}</span><span class="oi k-stage">${icon('scene', 14)}</span><span class="nm">${esc(stem(S.scenePath))}</span>${S.scene.worldScript ? '<span class="tag">script</span>' : ''}</div>`;
    const walk = (parent, depth) => {
      for (const o of childrenOf(parent)) {
        const kids = childrenOf(o.id).length > 0;
        if (q && !o.name.toLowerCase().includes(q)) { walk(o.id, depth); continue; }
        html += row(o, depth, kids && !q);
        if (kids && !S.collapsed.has(o.id) && !q) walk(o.id, depth + 1);
        else if (q) walk(o.id, depth + 1);
      }
    };
    // Objets dont le parent n'existe plus : affichés à la racine
    for (const o of S.scene.objects) if (o.parent && !findObj(o.parent)) o.parent = null;
    walk(null, 1);
  } else {
    html += `<div class="un-row root${S.sel === '__stage' ? ' sel' : ''}" data-id="__stage" style="padding-left:6px"><span class="tw">${icon('chevronDown', 12)}</span><span class="oi k-stage">${icon(S.type === 'app' ? 'app' : 'image', 14)}</span><span class="nm">${S.type === 'app' ? 'Application' : 'Scène'}</span>${sceneFiles().length > 1 ? `<span class="tag">${esc(stem(S.scenePath))}</span>` : ''}${S.scene.stage.script ? '<span class="tag">script</span>' : ''}</div>`;
    for (const o of S.scene.objects) if (!q || o.name.toLowerCase().includes(q)) html += row(o, 1, false);
  }
  if (!S.scene.objects.length) html += `<div class="un-empty">${S.type === 'app' ? 'Le code de l\'application est dans le script de « Application ». Tu peux aussi ajouter des lutins.' : 'La scène est vide.<br>Clique sur + pour créer un objet.'}</div>`;
  box.innerHTML = html;
  box.querySelectorAll('.un-row').forEach(el => {
    const id = el.dataset.id;
    el.onmousedown = e => { if (e.button === 0 && !e.target.closest('[data-tw]')) select(id); };
    el.querySelector('[data-tw]') && (el.querySelector('[data-tw]').onclick = e => { e.stopPropagation(); S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); renderHier(); });
    el.ondblclick = () => { if (id[0] !== '_') { activateTab('scene'); view.focus(id); } };
    el.oncontextmenu = e => { e.preventDefault(); select(id); showMenu(e.clientX, e.clientY, objectMenu(id)); };
    if (id[0] === '_') {
      el.ondragover = e => { if (e.dataTransfer.types.includes('text/sc-obj')) { e.preventDefault(); el.classList.add('drop'); } };
      el.ondragleave = () => el.classList.remove('drop');
      el.ondrop = e => { el.classList.remove('drop'); const src = e.dataTransfer.getData('text/sc-obj'); if (src) { e.preventDefault(); S.type === '3d' ? reparent(src, null) : reorder2d(src, null); } };
      return;
    }
    el.ondragstart = e => { e.dataTransfer.setData('text/sc-obj', id); e.dataTransfer.effectAllowed = 'move'; };
    el.ondragover = e => { if (e.dataTransfer.types.includes('text/sc-obj') || e.dataTransfer.types.includes('text/sc-asset')) { e.preventDefault(); el.classList.add('drop'); } };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = e => {
      el.classList.remove('drop');
      const src = e.dataTransfer.getData('text/sc-obj');
      const asset = e.dataTransfer.getData('text/sc-asset');
      e.preventDefault();
      if (src && src !== id) S.type === '3d' ? reparent(src, id) : reorder2d(src, id);
      else if (asset) dropAsset(asset, null, id);
    };
  });
}
$('#hierSearch').oninput = renderHier;
$('#hier').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/sc-asset')) e.preventDefault(); });
$('#hier').addEventListener('drop', e => {
  if (e.target.closest('.un-row')) return;
  const src = e.dataTransfer.getData('text/sc-obj'), asset = e.dataTransfer.getData('text/sc-asset');
  if (src) S.type === '3d' ? reparent(src, null) : reorder2d(src, null);
  else if (asset) dropAsset(asset, null, null);
});
$('#hier').addEventListener('mousedown', e => { if (e.target === e.currentTarget) select(null); });
$('#hier').addEventListener('contextmenu', e => { if (!e.target.closest('.un-row')) { e.preventDefault(); showMenu(e.clientX, e.clientY, createItems()); } });

function createItems(parent = null) {
  if (S.type !== '3d') return ['Créer', { label: 'Nouveau lutin', ic: 'sprite', fn: () => createObject('sprite') },
    ...filesBy(core.IMAGE_EXT).slice(0, 12).map(rel => ({ label: `Lutin avec ${base(rel)}`, ic: 'image', fn: () => createObject('sprite', { costume: rel }) }))];
  return [
    'Créer', { label: 'Objet vide', ic: 'empty', key: 'Ctrl+Maj+N', fn: () => createObject('empty', {}, parent) },
    '-', 'Objets 3D', ...SHAPES_MENU.map(([k, l]) => ({ label: l, ic: OBJ_ICON[k], fn: () => createObject(k, {}, parent) })),
    '-', 'Lumières',
    { label: 'Lumière ponctuelle', ic: 'light', fn: () => createObject('light', { name: 'Lumière', light: { type: 'point', color: '#ffffff', intensity: 2, range: 12 } }, parent) },
    { label: 'Projecteur', ic: 'light', fn: () => createObject('light', { name: 'Projecteur', light: { type: 'spot', color: '#ffffff', intensity: 4, range: 20 } }, parent) },
    { label: 'Lumière directionnelle', ic: 'sun', fn: () => createObject('light', { name: 'Lumière directionnelle', light: { type: 'directional', color: '#ffffff', intensity: 1 } }, parent) },
    '-', { label: 'Caméra', ic: 'camera', fn: () => createObject('camera', { camera: { fov: 60, main: !S.scene.objects.some(o => o.kind === 'camera') } }, parent) },
    { label: 'Modèle 3D (depuis les assets)…', ic: 'box', fn: pickModel }
  ];
}
async function pickModel() {
  const models = filesBy(core.MODEL_EXT);
  if (!models.length) { toast('Importe d\'abord un modèle (.glb, .gltf, .obj, .fbx...) dans le panneau Projet.'); return importAssets(); }
  const html = `<select class="f">${models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>`;
  const rel = await modal('Ajouter un modèle 3D', html, { ok: 'Ajouter', focus: 'select' }).then(v => v ? $('#modalBody select').value : null);
  if (rel) createObject('model', { name: stem(rel), model: rel });
}
function objectMenu(id) {
  if (id[0] === '_') return [...createItems(), '-', { label: 'Ouvrir le script', ic: 'fileCode', disabled: !sceneScript(), fn: () => openScript(sceneScript()) }];
  const o = findObj(id);
  return [
    { label: 'Renommer', ic: 'edit', key: 'F2', fn: renameSel },
    { label: 'Dupliquer', ic: 'copy', key: 'Ctrl+D', fn: duplicateSel },
    { label: 'Supprimer', ic: 'trash', key: 'Suppr', fn: deleteSel },
    '-',
    S.type === '3d' && { label: 'Cadrer dans la vue Scène', ic: 'maximize', key: 'F', fn: () => { activateTab('scene'); view.focus(id); } },
    o.script ? { label: `Ouvrir ${base(o.script)}`, ic: 'fileCode', fn: () => openScript(o.script) } : { label: 'Ajouter un script…', ic: 'fileCode', fn: () => newScriptFor(o) },
    '-', o.prefab ? { label: 'Appliquer au prefab', ic: 'copy', fn: () => applyPrefab(o.id) } : { label: 'Créer un prefab', ic: 'copy', fn: () => makePrefab(o.id) },
    S.type === '3d' && '-', S.type === '3d' && { label: 'Détacher du parent', ic: 'layers', disabled: !o.parent, fn: () => reparent(id, null) },
    ...(S.type === '3d' ? ['-', ...createItems(id).slice(1).filter(x => typeof x !== 'string' || x === '-').slice(0, 9).map(it => it === '-' ? null : { ...it, label: `Enfant : ${it.label}` })] : [])
  ];
}
$('#hierAdd').onclick = e => menuAt(e.currentTarget, createItems());
const sceneScript = () => S.type === '3d' ? S.scene.worldScript : S.scene.stage && S.scene.stage.script;

// ---------------- Inspecteur ----------------
const comp = (key, ic, title, body, { remove } = {}) =>
  `<div class="in-comp${S.closedComps.has(key) ? ' closed' : ''}" data-comp="${key}"><div class="in-ch"><span class="tw">${icon(S.closedComps.has(key) ? 'chevronRight' : 'chevronDown', 12)}</span><span class="cic">${icon(ic, 14)}</span><span>${title}</span><span class="grow"></span>${remove ? `<button class="un-ibtn" data-remove="${remove}" title="Retirer le composant">${icon('x', 13)}</button>` : ''}</div><div class="in-cb">${body}</div></div>`;
const lbl = (text, scrub, step) => `<span class="in-l${scrub ? ' scrub' : ''}"${scrub ? ` data-scrub="${scrub}" data-step="${step || 0.1}"` : ''}>${text}</span>`;
const num = (k, v, step = 0.1) => `<input class="f" data-k="${k}" data-t="num" data-step="${step}" value="${fmt(v)}" spellcheck="false">`;
const v3 = (k, arr, step) => `<div class="in-v3">${['x', 'y', 'z'].map((a, i) => `<label class="in-n"><b class="${a}" data-scrub="${k}.${i}" data-step="${step}">${a.toUpperCase()}</b><input data-k="${k}.${i}" data-t="num" data-step="${step}" value="${fmt(arr[i])}" spellcheck="false"></label>`).join('')}</div>`;
const color = (k, v) => `<input class="f" type="color" data-k="${k}" data-t="color" value="${esc(v || '#ffffff')}">`;
const check = (k, v, text = '') => `<label class="in-check"><input type="checkbox" data-k="${k}" data-t="check"${v ? ' checked' : ''}>${text}</label>`;
const range = (k, v, min, max, step) => `<div class="in-row2"><input type="range" data-k="${k}" data-t="range" min="${min}" max="${max}" step="${step}" value="${+v}"><span class="in-l" style="width:34px;text-align:right" data-out="${k}">${fmt(v)}</span></div>`;
const selectF = (k, v, options) => `<select class="f" data-k="${k}" data-t="select">${options.map(([val, text]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
const scriptOptions = () => [['', '(aucun)'], ...filesBy(['sc']).map(f => [f, f])];

function renderInsp() {
  const box = $('#insp');
  if (!S.scene) { box.innerHTML = ''; return; }
  if (S.selAsset) return renderAssetInsp(box, S.selAsset);
  const o = findObj(S.sel);
  if (o && S.type === '3d') return renderObj3D(box, o);
  if (o) return renderSprite(box, o);
  if (S.type === '3d') return renderEnv(box);
  return renderStage(box);
}
function head(o, ic) {
  const activeKey = S.type === '3d' ? 'active' : 'visible';
  return `<div class="in-head"><span class="big">${icon(ic, 18)}</span><input type="checkbox" data-k="${activeKey}" data-t="check" title="${S.type === '3d' ? 'Actif' : 'Visible'}"${o[activeKey] !== false ? ' checked' : ''} style="accent-color:var(--accent)"><input class="name" data-k="name" data-t="name" value="${esc(o.name)}" spellcheck="false"></div>`;
}
function scriptComp(target, key = 'script') {
  const cur = getPath(target, key) || '';
  return comp('script', 'fileCode', 'Script', `${lbl('Fichier')}${selectF(key, cur, scriptOptions())}
    <div class="full in-row2"><button class="un-btn sm" data-act="openScript"${cur ? '' : ' disabled'}>${icon('edit', 12)}Ouvrir</button><button class="un-btn sm" data-act="newScript">${icon('plus', 12)}Nouveau script</button></div>`, { remove: cur ? 'script' : '' });
}
function renderObj3D(box, o) {
  const textures = [['', '(aucune)'], ...filesBy(core.IMAGE_EXT).map(f => [f, f])];
  let html = head(o, OBJ_ICON[o.kind] || 'box');
  html += comp('transform', 'move', 'Transformation', `${lbl('Position', `position.0`, 0.05)}${v3('position', o.position, 0.05)}${lbl('Rotation')}${v3('rotation', o.rotation, 1)}${lbl('Échelle')}${v3('scale', o.scale, 0.02)}`);
  if (o.mesh && core.SHAPES.includes(o.kind)) {
    html += comp('mesh', 'palette', 'Rendu', `${lbl('Forme')}${selectF('kind', o.kind, SHAPES_MENU)}${lbl('Couleur')}${color('mesh.color', o.mesh.color)}
      ${lbl('Texture')}${selectF('mesh.texture', o.mesh.texture || '', textures)}${lbl('Opacité')}${range('mesh.opacity', o.mesh.opacity ?? 1, 0, 1, 0.01)}
      ${lbl('Métal')}${range('mesh.metalness', o.mesh.metalness || 0, 0, 1, 0.01)}${lbl('Rugosité')}${range('mesh.roughness', o.mesh.roughness ?? 0.75, 0, 1, 0.01)}
      ${lbl('Ombres')}<div class="in-row2">${check('mesh.castShadow', o.mesh.castShadow !== false, 'Projette')}${check('mesh.receiveShadow', o.mesh.receiveShadow !== false, 'Reçoit')}</div>`);
  }
  if (o.kind === 'model') {
    const models = [['', '(aucun)'], ...filesBy(core.MODEL_EXT).map(f => [f, f])];
    const obj = view.objById(o.id);
    const anims = obj && obj.userData.animations ? obj.userData.animations.map(a => a.name || 'sans nom') : [];
    html += comp('model', 'box', 'Modèle 3D', `${lbl('Fichier')}${selectF('model', o.model || '', models)}
      ${lbl('Animations')}<span class="in-note">${anims.length ? esc(anims.join(', ')) : 'aucune'}</span>
      <div class="full in-note">Formats : glb, gltf, obj, fbx, stl, ply, dae. Utilise <code>play animation [nom]</code> pour lancer une animation.</div>`);
  }
  if (o.kind === 'light') {
    const l = o.light;
    html += comp('light', 'light', 'Lumière', `${lbl('Type')}${selectF('light.type', l.type, [['point', 'Ponctuelle'], ['spot', 'Projecteur'], ['directional', 'Directionnelle']])}
      ${lbl('Couleur')}${color('light.color', l.color)}${lbl('Intensité', 'light.intensity', 0.05)}${num('light.intensity', l.intensity, 0.1)}
      ${l.type !== 'directional' ? lbl('Portée', 'light.range', 0.1) + num('light.range', l.range, 0.5) : ''}${lbl('Ombres')}${check('light.shadows', l.shadows)}`);
  }
  if (o.kind === 'camera') {
    html += comp('camera', 'camera', 'Caméra', `${lbl('Champ de vision')}${range('camera.fov', o.camera.fov, 20, 120, 1)}${lbl('Principale')}${check('camera.main', o.camera.main, 'Le jeu utilise cette caméra')}`);
  }
  if (o.collider) html += comp('collider', 'shield', 'Collision', `<div class="full in-note">Les objets avec la physique ne traversent pas cet objet. Sa boîte englobante sert aux blocs <code>touching object</code>.</div>`, { remove: 'collider' });
  if (o.rigidbody && o.rigidbody.enabled) html += comp('rigidbody', 'physics', 'Physique', `${lbl('Gravité', 'rigidbody.gravity', 0.02)}${num('rigidbody.gravity', o.rigidbody.gravity ?? 1, 0.1)}${lbl('Rebond')}${range('rigidbody.bounce', o.rigidbody.bounce || 0, 0, 1, 0.05)}
    <div class="full in-note">L'objet tombe et se pose sur les objets avec collision. Blocs utiles : <code>jump with force (6)</code>, <code>set velocity to x: y: z:</code>.</div>`, { remove: 'rigidbody' });
  if (o.prefab) html += prefabComp(o);
  if (o.script) html += scriptComp(o);
  html += `<div class="in-add"><button class="un-btn" data-act="addComp">${icon('plus', 13)}Ajouter un composant</button></div>`;
  box.innerHTML = html;
  bindInsp(box, o, k => /^(position|rotation|scale)\./.test(k) ? 'transform' : k === 'name' ? 'name' : (k === 'kind' || k === 'light.type' || k === 'model') ? 'rebuild+insp' : 'rebuild');
}
function renderSprite(box, o) {
  const thumbs = (list, kind) => `<div class="full in-list">${list.map((rel, i) => `<div class="in-item">${kind === 'image' ? `<img src="${esc(resolveUrl(rel))}" alt="">` : `<span style="flex:none;color:#ff9f6b">${icon('volume', 18)}</span>`}<span title="${esc(rel)}">${esc(base(rel))}</span>
    <button class="un-ibtn" data-list="${kind}" data-up="${i}" title="Monter"${i ? '' : ' disabled'}>${icon('chevronDown', 12, 'up')}</button><button class="un-ibtn" data-list="${kind}" data-del="${i}" title="Retirer">${icon('x', 12)}</button></div>`).join('') || '<span class="in-note">Aucun</span>'}
    <button class="un-btn sm" data-add="${kind}">${icon('plus', 12)}Ajouter</button></div>`;
  let html = head(o, 'sprite');
  html += comp('transform', 'move', 'Transformation 2D', `${lbl('X', 'x', 1)}${num('x', o.x, 1)}${lbl('Y', 'y', 1)}${num('y', o.y, 1)}${lbl('Taille %', 'size', 1)}${num('size', o.size, 1)}
    ${lbl('Direction', 'direction', 1)}${num('direction', o.direction, 1)}${lbl('Rotation')}${selectF('rotationStyle', o.rotationStyle, [['all around', 'Dans tous les sens'], ['left-right', 'Gauche-droite'], ["don't rotate", 'Ne pas tourner']])}
    ${lbl('Déplaçable')}${check('draggable', o.draggable, 'Pendant le jeu')}`);
  html += comp('costumes', 'image', 'Costumes', thumbs(o.costumes, 'image'));
  html += comp('sounds', 'volume', 'Sons', thumbs(o.sounds, 'sound'));
  if (o.prefab) html += prefabComp(o);
  html += scriptComp(o);
  box.innerHTML = html;
  box.querySelectorAll('[data-up] .ic').forEach(i => { i.style.transform = 'rotate(180deg)'; });
  bindInsp(box, o, k => k === 'name' ? 'name' : 'draw');
  bindLists(box, o);
}
function renderStage(box) {
  const st = S.scene.stage;
  let html = `<div class="in-head"><span class="big">${icon(S.type === 'app' ? 'app' : 'image', 18)}</span><b>${S.type === 'app' ? 'Application' : 'Scène'}</b></div>`;
  html += comp('backdrops', 'image', 'Arrière-plans', `<div class="full in-list">${st.backdrops.map((rel, i) => `<div class="in-item"><img src="${esc(resolveUrl(rel))}" alt=""><span>${esc(base(rel))}</span><button class="un-ibtn" data-list="backdrop" data-up="${i}"${i ? '' : ' disabled'} title="Mettre en premier">${icon('chevronDown', 12)}</button><button class="un-ibtn" data-list="backdrop" data-del="${i}" title="Retirer">${icon('x', 12)}</button></div>`).join('') || '<span class="in-note">Fond blanc</span>'}
    <button class="un-btn sm" data-add="backdrop">${icon('plus', 12)}Ajouter</button></div>`);
  html += scriptComp(st);
  html += projectComp();
  box.innerHTML = html;
  box.querySelectorAll('[data-up] .ic').forEach(i => { i.style.transform = 'rotate(180deg)'; });
  bindInsp(box, st, () => 'draw');
  bindLists(box, st);
}
function projectComp() {
  return comp('project', 'folder', 'Projet', `${lbl('Nom')}<span>${esc(S.config.name)}</span>${lbl('Type')}<span>${S.type === '3d' ? '3D' : S.type === 'app' ? 'Application' : '2D'}</span>
    ${lbl('Dossier')}<span class="in-note" title="${esc(DIR)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(DIR)}</span>${lbl('Format')}<span>.maxycode</span>`);
}
function renderEnv(box) {
  const e = S.scene.environment;
  let html = `<div class="in-head"><span class="big">${icon('scene', 18)}</span><b>${esc(stem(S.scenePath))}</b><span class="in-note">Réglages de la scène</span></div>`;
  html += comp('env', 'globe', 'Environnement', `${lbl('Ciel (haut)')}${color('skyTop', e.skyTop)}${lbl('Ciel (horizon)')}${color('skyBottom', e.skyBottom)}
    ${lbl('Lumière ambiante')}${range('ambient', e.ambient, 0, 2, 0.01)}${lbl('Soleil')}${color('sun.color', e.sun.color)}${lbl('Intensité')}${range('sun.intensity', e.sun.intensity, 0, 5, 0.05)}
    ${lbl('Direction')}${v3('sun.direction', e.sun.direction, 0.02)}${lbl('Ombres')}${check('sun.shadows', e.sun.shadows !== false, 'Activées')}
    ${lbl('Brouillard')}${check('fog.enabled', e.fog.enabled, 'Activé')}${lbl('Couleur')}${color('fog.color', e.fog.color)}${lbl('Début', 'fog.near', 0.5)}${num('fog.near', e.fog.near, 1)}${lbl('Fin', 'fog.far', 0.5)}${num('fog.far', e.fog.far, 1)}
    ${lbl('Gravité', 'gravity', 0.05)}${num('gravity', e.gravity, 0.1)}`);
  html += comp('worldScript', 'fileCode', 'Script du monde', `${lbl('Fichier')}${selectF('worldScript', S.scene.worldScript || '', scriptOptions())}
    <div class="full in-row2"><button class="un-btn sm" data-act="openWorld"${S.scene.worldScript ? '' : ' disabled'}>${icon('edit', 12)}Ouvrir</button><button class="un-btn sm" data-act="newWorld">${icon('plus', 12)}Nouveau script</button></div>
    <div class="full in-note">Ce script n'appartient à aucun objet : idéal pour les variables partagées et les règles du jeu.</div>`);
  html += projectComp();
  box.innerHTML = html;
  bindInsp(box, e, () => 'env', box.querySelector('[data-comp="env"]'));
  bindInsp(box.querySelector('[data-comp="worldScript"]'), S.scene, () => 'none');
  const act = (a, fn) => { const b = box.querySelector(`[data-act="${a}"]`); if (b) b.onclick = fn; };
  act('openWorld', () => openScript(S.scene.worldScript));
  act('newWorld', async () => { const rel = await newScript('Monde', 'when app run\n'); if (rel) { snapshot(); S.scene.worldScript = rel; saveScene(); renderInsp(); renderHier(); } });
}

function bindInsp(root, target, howOf, scope) {
  const area = scope || root;
  area.querySelectorAll('.in-ch').forEach(h => h.onclick = e => {
    if (e.target.closest('[data-remove]')) return;
    const c = h.parentElement, key = c.dataset.comp;
    S.closedComps.has(key) ? S.closedComps.delete(key) : S.closedComps.add(key);
    c.classList.toggle('closed');
    h.querySelector('.tw').innerHTML = icon(c.classList.contains('closed') ? 'chevronRight' : 'chevronDown', 12);
  });
  area.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k, t = el.dataset.t;
    const read = () => t === 'num' ? parseFloat(String(el.value).replace(',', '.')) : t === 'check' ? el.checked : t === 'range' ? parseFloat(el.value) : el.value;
    const evt = (t === 'check' || t === 'select' || t === 'name') ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const v = read();
      if ((t === 'num' || t === 'range') && !Number.isFinite(v)) return;
      if (t === 'range') { const out = area.querySelector(`[data-out="${k}"]`); if (out) out.textContent = fmt(v); }
      if (k === 'camera.main' && v) for (const c of S.scene.objects) if (c.kind === 'camera' && c !== target) c.camera.main = false;
      if (k === 'kind' && target.mesh) target.scale = target.kind === 'plane' && v !== 'plane' ? [1, 1, 1] : target.scale;
      applyChange(target, k, v, howOf(k));
      if (k === 'script' || k === 'worldScript') { renderHier(); renderInsp(); }
    });
    if (t === 'num') el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.blur();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = +el.dataset.step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        el.value = fmt((parseFloat(el.value) || 0) + step);
        el.dispatchEvent(new Event('input'));
      }
    });
  });
  // Glisser une étiquette pour changer la valeur, comme dans Unity
  area.querySelectorAll('[data-scrub]').forEach(lb => {
    lb.onmousedown = e => {
      e.preventDefault();
      const k = lb.dataset.scrub, step = +lb.dataset.step;
      const inp = area.querySelector(`[data-k="${k}"]`);
      if (!inp) return;
      let last = e.clientX;
      const move = ev => {
        const v = (parseFloat(inp.value) || 0) + (ev.clientX - last) * step * (ev.shiftKey ? 5 : 1);
        last = ev.clientX;
        inp.value = fmt(v);
        inp.dispatchEvent(new Event('input'));
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); document.body.style.cursor = ''; };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
      document.body.style.cursor = 'ew-resize';
    };
  });
  area.querySelectorAll('[data-remove]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    snapshot();
    const r = b.dataset.remove;
    if (r === 'rigidbody') target.rigidbody.enabled = false;
    else if (r === 'collider') target.collider = false;
    else if (r === 'script') target.script = '';
    if (S.type === '3d' && target.id) view.updateObject(target);
    saveScene(); renderInsp(); renderHier();
  });
  const act = (a, fn) => { const b = area.querySelector(`[data-act="${a}"]`); if (b) b.onclick = fn; };
  act('openScript', () => target.script && openScript(target.script));
  act('newScript', () => newScriptFor(target));
  act('prefabApply', () => applyPrefab(target.id));
  act('prefabUpdate', () => updateInstances(target.prefab));
  act('prefabDetach', () => detachPrefab(target.id));
  act('addComp', e => menuAt(e.currentTarget, [
    'Ajouter un composant',
    { label: 'Physique', ic: 'physics', disabled: target.rigidbody && target.rigidbody.enabled, fn: () => { snapshot(); target.rigidbody = { enabled: true, gravity: 1, bounce: 0 }; if (!target.collider) target.collider = true; saveScene(); renderInsp(); } },
    { label: 'Collision', ic: 'shield', disabled: !!target.collider, fn: () => { snapshot(); target.collider = true; saveScene(); renderInsp(); } },
    { label: 'Script existant…', ic: 'fileCode', disabled: !!target.script || !filesBy(['sc']).length, fn: () => { snapshot(); target.script = filesBy(['sc'])[0]; saveScene(); renderInsp(); renderHier(); } },
    { label: 'Nouveau script', ic: 'plus', disabled: !!target.script, fn: () => newScriptFor(target) }
  ]));
}
function bindLists(box, target) {
  const keyOf = kind => kind === 'image' ? 'costumes' : kind === 'sound' ? 'sounds' : 'backdrops';
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { snapshot(); target[keyOf(b.dataset.list)].splice(+b.dataset.del, 1); view.updateObject(target); saveScene(); renderInsp(); });
  box.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const list = target[keyOf(b.dataset.list)], i = +b.dataset.up;
    if (!i) return;
    snapshot(); [list[i - 1], list[i]] = [list[i], list[i - 1]]; view.updateObject(target); saveScene(); renderInsp();
  });
  box.querySelectorAll('[data-add]').forEach(b => b.onclick = e => {
    const kind = b.dataset.add;
    const files = kind === 'sound' ? filesBy(core.SOUND_EXT) : filesBy(core.IMAGE_EXT);
    menuAt(e.currentTarget, [
      kind === 'sound' ? 'Sons du projet' : 'Images du projet',
      ...(files.length ? files.map(rel => ({ label: rel, ic: kind === 'sound' ? 'volume' : 'image', fn: () => { snapshot(); target[keyOf(kind)].push(rel); view.updateObject(target); saveScene(); renderInsp(); } })) : [{ label: 'Aucun fichier : importe-en un', ic: 'info', disabled: true, fn: () => {} }]),
      '-', { label: 'Importer…', ic: 'download', fn: importAssets }
    ]);
  });
}

// Aperçu d'un asset (image, modèle 3D animé, son)
let preview = null;
function renderAssetInsp(box, rel) {
  const k = kindOf(rel);
  const node = allFiles().includes(rel) ? findNode(rel) : null;
  const size = node && node.size ? (node.size > 1048576 ? (node.size / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(node.size / 1024)) + ' Ko') : '';
  let html = `<div class="in-head"><span class="big">${icon(KIND_ICON[k], 18)}</span><b style="overflow:hidden;text-overflow:ellipsis">${esc(base(rel))}</b></div>`;
  let body = `${lbl('Chemin')}<span class="in-note">${esc(rel)}</span>${size ? lbl('Taille') + `<span>${size}</span>` : ''}`;
  if (k === 'image') body = `<div class="in-preview"><img src="${esc(resolveUrl(rel))}" alt=""></div>` + body;
  if (k === 'model') body = `<div class="in-preview" id="modelPrev"></div>${lbl('Animations')}<span class="in-note" id="prevAnims">chargement…</span>` + body;
  if (k === 'sound') body = `<div class="full"><audio controls src="${esc(resolveUrl(rel))}" style="width:100%"></audio></div>` + body;
  const actions = [];
  if (k === 'model' && S.type === '3d') actions.push(['addModel', 'plus', 'Ajouter à la scène']);
  if (k === 'image' && S.type !== '3d') actions.push(['addSprite', 'plus', 'Nouveau lutin'], ['addBackdrop', 'image', 'Arrière-plan']);
  if (k === 'sc' || k === 'md' || k === 'json') actions.push(['open', 'edit', 'Ouvrir']);
  actions.push(['reveal', 'external', 'Afficher dans l\'explorateur']);
  body += `<div class="full in-row2" style="flex-wrap:wrap">${actions.map(([a, ic, t]) => `<button class="un-btn sm" data-aact="${a}">${icon(ic, 12)}${t}</button>`).join('')}</div>`;
  html += comp('asset', KIND_ICON[k], 'Asset', body);
  box.innerHTML = html;
  const on = (a, fn) => { const b = box.querySelector(`[data-aact="${a}"]`); if (b) b.onclick = fn; };
  on('addModel', () => createObject('model', { name: stem(rel), model: rel }));
  on('addSprite', () => createObject('sprite', { costume: rel }));
  on('addBackdrop', () => { snapshot(); S.scene.stage.backdrops.unshift(rel); view.load(S.scene); saveScene(); select('__stage'); });
  on('open', () => openScript(rel));
  on('reveal', () => studio.reveal(DIR, rel));
  if (k === 'model') showModelPreview(box.querySelector('#modelPrev'), rel);
}
function findNode(rel, nodes = S.tree) {
  for (const n of nodes) { if (n.path === rel) return n; if (n.type === 'dir') { const f = findNode(rel, n.children); if (f) return f; } }
  return null;
}
async function showModelPreview(el, rel) {
  const THREE = core.THREE;
  if (!preview) {
    preview = { renderer: new THREE.WebGLRenderer({ antialias: true, alpha: true }), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(40, 1, 0.01, 1000) };
    preview.renderer.outputColorSpace = THREE.SRGBColorSpace;
    preview.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(3, 5, 4); preview.scene.add(d);
    const loop = () => {
      requestAnimationFrame(loop);
      if (!preview.model || !preview.renderer.domElement.isConnected) return;
      preview.model.rotation.y += 0.01;
      if (preview.mixer) preview.mixer.update(1 / 60);
      preview.renderer.render(preview.scene, preview.camera);
    };
    loop();
  }
  const w = el.clientWidth || 300, h = el.clientHeight || 180;
  preview.renderer.setSize(w, h);
  preview.camera.aspect = w / h; preview.camera.updateProjectionMatrix();
  el.appendChild(preview.renderer.domElement);
  if (preview.model) preview.scene.remove(preview.model);
  preview.model = null; preview.mixer = null;
  try {
    const { root, animations } = await core.loadModel(resolveUrl(rel));
    if (S.selAsset !== rel) return;
    const pivot = new THREE.Group(); pivot.add(root);
    const b = new THREE.Box3().setFromObject(root), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    root.position.sub(c);
    const r = Math.max(s.x, s.y, s.z) || 1;
    preview.camera.position.set(0, r * 0.35, r * 1.9); preview.camera.lookAt(0, 0, 0);
    preview.scene.add(pivot); preview.model = pivot;
    if (animations.length) { preview.mixer = new THREE.AnimationMixer(root); preview.mixer.clipAction(animations[0]).play(); }
    const a = document.getElementById('prevAnims');
    if (a) a.textContent = animations.length ? animations.map(x => x.name || 'sans nom').join(', ') : 'aucune';
  } catch (e) {
    const a = document.getElementById('prevAnims');
    if (a) a.textContent = 'Impossible de lire ce modèle : ' + cleanErr(e);
  }
}

// ---------------- Panneau Projet ----------------
function renderFolders() {
  const box = $('#folders');
  let html = `<div class="un-row${S.folder === '' ? ' sel' : ''}" data-dir="" style="padding-left:6px"><span class="tw">${icon('chevronDown', 12)}</span><span class="oi" style="color:#e2b44e">${icon('folderOpen', 14)}</span><span class="nm">${esc(S.config ? S.config.name : 'Projet')}</span></div>`;
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n.type !== 'dir') continue;
      const kids = n.children.some(c => c.type === 'dir');
      const open = S.folderOpen.has(n.path);
      html += `<div class="un-row${S.folder === n.path ? ' sel' : ''}" data-dir="${esc(n.path)}" style="padding-left:${6 + depth * 14}px"><span class="tw" data-ft="${esc(n.path)}">${kids ? icon(open ? 'chevronDown' : 'chevronRight', 12) : ''}</span><span class="oi" style="color:#e2b44e">${icon(open ? 'folderOpen' : 'folder', 14)}</span><span class="nm">${esc(n.name)}</span></div>`;
      if (kids && open) walk(n.children, depth + 1);
    }
  };
  walk(S.tree, 1);
  box.innerHTML = html;
  box.querySelectorAll('[data-dir]').forEach(el => {
    el.onclick = e => {
      const p = el.dataset.dir;
      if (e.target.closest('[data-ft]')) { S.folderOpen.has(p) ? S.folderOpen.delete(p) : S.folderOpen.add(p); renderFolders(); return; }
      S.folder = p; S.folderOpen.add(p); renderFolders(); renderAssets();
    };
    el.ondragover = e => { if (e.dataTransfer.types.includes('text/sc-asset')) { e.preventDefault(); el.classList.add('drop'); } };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = async e => {
      el.classList.remove('drop');
      const rel = e.dataTransfer.getData('text/sc-asset');
      if (!rel) return;
      e.preventDefault();
      const to = (el.dataset.dir ? el.dataset.dir + '/' : '') + base(rel);
      if (to !== rel) await moveAsset(rel, to);
    };
  });
}
function renderAssets() {
  const box = $('#assets');
  const q = $('#assetSearch').value.trim().toLowerCase();
  let items;
  if (q) items = allFiles().filter(f => f.toLowerCase().includes(q)).map(p => ({ type: 'file', path: p, name: base(p) }));
  else {
    const node = S.folder ? findNode(S.folder) : { children: S.tree };
    items = node ? node.children : [];
  }
  const crumbs = ['', ...(S.folder ? S.folder.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [])];
  $('#assetCrumbs').innerHTML = crumbs.map(c => `<button data-cd="${esc(c)}">${esc(c ? base(c) : (S.config ? S.config.name : 'Projet'))}</button>`).join(icon('chevronRight', 11));
  $('#assetCrumbs').querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { S.folder = b.dataset.cd; renderFolders(); renderAssets(); });
  box.innerHTML = items.map(n => {
    const k = n.type === 'dir' ? 'dir' : kindOf(n.path);
    const th = k === 'image' ? `<img src="${esc(resolveUrl(n.path))}" alt="" loading="lazy">` : icon(KIND_ICON[k], 30);
    return `<div class="un-asset${S.selAsset === n.path ? ' sel' : ''}" data-path="${esc(n.path)}" data-type="${n.type}" draggable="true" title="${esc(n.path)}"><div class="th k-${k}">${th}</div><div class="nm">${esc(n.name)}</div></div>`;
  }).join('') || `<div class="un-empty" style="grid-column:1/-1">${q ? 'Aucun fichier trouvé.' : 'Dossier vide. Dépose des fichiers ici ou clique sur Importer.<br>Modèles 3D : glb, gltf, obj, fbx, stl, ply, dae. Images : png, jpg, svg. Sons : mp3, wav, ogg.'}</div>`;
  box.querySelectorAll('.un-asset').forEach(el => {
    const p = el.dataset.path, isDir = el.dataset.type === 'dir';
    el.onclick = () => { if (!isDir) selectAsset(p); };
    el.ondblclick = () => {
      if (isDir) { S.folder = p; S.folderOpen.add(p); renderFolders(); renderAssets(); return; }
      const k = kindOf(p);
      if (k === 'sc' || k === 'md' || k === 'json') openScript(p);
      else if (k === 'scene') openScene(p);
      else if (k === 'prefab') placePrefab(p);
      else if (k === 'model' && S.type === '3d') createObject('model', { name: stem(p), model: p });
      else if (k === 'image' && S.type !== '3d') createObject('sprite', { costume: p });
      else selectAsset(p);
    };
    el.ondragstart = e => { e.dataTransfer.setData('text/sc-asset', p); e.dataTransfer.effectAllowed = 'copyMove'; };
    el.oncontextmenu = e => { e.preventDefault(); if (!isDir) selectAsset(p); showMenu(e.clientX, e.clientY, assetMenu(p, isDir)); };
    if (isDir) {
      el.ondragover = ev => { if (ev.dataTransfer.types.includes('text/sc-asset')) ev.preventDefault(); };
      el.ondrop = async ev => { const rel = ev.dataTransfer.getData('text/sc-asset'); if (rel && rel !== p) { ev.preventDefault(); await moveAsset(rel, p + '/' + base(rel)); } };
    }
  });
}
$('#assetSearch').oninput = renderAssets;
function assetMenu(p, isDir) {
  const k = isDir ? 'dir' : kindOf(p);
  return [
    !isDir && (k === 'sc' || k === 'md' || k === 'json') && { label: 'Ouvrir', ic: 'edit', fn: () => openScript(p) },
    k === 'model' && S.type === '3d' && { label: 'Ajouter à la scène', ic: 'plus', fn: () => createObject('model', { name: stem(p), model: p }) },
    k === 'image' && S.type !== '3d' && { label: 'Nouveau lutin avec cette image', ic: 'sprite', fn: () => createObject('sprite', { costume: p }) },
    { label: 'Renommer…', ic: 'edit', fn: () => renameAsset(p) },
    { label: 'Supprimer', ic: 'trash', fn: () => deleteAsset(p) },
    '-',
    { label: 'Copier le chemin', ic: 'copy', fn: () => { navigator.clipboard.writeText(p); toast('Chemin copié : ' + p); } },
    { label: 'Afficher dans l\'explorateur', ic: 'external', fn: () => studio.reveal(DIR, p) }
  ];
}
async function moveAsset(from, to) {
  try {
    await studio.renameFile(DIR, from, to);
    retarget(from, to);
    await refreshTree();
    log('log', `Déplacé : ${from} → ${to}`);
  } catch (e) { toast(cleanErr(e), true); }
}
// Met à jour les références de la scène quand un fichier change de nom
function retarget(from, to) {
  const fix = v => v === from ? to : (typeof v === 'string' && v.startsWith(from + '/') ? to + v.slice(from.length) : v);
  let changed = false;
  const walk = o => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string') { const n = fix(o[k]); if (n !== o[k]) { o[k] = n; changed = true; } }
      else if (o[k] && typeof o[k] === 'object') walk(o[k]);
    }
  };
  walk(S.scene);
  if (S.models.has(from)) {
    const m = S.models.get(from); S.models.delete(from); S.models.set(to, m);
    S.saved.set(to, S.saved.get(from)); S.saved.delete(from);
    S.tabs = S.tabs.map(t => t === from ? to : t); if (S.active === from) S.active = to;
    renderTabs();
  }
  if (changed) { saveScene(); view.load(S.scene); renderHier(); renderInsp(); }
}
async function renameAsset(p) {
  const v = await ask('Renommer', base(p));
  if (!v || v === base(p)) return;
  const to = p.split('/').slice(0, -1).concat(v.replace(/[<>:"/\\|?*]/g, '')).join('/');
  await moveAsset(p, to);
}
async function deleteAsset(p) {
  const ok = await confirmBox('Supprimer', `Mettre « ${p} » à la corbeille ?`);
  if (!ok) return;
  await studio.deleteFile(DIR, p);
  if (S.models.has(p)) closeTab(p, true);
  if (S.selAsset === p) S.selAsset = null;
  await refreshTree(); renderInsp();
  log('log', `Mis à la corbeille : ${p}`);
}
const importFolder = () => S.folder && !S.folder.startsWith('scripts') && !S.folder.startsWith('scenes') ? S.folder : 'assets';
async function importAssets() {
  const list = await studio.importAssets(DIR, importFolder());
  afterImport(list);
}
async function afterImport(list) {
  if (!list || !list.length) return;
  await refreshTree();
  S.folder = list[0].split('/').slice(0, -1).join('/');
  renderFolders(); renderAssets();
  for (const rel of list) log('ok', `Importé : ${rel}`);
  toast(list.length === 1 ? `Importé : ${base(list[0])}` : `${list.length} fichiers importés`);
  selectAsset(list[0]);
}
$('#importBtn').onclick = importAssets;
$('#createBtn').onclick = e => menuAt(e.currentTarget, ['Créer',
  { label: 'Script MaxyCode', ic: 'fileCode', fn: () => newScript('Script', 'when app run\n') },
  { label: 'Dossier', ic: 'folderPlus', fn: async () => { const n = await ask('Nom du dossier', 'Nouveau dossier'); if (n) { await studio.mkdir(DIR, (S.folder ? S.folder + '/' : '') + n.replace(/[<>:"/\\|?*]/g, '')); await refreshTree(); } } }
]);
// Glisser des fichiers depuis l'explorateur
const wrap = document.querySelector('.un-assets-wrap');
wrap.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); $('#dropHint').classList.add('show'); } });
wrap.addEventListener('dragleave', e => { if (!wrap.contains(e.relatedTarget)) $('#dropHint').classList.remove('show'); });
wrap.addEventListener('drop', async e => {
  $('#dropHint').classList.remove('show');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map(f => studio.pathForFile(f)).filter(Boolean);
  afterImport(await studio.importPaths(DIR, importFolder(), paths));
});

// Dépôt d'un asset dans la vue Scène ou la hiérarchie
async function dropAsset(rel, point, onId) {
  const k = kindOf(rel);
  if (k === 'prefab') return placePrefab(rel, point);
  const target = onId && findObj(onId);
  if (S.type === '3d') {
    if (k === 'model') return createObject('model', { name: stem(rel), model: rel, position: point ? point.map(v => Math.round(v * 100) / 100) : spawnPoint() }, null);
    if (k === 'image' && target && target.mesh) { applyChange(target, 'mesh.texture', rel, 'rebuild'); renderInsp(); return status(`Texture appliquée à « ${target.name} »`); }
    if (k === 'sc' && target) { snapshot(); target.script = rel; saveScene(); renderHier(); renderInsp(); return; }
  } else {
    if (k === 'image' && target) { snapshot(); target.costumes.push(rel); view.updateObject(target); saveScene(); renderInsp(); return status(`Costume ajouté à « ${target.name} »`); }
    if (k === 'image') return createObject('sprite', { costume: rel, x: point ? point[0] : 0, y: point ? point[1] : 0 });
    if (k === 'sound' && target) { snapshot(); target.sounds.push(rel); saveScene(); renderInsp(); return; }
    if (k === 'sc' && target) { snapshot(); target.script = rel; saveScene(); renderHier(); renderInsp(); return; }
  }
  toast('Cet asset ne peut pas être déposé ici.', true);
}

// ---------------- Scripts (onglets de code) ----------------
async function newScript(name, code) {
  const n = await ask('Nom du script', name);
  if (!n) return null;
  let rel = `scripts/${n.replace(/[<>:"/\\|?*]/g, '').replace(/\.sc$/, '')}.sc`;
  if (allFiles().includes(rel)) { toast('Un script porte déjà ce nom : il est réutilisé.'); }
  else await writeText(rel, code);
  await refreshTree();
  openScript(rel);
  return rel;
}
async function newScriptFor(target) {
  const code = 'when app run\n';
  const rel = await newScript(target.name || 'Script', code);
  if (!rel) return;
  snapshot();
  target.script = rel;
  saveScene(); renderHier(); renderInsp();
}
async function openScript(rel, line) {
  if (!rel) return;
  if (!monaco) return toast('L\'éditeur de code se charge encore.');
  if (!S.models.has(rel)) {
    let text;
    try { text = await studio.readFile(DIR, rel); } catch { return toast(`Fichier introuvable : ${rel}`, true); }
    const lang = rel.endsWith('.sc') ? 'scratchcode' : rel.endsWith('.md') ? 'markdown' : (rel.endsWith('.json') || rel.endsWith('.maxycode') || rel.endsWith('.scratchcode') || rel.endsWith('.scene')) ? 'json' : 'plaintext';
    const model = monaco.editor.createModel(text, lang, monaco.Uri.parse('file:///' + encodeURI(rel)));
    model.onDidChangeContent(() => renderTabs());
    S.models.set(rel, model); S.saved.set(rel, text);
  }
  if (!S.tabs.includes(rel)) S.tabs.push(rel);
  activateTab(rel);
  applyMarkers(rel);
  if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
  editor.focus();
}
const isDirty = rel => S.models.has(rel) && S.models.get(rel).getValue() !== S.saved.get(rel);
async function saveScript(rel) {
  const m = S.models.get(rel); if (!m) return;
  await writeText(rel, m.getValue());
  S.saved.set(rel, m.getValue());
  renderTabs();
}
async function saveAll() {
  for (const rel of S.tabs.filter(t => S.models.has(t) && isDirty(t))) await saveScript(rel);
  await saveSceneNow();
  savedNote('Tout est enregistré');
  if (plugins) plugins.emit('save');
}
function closeTab(rel, force) {
  if (!force && isDirty(rel)) saveScript(rel);
  S.tabs = S.tabs.filter(t => t !== rel);
  const m = S.models.get(rel);
  if (force && m) { m.dispose(); S.models.delete(rel); }
  if (S.active === rel) activateTab('scene'); else renderTabs();
}
function renderTabs() {
  const box = $('#centerTabs');
  box.innerHTML = S.tabs.map(t => {
    const fixed = t === 'scene' || t === 'game';
    const label = t === 'scene' ? 'Scène' : t === 'game' ? 'Jeu' : base(t);
    const ic = t === 'scene' ? (S.type === '3d' ? 'box' : 'image') : t === 'game' ? 'gamepad' : 'fileCode';
    return `<button class="un-tab${S.active === t ? ' active' : ''}" data-tab="${esc(t)}" title="${esc(fixed ? label : t)}">${icon(ic, 13)}<span>${esc(label)}</span>${fixed ? '' : isDirty(t) ? '<span class="dot"></span>' : `<span class="x" data-close>${icon('x', 11)}</span>`}</button>`;
  }).join('');
  box.querySelectorAll('[data-tab]').forEach(b => {
    b.onclick = e => e.target.closest('[data-close]') ? closeTab(b.dataset.tab) : activateTab(b.dataset.tab);
    b.onauxclick = e => { if (e.button === 1 && !['scene', 'game'].includes(b.dataset.tab)) closeTab(b.dataset.tab); };
  });
}
function activateTab(t) {
  S.active = t;
  $('#sceneView').hidden = t !== 'scene';
  $('#gameView').hidden = t !== 'game';
  $('#codeView').hidden = t === 'scene' || t === 'game';
  if (t !== 'scene' && t !== 'game' && editor) {
    editor.setModel(S.models.get(t));
    updateInspection();
    $('#statusCursor').textContent = '';
  }
  if (t === 'scene' && view && view.fit) view.fit();
  renderTabs();
}

// ---------------- Console ----------------
function log(level, text, opts = {}) {
  S.logs.push({ level, text: String(text), who: opts.who || '', loc: opts.loc || null, t: new Date().toLocaleTimeString('fr-FR') });
  if (S.logs.length > 1500) S.logs.shift();
  renderConsoleSoon();
}
const renderConsoleSoon = debounce(renderConsole, 30);
function renderConsole() {
  const box = $('#consoleView');
  const counts = { log: 0, warn: 0, error: 0 };
  for (const l of S.logs) counts[l.level === 'ok' ? 'log' : l.level]++;
  $('#nLog').textContent = counts.log; $('#nWarn').textContent = counts.warn; $('#nErr').textContent = counts.error;
  $('#logCount').textContent = counts.error || '';
  let list = S.logs.filter(l => S.levels[l.level === 'ok' ? 'log' : l.level]);
  if (S.collapse) {
    const map = new Map();
    for (const l of list) { const k = l.level + l.who + l.text; const e = map.get(k); if (e) e.n++; else map.set(k, { ...l, n: 1 }); }
    list = [...map.values()];
  }
  const ic = { log: 'info', ok: 'check', warn: 'alertTri', error: 'alert' };
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.innerHTML = list.slice(-600).map((l, i) => `<div class="lg ${l.level}"><span class="li">${icon(ic[l.level], 13)}</span><span class="lt">${l.who ? `<span class="who">${esc(l.who)}</span>` : ''}${esc(l.text)}${l.loc ? ` <span class="loc" data-i="${i}">${esc(l.loc.rel)}:${l.loc.line}</span>` : ''}</span>${l.n > 1 ? `<span class="n">${l.n}</span>` : ''}<span class="tm">${l.t}</span></div>`).join('');
  const shown = list.slice(-600);
  box.querySelectorAll('.loc').forEach(el => el.onclick = () => { const l = shown[+el.dataset.i]; openScript(l.loc.rel, l.loc.line); });
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function clearLogs() { S.logs = []; renderConsole(); }
$('#clearLog').onclick = clearLogs;
$('#collapseLog').onclick = e => { S.collapse = !S.collapse; e.currentTarget.classList.toggle('on', S.collapse); renderConsole(); };
$('#clearOnPlay').onclick = e => { S.clearOnPlay = !S.clearOnPlay; e.currentTarget.classList.toggle('on', S.clearOnPlay); };
document.querySelectorAll('.lv').forEach(b => b.onclick = () => { S.levels[b.dataset.lv] = !S.levels[b.dataset.lv]; b.classList.toggle('on'); renderConsole(); });
function showBottom(tab) {
  document.querySelectorAll('[data-btab]').forEach(b => b.classList.toggle('active', b.dataset.btab === tab));
  $('#projectView').hidden = tab !== 'project';
  $('#consoleView').hidden = tab !== 'console';
  $('#libraryView').hidden = tab !== 'library';
  $('#projTools').hidden = tab !== 'project';
  $('#consoleTools').hidden = tab !== 'console';
  $('#libTools').hidden = tab !== 'library';
  if (tab === 'console') renderConsole();
  if (tab === 'library') openLibrary();
}

// ---------------- Bibliothèque d'assets (packs Kenney, CC0) ----------------
const LIB = { index: null, type: null, pack: '', q: '', sel: null, shown: 120, audio: null };
const LIB_TYPES = [['modele', 'Modèles 3D'], ['son', 'Sons'], ['texture', 'Textures'], ['image', 'Interface']];
async function openLibrary() {
  if (!LIB.index) {
    try { LIB.index = await studio.library.index(); }
    catch (e) { $('#libInfo').textContent = 'Bibliothèque introuvable : ' + cleanErr(e); return; }
    LIB.type = S.type === '3d' ? 'modele' : 'image';
    $('#libTypes').innerHTML = LIB_TYPES.map(([k, l]) => `<button class="un-chip" data-lt="${k}">${l}</button>`).join('');
    $('#libTypes').querySelectorAll('[data-lt]').forEach(b => b.onclick = () => { LIB.type = b.dataset.lt; LIB.pack = ''; LIB.shown = 120; fillPacks(); renderLibrary(); });
    $('#libPack').onchange = () => { LIB.pack = $('#libPack').value; LIB.shown = 120; renderLibrary(); };
    $('#libSearch').oninput = () => { LIB.q = $('#libSearch').value.trim().toLowerCase(); LIB.shown = 120; renderLibrary(); };
    fillPacks();
  }
  renderLibrary();
}
function fillPacks() {
  const packs = LIB.index.packs.filter(p => LIB.index.items.some(i => i.pack === p.id && i.type === LIB.type));
  $('#libPack').innerHTML = `<option value="">Tous les packs</option>` + packs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#libTypes').querySelectorAll('[data-lt]').forEach(b => b.classList.toggle('on', b.dataset.lt === LIB.type));
}
function libItems() {
  const words = LIB.q.split(/\s+/).filter(Boolean);
  return LIB.index.items.filter(i => i.type === LIB.type && (!LIB.pack || i.pack === LIB.pack) &&
    words.every(w => (i.name + ' ' + i.packName + ' ' + i.pack + ' ' + i.file).toLowerCase().includes(w)));
}
function renderLibrary() {
  if (!LIB.index) return;
  const list = libItems();
  $('#libInfo').textContent = `${list.length} élément${list.length > 1 ? 's' : ''} · Kenney (kenney.nl), licence CC0 : libres d'utilisation, même dans un jeu publié.`;
  const shown = list.slice(0, LIB.shown);
  $('#libGrid').innerHTML = shown.map((it, i) => `<button class="lib-card${LIB.sel === it ? ' sel' : ''}" data-i="${i}" title="${esc(it.name)} (${esc(it.packName)})">
      ${it.thumb ? `<img src="/library/${esc(it.thumb)}" loading="lazy" alt="">` : `<span class="lib-ic">${icon(it.type === 'son' ? 'volume' : 'box', 26)}</span>`}
      <span class="nm">${esc(it.name)}</span></button>`).join('') +
    (list.length > shown.length ? `<button class="lib-more" id="libMore">Afficher plus (${list.length - shown.length})</button>` : '');
  $('#libGrid').querySelectorAll('.lib-card').forEach(b => {
    const it = shown[+b.dataset.i];
    b.onclick = () => { LIB.sel = it; $('#libGrid').querySelectorAll('.lib-card').forEach(x => x.classList.toggle('sel', x === b)); libActions(); if (it.type === 'son') playLib(it); };
    b.ondblclick = () => addLib(it);
  });
  const more = $('#libMore'); if (more) more.onclick = () => { LIB.shown += 240; renderLibrary(); };
  libActions();
}
function libActions() {
  const it = LIB.sel && LIB.sel.type === LIB.type ? LIB.sel : null;
  if (!it) { $('#libActions').innerHTML = '<span class="un-dim">Clique sur un élément, double-clique pour l\'ajouter.</span>'; return; }
  const toScene = (it.type === 'modele' && S.type === '3d') || ((it.type === 'image' || it.type === 'texture') && S.type !== '3d');
  $('#libActions').innerHTML = `<b>${esc(it.name)}</b>` + (it.type === 'son' ? `<button class="un-btn sm" id="libPlay">${icon('play', 12)}Écouter</button>` : '') +
    `<button class="un-btn sm primary" id="libAdd">${icon('plus', 12)}${toScene ? 'Ajouter à la scène' : 'Ajouter au projet'}</button>`;
  $('#libAdd').onclick = () => addLib(it);
  const p = $('#libPlay'); if (p) p.onclick = () => playLib(it);
}
function playLib(it) {
  if (LIB.audio) LIB.audio.pause();
  LIB.audio = new Audio(`/library/${it.file}`); LIB.audio.play().catch(() => {});
}
async function addLib(it) {
  if (S.mode !== 'edit') return toast('Arrête le jeu pour modifier le projet.', true);
  try {
    const rel = await studio.library.import(DIR, it.file);
    await refreshTree();
    if (it.type === 'modele' && S.type === '3d') { await createObject('model', { name: it.name, model: rel }); toast(`« ${it.name} » ajouté à la scène.`); }
    else if ((it.type === 'image' || it.type === 'texture') && S.type !== '3d') { await createObject('sprite', { costume: rel }); toast(`Lutin « ${it.name} » ajouté.`); }
    else toast(`« ${it.name} » ajouté au projet : ${rel}`);
    log('ok', `Bibliothèque : ${rel}`);
  } catch (e) { toast(cleanErr(e), true); }
}
document.querySelectorAll('[data-btab]').forEach(b => b.onclick = () => showBottom(b.dataset.btab));


// ---------------- Lancer une scène (Lecture, ou changement de niveau en jeu) ----------------
async function runScene(sc, scene, vars, name) {
  sc.vm.stopAll();
  const b64 = await studio.playArchive(DIR, playSpec(scene));
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  // Le tampon doit appartenir à la fenêtre du moteur (sinon « instanceof ArrayBuffer » échoue)
  await sc.loadSb3(new frame.contentWindow.Uint8Array(bytes).buffer);
  await sc.loadExtension(EXTUI);
  if (S.type === '3d') await sc.loadExtension(EXT3D);
  frame.contentWindow.__scProject = { type: S.type, scene: JSON.parse(JSON.stringify(scene)), base: S.base };
  frame.contentWindow.__maxySceneName = name;
  frame.contentWindow.__maxyGoToScene = goToScene;
  frame.contentWindow.__scPaused = false;
  for (const el of frame.contentDocument.querySelectorAll('html, body, .gui, .stage-pane, .stage-wrap')) { el.scrollTop = 0; el.scrollLeft = 0; }
  const vm = sc.vm;
  let errors = 0;
  S.problems = {};
  const compile = async (target, rel) => {
    // MaxyCode (fonctions qui renvoient une valeur…) est d'abord traduit en blocs Scratch ; les erreurs gardent les lignes d'origine.
    const src = await readScript(rel);
    // Modules importés (scripts du projet) : lus d'avance, avec leurs propres imports
    const mods = {};
    const load = async text => {
      for (const name of findImports(text)) {
        if (name in mods || STDLIB[name] != null) continue;
        mods[name] = allFiles().includes(name) ? await readScript(name) : null;
        if (mods[name]) await load(mods[name]);
      }
    };
    await load(src);
    const mc = compileMaxyCode(src, { resolve: name => mods[name] ?? null });
    const list = (await sc.setCode(target, mc.code)) || [];
    const errs = [...mc.errors, ...list.map(e => {
      const raw = Number(e.line ?? e.lineNumber ?? (e.from && e.from.line) ?? 1) || 1;
      const from = originOf(mc, raw);
      return { line: originalLine(mc, raw), message: (from ? `[${from}] ` : '') + String(e.message ?? e.msg ?? e) };
    })];
    if (rel) S.problems[rel] = (S.problems[rel] || []).concat(errs);
    for (const e of errs) { errors++; log('error', e.message, { loc: { rel, line: e.line } }); }
  };
  const stageRel = S.type === '3d' ? scene.worldScript : scene.stage.script;
  await compile(vm.runtime.getTargetForStage(), stageRel);
  const byName = new Map(vm.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => [t.getName(), t]));
  for (const o of scene.objects) {
    const t = byName.get(o.name);
    if (t && o.script) await compile(t, o.script);
  }
  for (const rel of S.models.keys()) applyMarkers(rel);
  updateInspection();
  if (errors) log('warn', `${errors} erreur${errors > 1 ? 's' : ''} : les scripts concernés ne sont pas chargés.`);
  else log('ok', 'Compilation réussie, aucune erreur.');
  if (vars) restoreVars(vm, vars);
  vm.greenFlag();
  frame.focus();
}
/** Variables de la Scène (hors variables internes « _… ») : elles passent d'un niveau à l'autre. */
function saveVars(vm) {
  const st = vm.runtime.getTargetForStage();
  return Object.values(st.variables).filter(v => (v.type === '' || v.type === 'list') && !v.name.startsWith('_'))
    .map(v => ({ name: v.name, type: v.type, value: Array.isArray(v.value) ? v.value.slice() : v.value }));
}
function restoreVars(vm, vars) {
  const st = vm.runtime.getTargetForStage();
  for (const s of vars) {
    let v = Object.values(st.variables).find(x => x.name === s.name && x.type === s.type);
    if (!v) { st.createVariable(`maxy_${s.type}_${s.name}`, s.name, s.type); v = Object.values(st.variables).find(x => x.name === s.name && x.type === s.type); }
    if (v) v.value = Array.isArray(s.value) ? s.value.slice() : s.value;
  }
}
const sceneFiles = () => allFiles().filter(r => r.endsWith('.scene')).sort();
const findSceneFile = name => {
  const n = String(name).trim().replace(/\.scene$/i, '');
  return sceneFiles().find(r => stem(r) === n) || sceneFiles().find(r => stem(r).toLowerCase() === n.toLowerCase()) || null;
};
/** Bloc « go to scene [nom] » : charge une autre scène pendant le jeu, en gardant les variables de la Scène. */
async function goToScene(name) {
  if (S.mode === 'edit') return;
  const rel = findSceneFile(name);
  if (!rel) { log('error', `Scène introuvable : « ${name} ». Scènes du projet : ${sceneFiles().map(stem).join(', ')}.`); return; }
  try {
    const scene = rel === S.scenePath ? JSON.parse(JSON.stringify(S.scene)) : JSON.parse(await studio.readFile(DIR, rel));
    normalizeScene(scene);
    const sc = engine();
    const vars = saveVars(sc.vm);
    log('log', `Scène « ${stem(rel)} »`);
    await runScene(sc, scene, vars, stem(rel));
  } catch (e) { log('error', 'Changement de scène impossible : ' + cleanErr(e)); }
}

// ---------------- Scènes : créer, ouvrir, scène de départ ----------------
async function openScene(rel) {
  if (rel === S.scenePath) return;
  if (S.mode !== 'edit') return toast('Arrête le jeu pour changer de scène.', true);
  await saveSceneNow();
  S.scenePath = rel; S.undo = []; S.redo = []; S.sel = null;
  await loadScene();
  activateTab('scene');
  status(`Scène « ${stem(rel)} » ouverte`);
}
async function newScene() {
  if (S.mode !== 'edit') return toast('Arrête le jeu pour créer une scène.', true);
  const n = await ask('Nom de la nouvelle scène', `Niveau ${sceneFiles().length + 1}`);
  if (!n) return;
  const rel = `scenes/${n.replace(/[<>:"/\\|?*]/g, '').trim()}.scene`;
  if (allFiles().includes(rel)) return toast('Une scène porte déjà ce nom.', true);
  const cur = S.scene;
  const scene = S.type === '3d'
    ? { format: 'scratchcode-scene', version: 1, type: '3d', environment: JSON.parse(JSON.stringify(cur.environment || {})), worldScript: cur.worldScript || '',
        objects: cur.objects.filter(o => o.kind === 'camera').slice(0, 1).map(o => ({ ...JSON.parse(JSON.stringify(o)), id: core.newId(), parent: null })) }
    : { format: 'scratchcode-scene', version: 1, type: S.type, stage: { backdrops: (cur.stage.backdrops || []).slice(0, 1), script: cur.stage.script || '' }, objects: [] };
  await writeText(rel, JSON.stringify(scene, null, 2));
  await refreshTree();
  await openScene(rel);
  log('ok', `Scène créée : ${rel}. Le script de la scène est partagé ; change de niveau en jeu avec go to scene [${stem(rel)}].`);
}
function chooseScene() {
  const items = sceneFiles().map(rel => ({ label: stem(rel) + (rel === (S.config.mainScene || 'scenes/Main.scene') ? ' (départ)' : ''), ic: 'scene', disabled: rel === S.scenePath, fn: () => openScene(rel) }));
  showMenu(innerWidth / 2 - 120, 60, items.length ? items : [{ label: 'Aucune autre scène', ic: 'info', disabled: true, fn: () => {} }]);
}
async function setStartScene() {
  const cfgRel = allFiles().includes('project.maxycode') ? 'project.maxycode' : 'project.scratchcode';
  S.config.mainScene = S.scenePath;
  await writeText(cfgRel, JSON.stringify(S.config, null, 2));
  renderHier();
  toast(`« ${stem(S.scenePath)} » est la scène de départ.`);
}

// ---------------- Prefabs : un objet (avec ses enfants et son script) réutilisable ----------------
function prefabComp(o) {
  return comp('prefab', 'copy', 'Prefab', `<div class="full in-note">Instance de <b>${esc(stem(o.prefab))}</b>. Modifie-la, puis applique les changements au prefab, ou mets à jour toutes ses instances de la scène.</div>
    <div class="full in-row2"><button class="un-btn sm" data-act="prefabApply">${icon('save', 12)}Appliquer au prefab</button><button class="un-btn sm" data-act="prefabUpdate">${icon('refresh', 12)}Mettre à jour les instances</button></div>
    <div class="full in-row2"><button class="un-btn sm" data-act="prefabDetach">${icon('x', 12)}Détacher du prefab</button></div>`);
}
/** Copie d'un objet et de ses descendants, avec des positions relatives à la racine. */
function prefabData(root) {
  const objs = [root, ...(S.type === '3d' ? descendants(root.id) : [])].map(o => JSON.parse(JSON.stringify(o)));
  objs[0] = { ...objs[0], parent: null };
  delete objs[0].prefab;
  return { format: 'maxy-prefab', version: 1, type: S.type, objects: objs };
}
async function makePrefab(id) {
  const o = findObj(id); if (!o) return;
  const n = await ask('Nom du prefab', o.name);
  if (!n) return;
  const rel = `assets/prefabs/${n.replace(/[<>:"/\\|?*]/g, '').trim()}.prefab`;
  await writeText(rel, JSON.stringify(prefabData(o), null, 2));
  snapshot(); o.prefab = rel; saveScene();
  await refreshTree(); renderHier(); renderInsp();
  toast(`Prefab créé : ${rel}. Double-clique dessus (panneau Projet) pour en placer d'autres.`);
}
/** Place une instance du prefab dans la scène (au point visé, ou devant la caméra). */
async function placePrefab(rel, point) {
  if (S.mode !== 'edit') return toast('Arrête le jeu pour modifier la scène.', true);
  let data;
  try { data = JSON.parse(await studio.readFile(DIR, rel)); } catch { return toast('Prefab illisible.', true); }
  if (data.type !== S.type) return toast(`Ce prefab est fait pour un projet ${data.type === '3d' ? '3D' : '2D'}.`, true);
  snapshot();
  const map = new Map();
  const objs = data.objects.map(o => { const c = JSON.parse(JSON.stringify(o)); map.set(o.id, c.id = core.newId()); return c; });
  for (const c of objs) if (c.parent) c.parent = map.get(c.parent) || null;
  const root = objs[0];
  root.name = uniqueName(root.name);
  root.prefab = rel;
  if (S.type === '3d') root.position = point ? point.map(v => Math.round(v * 100) / 100) : spawnPoint();
  else if (point) { root.x = point[0]; root.y = point[1]; }
  S.scene.objects.push(...objs);
  await view.load(S.scene);
  select(root.id); saveScene(); renderHier();
  status(`Instance de « ${stem(rel)} » placée`);
}
async function applyPrefab(id) {
  const o = findObj(id); if (!o || !o.prefab) return;
  await writeText(o.prefab, JSON.stringify(prefabData(o), null, 2));
  toast(`Prefab « ${stem(o.prefab)} » mis à jour. « Mettre à jour les instances » recopie ces changements sur les autres.`);
}
/** Remplace chaque instance du prefab dans la scène par son contenu, en gardant sa position, sa rotation et son nom. */
async function updateInstances(rel) {
  let data;
  try { data = JSON.parse(await studio.readFile(DIR, rel)); } catch { return toast('Prefab illisible.', true); }
  const roots = S.scene.objects.filter(o => o.prefab === rel);
  if (!roots.length) return;
  snapshot();
  for (const r of roots) {
    const drop = new Set([r.id, ...(S.type === '3d' ? descendants(r.id).map(d => d.id) : [])]);
    const keep = S.type === '3d' ? { position: r.position, rotation: r.rotation, name: r.name, parent: r.parent } : { x: r.x, y: r.y, name: r.name };
    const at = S.scene.objects.indexOf(r);
    S.scene.objects = S.scene.objects.filter(o => !drop.has(o.id));
    const map = new Map();
    const objs = data.objects.map(o => { const c = JSON.parse(JSON.stringify(o)); map.set(o.id, c.id = o === data.objects[0] ? r.id : core.newId()); return c; });
    for (const c of objs) if (c.parent && map.has(c.parent)) c.parent = map.get(c.parent);
    Object.assign(objs[0], keep, { prefab: rel });
    S.scene.objects.splice(Math.min(at, S.scene.objects.length), 0, ...objs);
  }
  await view.load(S.scene);
  saveScene(); renderHier(); renderInsp();
  toast(`${roots.length} instance${roots.length > 1 ? 's' : ''} de « ${stem(rel)} » mise${roots.length > 1 ? 's' : ''} à jour.`);
}
function detachPrefab(id) {
  const o = findObj(id); if (!o) return;
  snapshot(); delete o.prefab; saveScene(); renderInsp(); renderHier();
}

// ---------------- Moteur de jeu (onglet Jeu) ----------------
const frame = $('#engine');
const ENGINE_CSS = `
  html,body{background:#111!important;overflow:hidden!important}
  .menubar,.editor-pane,.target-pane,.stage-header,.bottom-nav,.m-sheet,.sheet-back,.toast,.modal-back,.backpack{display:none!important}
  .gui{padding:0!important;margin:0!important;height:100vh!important;display:flex!important;align-items:center!important;justify-content:center!important}
  .stage-pane{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important;gap:0!important}
  .stage-wrap{width:min(100vw,calc(100vh * 4 / 3))!important;border:0!important;border-radius:0!important}`;
const engine = () => frame.contentWindow && frame.contentWindow.scratchcode;
function waitEngine(timeout = 30000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      const sc = engine();
      if (sc && sc.vm && sc.setCode && sc.loadSb3) return res(sc);
      if (Date.now() - t0 > timeout) return rej(new Error('Le moteur de jeu ne répond pas.'));
      setTimeout(poll, 120);
    })();
  });
}
// Le moteur charge d'abord son propre projet de démarrage : on attend qu'il ait fini avant de lancer le jeu.
let engineSettled = null;
const settleEngine = sc => engineSettled || (engineSettled = (async () => {
  const t0 = Date.now();
  while (!sc.vm.runtime.targets.length && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 1200));
})());
frame.addEventListener('load', async () => {
  const doc = frame.contentDocument;
  const st = doc.createElement('style'); st.textContent = ENGINE_CSS; doc.head.appendChild(st);
  // Les flèches et la barre d'espace servent au jeu : elles ne doivent pas faire défiler la page du moteur
  doc.addEventListener('keydown', e => {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) e.preventDefault();
  });
  doc.addEventListener('scroll', () => { if (doc.scrollingElement && doc.scrollingElement.scrollTop) doc.scrollingElement.scrollTop = 0; }, true);
  try {
    const sc = await waitEngine();
    await settleEngine(sc);
    $('#engineLoading').style.display = 'none';
    sc.vm.runtime.on('SAY', (target, type, text) => { if (S.mode !== 'edit' && text !== '' && text != null) log('log', `${type === 'think' ? 'pense' : 'dit'} : ${text}`, { who: target.getName() }); });
    sc.vm.runtime.on('SC_PRINT', m => log(m.level === 'error' ? 'error' : 'log', m.text, { who: m.who }));
    log('log', 'Moteur de jeu prêt.');
  } catch (e) { $('#engineLoading').textContent = cleanErr(e); log('error', cleanErr(e)); }
});
const EXT3D = new URL('sc3d-ext.js', location.href).href;
const EXTUI = new URL('scui-ext.js', location.href).href;
async function readScript(rel) {
  if (!rel) return '';
  if (S.models.has(rel)) return S.models.get(rel).getValue();
  try { return await studio.readFile(DIR, rel); } catch { log('error', `Script introuvable : ${rel}`); return ''; }
}
function playSpec(scene = S.scene) {
  const names = new Set();
  const sprites = [];
  for (const o of scene.objects) {
    if (S.type === '3d') {
      if (!o.script) continue;
      if (names.has(o.name)) { log('warn', `Deux objets s'appellent « ${o.name} » : seul le premier exécute son script. Renomme l'autre.`); continue; }
      names.add(o.name);
      sprites.push({ name: o.name, visible: false, costumes: [] });
    } else {
      if (names.has(o.name)) { log('warn', `Deux lutins s'appellent « ${o.name} ».`); continue; }
      names.add(o.name);
      sprites.push({ name: o.name, x: o.x, y: o.y, size: o.size, direction: o.direction, visible: o.visible !== false, rotationStyle: o.rotationStyle, draggable: o.draggable, costumes: o.costumes.map(rel => ({ rel, name: stem(rel) })), sounds: o.sounds.map(rel => ({ rel, name: stem(rel) })) });
    }
  }
  const backdrops = S.type === '3d' ? [] : (scene.stage.backdrops || []).map(rel => ({ rel, name: stem(rel) }));
  return { stage: { costumes: backdrops }, sprites };
}
async function play() {
  if (S.mode !== 'edit') return stop();
  try {
    await saveAll();
    if (S.clearOnPlay) clearLogs();
    status('Compilation…');
    const sc = await waitEngine();
    await settleEngine(sc);
    await runScene(sc, S.scene, null, stem(S.scenePath));
    document.body.classList.add('engine-used');
    setMode('play');
    activateTab('game');
    if (plugins) plugins.emit('play');
  } catch (e) {
    log('error', 'Lancement impossible : ' + cleanErr(e));
    toast(cleanErr(e), true);
    setMode('edit');
  }
}
function stop() {
  const sc = engine();
  if (sc) {
    if (S.paused) sc.vm.runtime.start();
    sc.vm.stopAll();
    if (frame.contentWindow) frame.contentWindow.__scPaused = false;
  }
  setMode('edit');
  activateTab('scene');
  log('log', 'Jeu arrêté.');
  if (plugins) plugins.emit('stop');
}
function pause() {
  if (S.mode === 'edit') return;
  const sc = engine(); if (!sc) return;
  S.paused = !S.paused;
  if (S.paused) sc.vm.runtime.quit(); else sc.vm.runtime.start();
  frame.contentWindow.__scPaused = S.paused;
  setMode('play');
}
function stepFrame() {
  const sc = engine();
  if (!sc || S.mode === 'edit') return;
  if (!S.paused) pause();
  sc.vm.runtime._step();
  const w = frame.contentWindow.__sc3d; if (w && w.stepOnce) w.stepOnce();
}
function setMode(m) {
  S.mode = m;
  if (m === 'edit') S.paused = false;
  document.body.classList.toggle('playing', m === 'play' && !S.paused);
  document.body.classList.toggle('paused', S.paused);
  document.body.classList.toggle('maxgame', m === 'play' && $('#maxBtn').classList.contains('on'));
  $('#playBtn').classList.toggle('on', m === 'play');
  $('#playBtn').innerHTML = icon(m === 'play' ? 'stop' : 'play', 15);
  $('#playBtn').title = m === 'play' ? 'Arrêter (Ctrl+P)' : 'Lancer (Ctrl+P)';
  $('#pauseBtn').classList.toggle('on', S.paused);
  status(m === 'play' ? (S.paused ? 'En pause' : 'En cours d\'exécution') : 'Prêt');
}
$('#playBtn').onclick = play;
$('#idlePlay').onclick = play;
$('#pauseBtn').onclick = pause;
$('#stepBtn').onclick = stepFrame;
$('#maxBtn').onclick = e => { e.currentTarget.classList.toggle('on'); setMode(S.mode); };
$('#muteBtn').onclick = e => {
  const sc = engine(); const on = e.currentTarget.classList.toggle('on');
  try { sc.vm.runtime.audioEngine.inputNode.gain.value = on ? 0 : 1; } catch { /* moteur audio absent */ }
  e.currentTarget.textContent = on ? 'Muet' : 'Son';
};
function applyMarkers(rel) {
  const m = S.models.get(rel); if (!m || !monaco) return;
  monaco.editor.setModelMarkers(m, 'scratchcode', (S.problems[rel] || []).map(e => ({
    severity: monaco.MarkerSeverity.Error, message: e.message,
    startLineNumber: e.line, endLineNumber: e.line, startColumn: 1, endColumn: m.getLineMaxColumn(Math.min(e.line, m.getLineCount()))
  })));
}
function updateInspection() {
  const el = $('#inspection');
  if (!S.active || !S.active.endsWith('.sc')) { el.innerHTML = ''; el.className = 'un-insp-badge'; return; }
  const n = (S.problems[S.active] || []).length;
  el.className = 'un-insp-badge ' + (n ? 'err' : 'ok');
  el.innerHTML = n ? `${icon('alert', 12)}<span>${n}</span>` : icon('check', 13);
  el.title = n ? `${n} erreur${n > 1 ? 's' : ''} au dernier lancement` : 'Aucune erreur au dernier lancement';
}
$('#inspection').onclick = () => showBottom('console');

// ---------------- Barre d'outils de la vue Scène ----------------
function setTool(t) {
  document.querySelectorAll('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  view.setTool(t);
}
document.querySelectorAll('#tools [data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#spaceBtn').onclick = e => { const local = e.currentTarget.textContent === 'Global'; e.currentTarget.textContent = local ? 'Local' : 'Global'; view.setSpace(local ? 'local' : 'world'); };
$('#snapBtn').onclick = e => view.setSnapMode(e.currentTarget.classList.toggle('on'));
$('#gridBtn').onclick = e => view.setGrid(e.currentTarget.classList.toggle('on'));
$('#focusBtn').onclick = () => view.focus();

// ---------------- Menus principaux ----------------
const MENUS = {
  file: () => [
    { label: 'Nouveau projet…', ic: 'folderPlus', fn: () => studio.showHub() },
    { label: 'Ouvrir un projet…', ic: 'folderOpen', fn: () => studio.showHub() },
    '-',
    { label: 'Nouvelle scène…', ic: 'scene', fn: newScene },
    { label: 'Ouvrir une scène', ic: 'scene', fn: chooseScene },
    { label: 'Définir comme scène de départ', ic: 'flag', disabled: S.scenePath === (S.config.mainScene || 'scenes/Main.scene'), fn: setStartScene },
    '-',
    { label: 'Tout enregistrer', ic: 'save', key: 'Ctrl+S', fn: saveAll },
    { label: 'Exporter le projet (.maxycode)…', ic: 'share', fn: exportProject },
    '-',
    { label: 'Ouvrir le dossier du projet', ic: 'external', fn: () => studio.reveal(DIR) },
    { label: 'Écran d\'accueil', ic: 'home', fn: () => studio.showHub() }
  ],
  edit: () => [
    { label: 'Annuler', ic: 'undo', key: 'Ctrl+Z', disabled: !S.undo.length, fn: undo },
    { label: 'Rétablir', ic: 'redo', key: 'Ctrl+Y', disabled: !S.redo.length, fn: redo },
    '-',
    { label: 'Dupliquer', ic: 'copy', key: 'Ctrl+D', disabled: !findObj(S.sel), fn: duplicateSel },
    { label: 'Renommer', ic: 'edit', key: 'F2', disabled: !findObj(S.sel), fn: renameSel },
    { label: 'Supprimer', ic: 'trash', key: 'Suppr', disabled: !findObj(S.sel), fn: deleteSel },
    S.type === '3d' && { label: 'Cadrer la sélection', ic: 'maximize', key: 'F', disabled: !findObj(S.sel), fn: () => view.focus() },
    '-',
    { label: S.mode === 'edit' ? 'Lancer' : 'Arrêter', ic: S.mode === 'edit' ? 'play' : 'stop', key: 'Ctrl+P', fn: play },
    { label: 'Pause', ic: 'pause', key: 'Ctrl+Maj+P', disabled: S.mode === 'edit', fn: pause },
    { label: 'Image suivante', ic: 'stepFwd', key: 'Ctrl+Alt+P', disabled: S.mode === 'edit', fn: stepFrame }
  ],
  assets: () => [
    { label: 'Importer des assets…', ic: 'download', fn: importAssets },
    { label: 'Créer un script', ic: 'fileCode', fn: () => newScript('Script', 'when app run\n') },
    '-',
    { label: 'Afficher le dossier assets', ic: 'external', fn: () => studio.reveal(DIR, 'assets') },
    { label: 'Actualiser', ic: 'refresh', fn: async () => { await refreshTree(); toast('Fichiers actualisés'); } }
  ],
  object: () => createItems(),
  component: () => {
    const o = findObj(S.sel);
    if (!o) return [{ label: 'Sélectionne d\'abord un objet', ic: 'info', disabled: true, fn: () => {} }];
    if (S.type !== '3d') return [{ label: o.script ? `Ouvrir ${base(o.script)}` : 'Nouveau script', ic: 'fileCode', fn: () => o.script ? openScript(o.script) : newScriptFor(o) }];
    return [
      { label: 'Physique', ic: 'physics', disabled: o.rigidbody && o.rigidbody.enabled, fn: () => { snapshot(); o.rigidbody = { enabled: true, gravity: 1, bounce: 0 }; o.collider = true; saveScene(); renderInsp(); } },
      { label: 'Collision', ic: 'shield', disabled: !!o.collider, fn: () => { snapshot(); o.collider = true; saveScene(); renderInsp(); } },
      { label: o.script ? `Ouvrir ${base(o.script)}` : 'Nouveau script', ic: 'fileCode', fn: () => o.script ? openScript(o.script) : newScriptFor(o) }
    ];
  },
  window: () => [
    { label: 'Scène', ic: S.type === '3d' ? 'box' : 'image', key: 'Ctrl+1', fn: () => activateTab('scene') },
    { label: 'Jeu', ic: 'gamepad', key: 'Ctrl+2', fn: () => activateTab('game') },
    { label: 'Projet', ic: 'folder', key: 'Ctrl+5', fn: () => showBottom('project') },
    { label: 'Console', ic: 'terminal', key: 'Ctrl+Maj+C', fn: () => showBottom('console') },
    '-',
    { label: 'Disposition par défaut', ic: 'grid', fn: () => { const m = $('#main'); m.style.removeProperty('--hier-w'); m.style.removeProperty('--insp-w'); m.style.removeProperty('--bottom-h'); localStorage.removeItem('studio.layout'); } }
  ],
  plugins: () => plugins ? plugins.menu() : [],
  help: () => [
    { label: 'Guide de syntaxe (MAXYCODE.md)', ic: 'book', fn: () => openScript(allFiles().includes('MAXYCODE.md') ? 'MAXYCODE.md' : 'SCRATCHCODE.md') },
    { label: 'Raccourcis clavier', ic: 'list', fn: shortcutsHelp },
    { label: 'Site MaxyGame', ic: 'external', fn: () => window.open('https://maxygame.web.app') },
    '-',
    { label: 'À propos de MaxyStudio', ic: 'info', fn: async () => modal('MaxyStudio', `<p class="in-note" style="font-size:13px">Version ${esc(await studio.version())}<br>Moteur 2D : Scratch 3. Moteur 3D : three.js.<br>Projets au format .maxycode.</p>`, { cancel: '' }) }
  ]
};
document.querySelectorAll('.un-menu').forEach(b => {
  b.onclick = () => { closeMenu(); b.classList.add('open'); menuAt(b, MENUS[b.dataset.menu]()); };
  b.onmouseenter = () => { if (document.querySelector('.un-menu.open') && !b.classList.contains('open')) b.click(); };
});
function shortcutsHelp() {
  const rows = [['Lancer / arrêter', 'Ctrl+P'], ['Pause', 'Ctrl+Maj+P'], ['Image suivante', 'Ctrl+Alt+P'], ['Tout enregistrer', 'Ctrl+S'], ['Annuler / rétablir', 'Ctrl+Z / Ctrl+Y'],
    ['Dupliquer', 'Ctrl+D'], ['Supprimer', 'Suppr'], ['Renommer', 'F2'], ['Cadrer la sélection', 'F'], ['Outils Main / Déplacer / Pivoter / Redimensionner', 'Q / W / E / R'],
    ['Tourner la caméra de la scène', 'Clic droit'], ['Se déplacer dans la scène', 'Clic droit + ZQSD/WASD'], ['Panoramique', 'Clic molette'], ['Aimantation pendant un déplacement', 'Ctrl'], ['Nouvel objet vide', 'Ctrl+Maj+N']];
  modal('Raccourcis clavier', `<div class="kb">${rows.map(([a, k]) => `<span>${esc(a)}</span><kbd>${esc(k)}</kbd>`).join('')}</div>`, { cancel: '' });
}
async function exportProject() {
  try {
    await saveAll();
    if (plugins && !(await plugins.beforeExport())) return;
    const p = await studio.exportProject(DIR, S.config.name);
    if (p) { toast('Projet exporté : ' + p); log('ok', 'Projet exporté : ' + p); }
  } catch (e) { toast(cleanErr(e), true); }
}
$('#exportBtn').onclick = exportProject;
$('#projBtn').onclick = async e => {
  const el = e.currentTarget;
  const recent = (await studio.recent()).filter(p => p.path !== DIR).slice(0, 8);
  menuAt(el, ['Projets récents', ...(recent.length ? recent.map(p => ({ label: p.name, ic: 'folder', fn: () => studio.openProject(p.path) })) : [{ label: 'Aucun autre projet', ic: 'folder', disabled: true, fn: () => {} }]),
    '-', { label: 'Nouveau projet…', ic: 'folderPlus', fn: () => studio.showHub() }, { label: 'Ouvrir le dossier', ic: 'external', fn: () => studio.reveal(DIR) }]);
};

// ---------------- Raccourcis clavier ----------------
const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.closest && t.closest('#monaco'))); };
window.addEventListener('keydown', e => {
  if ($('#modalBack').classList.contains('show')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 's') { e.preventDefault(); saveAll(); return; }
  if (ctrl && k === 'p') { e.preventDefault(); if (e.altKey) stepFrame(); else if (e.shiftKey) pause(); else play(); return; }
  if (ctrl && k === '1') { e.preventDefault(); activateTab('scene'); return; }
  if (ctrl && k === '2') { e.preventDefault(); activateTab('game'); return; }
  if (ctrl && e.shiftKey && k === 'c') { e.preventDefault(); showBottom('console'); return; }
  if (ctrl && e.shiftKey && k === 'n' && S.type === '3d') { e.preventDefault(); createObject('empty'); return; }
  if (ctrl && (k === 'w' || e.key === 'F4') && !['scene', 'game'].includes(S.active)) { e.preventDefault(); closeTab(S.active); return; }
  if (typing(e)) return;
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (e.key === 'Delete') { e.preventDefault(); deleteSel(); return; }
  if (e.key === 'F2') { e.preventDefault(); renameSel(); return; }
  if (e.key === 'Escape') { closeMenu(); return; }
  if (S.active === 'scene' && !ctrl && !e.altKey && !(view && view.rmb)) {
    if (k === 'f') { view.focus(); return; }
    const tool = { q: 'hand', w: 'translate', e: 'rotate', r: 'scale' }[k];
    if (tool && S.type === '3d') setTool(tool);
  }
}, true);
window.addEventListener('beforeunload', () => { for (const rel of S.tabs) if (S.models.has(rel) && isDirty(rel)) studio.writeFile(DIR, rel, S.models.get(rel).getValue()); });

// ---------------- Redimensionnement des panneaux ----------------
const layoutSaved = JSON.parse(localStorage.getItem('studio.layout') || '{}');
for (const [k, v] of Object.entries(layoutSaved)) $('#main').style.setProperty(k, v);
document.querySelectorAll('.un-sash').forEach(s => s.addEventListener('mousedown', e => {
  e.preventDefault();
  s.classList.add('drag'); frame.style.pointerEvents = 'none';
  const main = $('#main'), box = main.getBoundingClientRect(), kind = s.dataset.sash;
  const move = ev => {
    if (kind === 'hier') main.style.setProperty('--hier-w', Math.max(160, Math.min(480, ev.clientX - box.left)) + 'px');
    else if (kind === 'insp') main.style.setProperty('--insp-w', Math.max(260, Math.min(620, box.right - ev.clientX)) + 'px');
    else main.style.setProperty('--bottom-h', Math.max(110, Math.min(box.height - 200, box.bottom - ev.clientY)) + 'px');
  };
  const up = () => {
    s.classList.remove('drag'); frame.style.pointerEvents = '';
    removeEventListener('mousemove', move); removeEventListener('mouseup', up);
    const st = {}; for (const k of ['--hier-w', '--insp-w', '--bottom-h']) { const v = main.style.getPropertyValue(k); if (v) st[k] = v; }
    localStorage.setItem('studio.layout', JSON.stringify(st));
  };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}));

// ---------------- Changements faits par un autre outil ----------------
studio.onChanged(async files => {
  const external = files.filter(rel => { const t = ignoreDisk.get(rel); return !(t && Date.now() - t < 1200); });
  if (!external.length) return;
  await refreshTree();
  for (const rel of external) {
    const m = S.models.get(rel);
    if (m && !isDirty(rel)) {
      try {
        const text = await studio.readFile(DIR, rel);
        if (text !== m.getValue()) { m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null); S.saved.set(rel, text); log('log', `Rechargé depuis le disque : ${rel}`); }
      } catch { /* fichier supprimé */ }
    }
  }
  if (external.includes(S.scenePath) && S.mode === 'edit') {
    try { await loadScene(); log('log', 'Scène rechargée depuis le disque.'); } catch (e) { log('error', 'Scène illisible : ' + cleanErr(e)); }
  }
  if (external.some(r => r.startsWith('assets/')) && view.reloadImages) view.reloadImages();
});

// ---------------- Éditeur de code (Monaco) ----------------
const BLOCK_SNIPPETS = [
  'when app run', 'when this sprite clicked', 'when [space v] key pressed', 'when I receive [message v]', 'when I start as a clone', 'forever', 'repeat (10)', 'repeat until <>', 'if <> then', 'else', 'end',
  'wait (1) seconds', 'wait until <>', 'move (10) steps', 'turn right (15) degrees', 'go to x: (0) y: (0)', 'change x by (10)', 'change y by (10)', 'set x to (0)', 'set y to (0)', 'point in direction (90)',
  'say [Bonjour !] for (2) seconds', 'say [Bonjour !]', 'show', 'hide', 'next costume', 'set size to (100) %', 'set [variable v] to (0)', 'change [variable v] by (1)', 'broadcast [message v]',
  'create clone of (myself v)', 'delete this clone', 'stop [all v]', 'key (space v) pressed?', 'touching (edge v)?', 'mouse down?', 'define '
];
const BLOCKS_3D = [
  'set position to x: (0) y: (1) z: (0)', 'change position by x: (0) y: (0) z: (0)', 'move forward (0.1)', 'move sideways (0.1)', 'rotate by x: (0) y: (5) z: (0) degrees', 'set rotation to x: (0) y: (0) z: (0)',
  'look at object [Joueur]', 'look at x: (0) y: (0) z: (0)', 'set scale to x: (1) y: (1) z: (1)', '([x position v] of object [myself])', '(distance to object [Joueur])',
  'set color to [#ff6680]', 'set opacity to (50) %', 'set texture to [assets/texture.png]', 'show object [myself]', 'hide object [myself]', 'play animation [Walk]', 'play animation [Jump] once', 'stop animations', '(animations of this object)',
  'create [cube v] named [Caisse] at x: (0) y: (3) z: (0)', 'create model [assets/modele.glb] named [Modèle] at x: (0) y: (0) z: (0)', 'clone object [myself] as [Copie]', 'delete object [Copie]', '<object [Copie] exists?>', '(name of this object)',
  'turn physics [on v]', 'set velocity to x: (0) y: (0) z: (0)', 'change velocity by x: (0) y: (5) z: (0)', 'jump with force (6)', 'set world gravity to (9.81)', '<on ground?>', '<touching object [anything]?>', 'when this object touches [Joueur]', '([y v] velocity)',
  'camera follow [myself] distance (7) height (3)', 'first person camera on [myself] eye height (1.6)', 'set camera position to x: (0) y: (4) z: (9)', 'point camera at x: (0) y: (0) z: (0)', 'set camera field of view to (60)', 'stop camera follow',
  '(axis [horizontal v])', '(axis [vertical v])', '(mouse movement [x v])', 'lock mouse pointer', 'unlock mouse pointer', 'when this object clicked', '(object under mouse)',
  'set sky colors top [#5d9fe8] bottom [#dcecfb]', 'set fog from (20) to (90)', 'remove fog', 'set sun brightness to (1.6)', 'set ambient light to (0.5)', 'show message [Bienvenue !]', 'hide message',
  'play sound file [assets/son.mp3]', 'stop sound files', '(delta time)', 'print [Bonjour]'
];
const BLOCKS_UI = [
  'add title [titre] text [Mon application]', 'add label [info] text [Bonjour !]', 'add button [ok] text [OK]', 'add text field [nom] hint [Ton prénom]', 'add image [logo] from [assets/image.png]',
  'when button [ok] clicked', 'set text of [info] to [Merci !]', '(text of [nom])', 'set [color v] of [ok] to [#4c97ff]', 'remove element [info]', 'clear interface', 'arrange elements in [row v]',
  'set app background to [#f4f1ff]', 'show notification [Enregistré]'
];
function setupMonaco() {
  window.MonacoEnvironment = { getWorkerUrl: () => '/monaco/vs/base/worker/workerMain.js' };
  window.require.config({ paths: { vs: '/monaco/vs' } });
  window.require(['vs/editor/editor.main'], () => {
    monaco = window.monaco;
    monaco.languages.register({ id: 'scratchcode', extensions: ['.sc'] });
    monaco.languages.setMonarchTokensProvider('scratchcode', {
      tokenizer: { root: [
        [/\/\/.*$/, 'comment'],
        [/^\s*(when|define!?)\b.*$/, 'hat'],
        [/^\s*return\b/, 'hat'],
        [/^\s*import\b.*$/, 'hat'],
        [/\b(forever|repeat until|repeat|if|then|else|end|wait until|wait|stop|create clone of|delete this clone|broadcast and wait|broadcast)\b/, 'control'],
        [/\b(set position|change position|move forward|move sideways|rotate by|set rotation|look at|set scale|set color|set opacity|set texture|show object|hide object|play animation|stop animations|create|clone object|delete object|turn physics|set velocity|change velocity|jump with force|set world gravity|camera follow|first person camera|set camera|point camera|stop camera follow|lock mouse pointer|unlock mouse pointer|set sky colors|set fog|remove fog|set sun brightness|set ambient light|show message|hide message|play sound file|stop sound files|print|add title|add label|add button|add text field|add image|set text of|remove element|clear interface|arrange elements|set app background|show notification)\b/, 'engine'],
        [/\b(set|change|go to|glide|move|turn|point in direction|point towards|say|think|show|hide|switch costume to|next costume|play sound|start sound|add|delete|insert|replace)\b/, 'action'],
        [/\[[^\]]*\]/, 'string'],
        [/\(\s*-?\d+(\.\d+)?\s*\)/, 'number'],
        [/[<>]/, 'boolean'],
        [/[()]/, 'paren']
      ] }
    });
    monaco.languages.setLanguageConfiguration('scratchcode', { comments: { lineComment: '//' }, brackets: [['(', ')'], ['[', ']'], ['<', '>']], autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '<', close: '>' }] });
    monaco.languages.registerCompletionItemProvider('scratchcode', { provideCompletionItems: (model, pos) => {
      const w = model.getWordUntilPosition(pos);
      const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
      const extra = S.type === '3d' ? BLOCKS_3D.concat(BLOCKS_UI) : BLOCKS_UI;
      const names = (S.scene ? S.scene.objects.map(o => o.name) : []);
      return { suggestions: [
        ...BLOCK_SNIPPETS.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Keyword, insertText: k, range })),
        ...extra.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Function, insertText: k, range, detail: S.type === '3d' && BLOCKS_3D.includes(k) ? 'Bloc 3D' : 'Bloc Interface' })),
        ...names.map(n => ({ label: n, kind: monaco.languages.CompletionItemKind.Variable, insertText: n, range, detail: 'Objet de la scène' }))
      ] };
    } });
    monaco.editor.defineTheme('sc-dark', { base: 'vs-dark', inherit: true, rules: [
      { token: 'hat', foreground: 'e8b84a', fontStyle: 'bold' }, { token: 'control', foreground: 'e0a35c' }, { token: 'action', foreground: '6aa9ff' }, { token: 'engine', foreground: '5fd3b3' },
      { token: 'string', foreground: '8fc78a' }, { token: 'number', foreground: '62c6d6' }, { token: 'comment', foreground: '7a7e85', fontStyle: 'italic' },
      { token: 'boolean', foreground: 'c79bff' }, { token: 'paren', foreground: 'b1b3b8' }
    ], colors: {
      'editor.background': '#1f2023', 'editor.foreground': '#d6d7da', 'editorLineNumber.foreground': '#4f525a', 'editorLineNumber.activeForeground': '#a1a3ab',
      'editor.lineHighlightBackground': '#26282c', 'editor.selectionBackground': '#2c4f7c', 'editorIndentGuide.background': '#313338', 'editorWidget.background': '#2b2c30',
      'editorSuggestWidget.background': '#2b2c30', 'editorSuggestWidget.selectedBackground': '#2c4f7c', 'scrollbarSlider.background': '#4d4f5480'
    } });
    editor = monaco.editor.create($('#monaco'), {
      theme: 'sc-dark', automaticLayout: true, fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 14, lineHeight: 22, fontLigatures: true,
      tabSize: 4, insertSpaces: true, minimap: { enabled: false }, smoothScrolling: true, scrollBeyondLastLine: false, renderLineHighlight: 'all', model: null
    });
    document.fonts.load('14px "JetBrains Mono"').then(() => monaco.editor.remeasureFonts());
    editor.onDidChangeCursorPosition(e => { $('#statusCursor').textContent = `Ligne ${e.position.lineNumber}, colonne ${e.position.column}`; });
  });
}

// ---------------- Démarrage ----------------
(async function start() {
  try {
    const p = await studio.readProject(DIR);
    S.config = p.config; S.tree = p.tree; S.base = p.assetBase;
    S.type = p.config.type === '3d' ? '3d' : p.config.type === 'app' ? 'app' : '2d';
    S.scenePath = p.config.mainScene || 'scenes/Main.scene';
    document.title = `${S.config.name} - MaxyStudio`;
    $('#projName').textContent = S.config.name;
    $('#projType').textContent = S.type === '3d' ? '3D' : S.type === 'app' ? 'APP' : '2D';
    $('#projType').className = 'un-type' + (S.type === '3d' ? ' t3d' : S.type === 'app' ? ' tapp' : '');
    $('#appVer').textContent = await studio.version();
    if (p.config.migratedFrom) log('log', `Projet ${p.config.migratedFrom}.x converti au format 1.2 (une scène 2D a été créée).`);
    const opts = {
      resolveUrl,
      onSelect: id => select(id, { fromView: true }),
      onBeforeChange: () => snapshot(),
      onChange: () => { saveScene(); renderInsp(); },
      onLiveTransform: def => {
        const box = $('#insp');
        if (S.type === '3d') ['position', 'rotation', 'scale'].forEach(k => {
          const vals = k === 'position' ? view.selected.position.toArray() : k === 'scale' ? view.selected.scale.toArray() : [view.selected.rotation.x, view.selected.rotation.y, view.selected.rotation.z].map(r => r * 180 / Math.PI);
          vals.forEach((v, i) => { const inp = box.querySelector(`[data-k="${k}.${i}"]`); if (inp && document.activeElement !== inp) inp.value = fmt(v); });
        });
        else ['x', 'y'].forEach(k => { const inp = box.querySelector(`[data-k="${k}"]`); if (inp) inp.value = fmt(def[k]); });
      },
      onDropAsset: dropAsset,
      onError: m => log('error', m)
    };
    view = S.type === '3d' ? new SceneView3D($('#sceneCanvas'), opts) : new SceneView2D($('#sceneCanvas'), opts);
    $('#gridBtn').classList.add('on');
    if (S.type !== '3d') { $('#tools').style.display = 'none'; $('#spaceBtn').style.display = 'none'; $('#snapBtn').style.display = 'none'; $('#focusBtn').style.display = 'none'; }
    $('#sceneHint').textContent = S.type === '3d'
      ? 'Clic : sélectionner  ·  Clic droit : tourner  ·  Clic droit + ZQSD : se déplacer  ·  Molette : zoom  ·  W E R : outils'
      : 'Glisse un lutin pour le placer  ·  Flèches : déplacer d\'un pixel  ·  Ctrl : aimanter à 10';
    renderTabs(); activateTab('scene');
    renderFolders(); renderAssets(); showBottom('project');
    await loadScene();
    log('log', `Projet ouvert : ${DIR}`);
    setupMonaco();
    setMode('edit');
    plugins = initPlugins({
      $, esc, icon, S, DIR, log, toast, modal, ask, confirmBox, cleanErr,
      allFiles, writeText, refreshTree, openScript, findObj, descendants, select, createObject, snapshot,
      play, stop,
      async reloadScene() {
        normalizeScene();
        if (S.sel && S.sel[0] !== '_' && !findObj(S.sel)) S.sel = null;
        await view.load(S.scene);
        view.select(S.sel && S.sel[0] !== '_' ? S.sel : null);
        renderHier(); renderInsp(); saveScene();
      }
    });
    await plugins.loadAll();
  } catch (e) {
    console.error(e);
    toast(cleanErr(e), true);
    log('error', cleanErr(e));
  }
})();
