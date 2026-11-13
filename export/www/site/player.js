// Lecteur MaxyGame : fait tourner un jeu MaxyStudio (.maxycode, ou .scratchcode avant la 2.1) dans le navigateur.
// 1. lit l'archive (zip) ; 2. dépose ses fichiers dans le cache servi par /sw.js ;
// 3. construit le projet Scratch (lutins, costumes, sons) ; 4. charge les extensions interface et 3D ;
// 5. compile chaque script et lance le jeu.

const CACHE = 'maxygame-jeux';
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  bin: 'application/octet-stream', obj: 'text/plain', fbx: 'application/octet-stream', stl: 'application/octet-stream',
  ply: 'application/octet-stream', dae: 'model/vnd.collada+xml', json: 'application/json', sc: 'text/plain', mc: 'text/plain', md: 'text/plain', js: 'text/javascript', anim: 'application/json'
};
const ENGINE_CSS = `
  html,body{background:#0d0f14!important;overflow:hidden!important}
  .menubar,.editor-pane,.target-pane,.stage-header,.bottom-nav,.m-sheet,.sheet-back,.toast,.modal-back,.backpack{display:none!important}
  .gui{padding:0!important;margin:0!important;height:100vh!important;display:flex!important;align-items:center!important;justify-content:center!important}
  .stage-pane{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important;gap:0!important}
  .stage-wrap{width:min(100vw,calc(100vh * 4 / 3))!important;border:0!important;border-radius:0!important}`;

const extOf = p => String(p).split('.').pop().toLowerCase();
const stem = p => String(p).split('/').pop().replace(/\.[^.]+$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Lit une archive zip (méthodes « stocké » et « deflate ») : { chemin: Uint8Array }. */
export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un projet MaxyStudio (.maxycode).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const data = bytes.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    if (!name.endsWith('/') && !name.includes('..')) {
      out[name] = method === 8
        ? new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
        : data.slice();
    }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Vrai si l'archive est un projet MaxyStudio (format .maxycode ou ancien .scratchcode). */
export const isMaxyProject = files => !!(files['project.maxycode'] || files['project.scratchcode']);

/** Lit la configuration et la scène d'un projet MaxyStudio décompressé. */
export function readProject(files) {
  const dec = new TextDecoder();
  const cfg = files['project.maxycode'] || files['project.scratchcode'];
  if (!cfg) throw new Error('Il manque project.maxycode : exporte le projet depuis MaxyStudio (Fichier > Exporter).');
  const config = JSON.parse(dec.decode(cfg));
  const type = config.type === '3d' ? '3d' : config.type === 'app' ? 'app' : '2d';
  const scenePath = config.mainScene || 'scenes/Main.scene';
  if (!files[scenePath]) throw new Error(`Scène introuvable : ${scenePath}`);
  return { config, type, scene: readScene(files, scenePath, type), scenePath, name: config.name || 'Jeu' };
}

/** Lit et complète une scène du projet. */
export function readScene(files, rel, type) {
  const scene = JSON.parse(new TextDecoder().decode(files[rel]));
  scene.objects = scene.objects || [];
  if (type !== '3d') {
    scene.stage = scene.stage || { backdrops: [], script: '' };
    for (const o of scene.objects) { o.costumes = o.costumes || []; o.sounds = o.sounds || []; }
  }
  return scene;
}

/** Dépose les fichiers du jeu dans le cache servi par /sw.js. */
async function cacheFiles(id, files) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 1500); });
  const cache = await caches.open(CACHE);
  for (const key of await cache.keys()) if (!new URL(key.url).pathname.startsWith(`/jeux-cache/${id}/`)) await cache.delete(key);
  await Promise.all(Object.entries(files).map(([rel, data]) => cache.put(
    `/jeux-cache/${id}/${rel.split('/').map(encodeURIComponent).join('/')}`,
    new Response(data, { headers: { 'content-type': MIME[extOf(rel)] || 'application/octet-stream' } }))));
  return reg;
}

function imageSize(buf, ext) {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (ext === 'png') return [dv.getUint32(16), dv.getUint32(20)];
    if (ext === 'gif') return [dv.getUint16(6, true), dv.getUint16(8, true)];
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
        i += 2 + dv.getUint16(i + 2);
      }
    }
    if (ext === 'svg') {
      const s = new TextDecoder().decode(buf.subarray(0, 4000));
      const vb = s.match(/viewBox\s*=\s*"\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/);
      const w = s.match(/\swidth\s*=\s*"([\d.]+)/), h = s.match(/\sheight\s*=\s*"([\d.]+)/);
      if (w && h) return [+w[1], +h[1]];
      if (vb) return [+vb[1], +vb[2]];
    }
  } catch { /* taille inconnue */ }
  return [96, 96];
}

const EMPTY_SVG = new TextEncoder().encode('<svg version="1.1" width="2" height="2" viewBox="0 0 2 2" xmlns="http://www.w3.org/2000/svg"></svg>');

/** Même liste de lutins que l'onglet Jeu de MaxyStudio (playSpec). */
function playSpec(project, log) {
  const names = new Set(), sprites = [];
  for (const o of project.scene.objects) {
    if (project.type === '3d') {
      if (!o.script) continue;
      if (names.has(o.name)) { log('warn', `Deux objets s'appellent « ${o.name} » : seul le premier exécute son script.`); continue; }
      names.add(o.name);
      sprites.push({ name: o.name, visible: false, costumes: [] });
    } else {
      if (names.has(o.name)) continue;
      names.add(o.name);
      sprites.push({ name: o.name, x: o.x, y: o.y, size: o.size, direction: o.direction, visible: o.visible !== false, rotationStyle: o.rotationStyle, draggable: o.draggable,
        costumes: o.costumes.map(rel => ({ rel, name: stem(rel) })), sounds: o.sounds.map(rel => ({ rel, name: stem(rel) })) });
    }
  }
  const backdrops = project.type === '3d' ? [] : (project.scene.stage.backdrops || []).map(rel => ({ rel, name: stem(rel) }));
  return { stage: { costumes: backdrops }, sprites };
}

/** Projet Scratch (.sb3) construit dans le navigateur, comme buildPlayArchive dans MaxyStudio. */
async function buildSb3(JSZip, files, spec) {
  const zip = new JSZip();
  zip.file('project.json', '');
  let n = 0;
  const addAsset = (rel, kind) => {
    let data = rel ? files[rel] : null, ext = rel ? extOf(rel) : 'svg';
    if (!data) { data = kind === 'sound' ? new Uint8Array(0) : EMPTY_SVG; ext = 'svg'; }
    if (ext === 'jpeg') ext = 'jpg';
    const id = (++n).toString(16).padStart(32, '0');
    zip.file(`${id}.${ext}`, data);
    return { id, ext, data };
  };
  const costume = c => {
    const a = addAsset(c.rel, 'image');
    const [w, h] = imageSize(a.data, a.ext);
    return { name: c.name || 'costume', dataFormat: a.ext, assetId: a.id, md5ext: `${a.id}.${a.ext}`, bitmapResolution: 1, rotationCenterX: w / 2, rotationCenterY: h / 2 };
  };
  const sound = s => {
    const a = addAsset(s.rel, 'sound');
    return { name: s.name || 'son', dataFormat: a.ext === 'mp3' ? 'mp3' : 'wav', assetId: a.id, md5ext: `${a.id}.${a.ext}`, rate: 48000, sampleCount: 0 };
  };
  const targets = [{
    isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
    costumes: (spec.stage.costumes.length ? spec.stage.costumes : [{ name: 'fond' }]).map(costume),
    sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null
  }];
  let layer = 1;
  for (const sp of spec.sprites) {
    targets.push({
      isStage: false, name: sp.name, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
      costumes: (sp.costumes && sp.costumes.length ? sp.costumes : [{ name: 'vide' }]).map(costume),
      sounds: (sp.sounds || []).filter(s => files[s.rel]).map(sound),
      volume: 100, layerOrder: layer++, visible: sp.visible !== false, x: +sp.x || 0, y: +sp.y || 0, size: sp.size == null ? 100 : +sp.size,
      direction: sp.direction == null ? 90 : +sp.direction, draggable: !!sp.draggable, rotationStyle: sp.rotationStyle || 'all around'
    });
  }
  zip.file('project.json', JSON.stringify({ targets, monitors: [], extensions: [], meta: { semver: '3.0.0', vm: '0.2.0', agent: 'MaxyGame' } }));
  return zip.generateAsync({ type: 'uint8array' });
}

// MaxyCode : même traduction que dans MaxyStudio (fichier copié par maxygame/build.mjs).
import { compileMaxyCode, originalLine, originOf } from '/studio/maxycode.js';

/**
 * Lance un jeu dans l'iframe du moteur (/moteur.html).
 * @param {HTMLIFrameElement} frame
 * @param {string} id identifiant du jeu (dossier de cache)
 * @param {Uint8Array} archive contenu du fichier .maxycode
 * @param {(level: string, text: string) => void} log
 * @param {(text: string, fraction: number) => void} step progression du démarrage (0 à 1)
 */
export async function runGame(frame, id, archive, log = () => {}, step = () => {}) {
  step('Lecture du jeu…', 0.02);
  const files = await unzip(archive);
  const project = readProject(files);
  step('Préparation des images, des sons et des modèles…', 0.1);
  await cacheFiles(id, files);
  step('Démarrage du moteur de jeu…', 0.2);
  await new Promise(res => {
    frame.addEventListener('load', res, { once: true });
    frame.src = '/moteur.html?studio=1&jeu=' + encodeURIComponent(id);
  });
  const win = frame.contentWindow, doc = frame.contentDocument;
  const st = doc.createElement('style'); st.textContent = ENGINE_CSS; doc.head.appendChild(st);
  doc.addEventListener('keydown', e => {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.preventDefault();
  });
  const t0 = Date.now();
  let sc = null;
  while (!(sc = win.scratchcode) || !sc.vm || !sc.setCode || !sc.loadSb3) {
    if (Date.now() - t0 > 45000) throw new Error('Le moteur de jeu ne répond pas.');
    step(null, 0.2 + Math.min(0.25, (Date.now() - t0) / 40000));
    await sleep(120);
  }
  step('Moteur prêt.', 0.45);
  // Le moteur charge d'abord son projet de démarrage : on attend qu'il ait fini.
  while (!sc.vm.runtime.targets.length && Date.now() - t0 < 60000) await sleep(100);
  await sleep(1200);
  sc.vm.runtime.on('SC_PRINT', m => log(m.level === 'error' ? 'error' : 'log', m.text));
  const vm = sc.vm;
  const dec = new TextDecoder();
  const read = rel => (rel && files[rel] ? dec.decode(files[rel]) : '');
  const ext = f => new URL(`/studio/${f}`, location.href).href;
  const sceneFiles = Object.keys(files).filter(r => r.endsWith('.scene'));
  let current = project.scenePath;

  async function launch(scene, vars, name, first) {
    sc.vm.stopAll();
    if (first) step('Chargement des lutins et des costumes…', 0.55);
    const bytes = await buildSb3(sc.JSZip, files, playSpec({ ...project, scene }, log));
    await sc.loadSb3(new win.Uint8Array(bytes).buffer);
    if (first) step('Chargement des extensions…', 0.7);
    await sc.loadExtension(ext('scui-ext.js'));
    if (project.type === '3d') await sc.loadExtension(ext('sc3d-ext.js'));
    win.__scProject = { type: project.type, scene: JSON.parse(JSON.stringify(scene)), base: `/jeux-cache/${id}/` };
    win.__maxySceneName = name;
    win.__maxyGoToScene = goToScene;
    let errors = 0;
    if (first) step('Préparation des scripts…', 0.85);
    const compile = async (target, rel) => {
      if (rel && /\.js$/i.test(rel)) return; // Script JavaScript : lancé par maxyjs.js
      const mc = compileMaxyCode(read(rel), { resolve: n => (files[n] ? read(n) : null) });
      const list = [...mc.errors, ...((await sc.setCode(target, mc.code)) || []).map(e => {
        const from = originOf(mc, e.line || 1);
        return { ...e, line: originalLine(mc, e.line || 1), message: (from ? `[${from}] ` : '') + (e.message || e.msg || e) };
      })];
      for (const e of list) { errors++; log('error', `${rel}, ligne ${e.line || '?'} : ${e.message || e.msg || e}`); }
    };
    await compile(vm.runtime.getTargetForStage(), project.type === '3d' ? scene.worldScript : scene.stage.script);
    const byName = new Map(vm.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => [t.getName(), t]));
    for (const o of scene.objects) {
      const t = byName.get(o.name);
      if (t && o.script) await compile(t, o.script);
    }
    if (errors) log('warn', `${errors} erreur${errors > 1 ? 's' : ''} dans les scripts : le jeu peut ne pas marcher entièrement.`);
    if (vars) {
      // Les variables de la Scène (score, vies…) passent d'un niveau à l'autre
      const st = vm.runtime.getTargetForStage();
      for (const v of vars) {
        let t = Object.values(st.variables).find(x => x.name === v.name && x.type === v.type);
        if (!t) { st.createVariable(`maxy_${v.type}_${v.name}`, v.name, v.type); t = Object.values(st.variables).find(x => x.name === v.name && x.type === v.type); }
        if (t) t.value = Array.isArray(v.value) ? v.value.slice() : v.value;
      }
    }
    if (first) step("C'est parti !", 1);
    vm.greenFlag();
    frame.focus();
  }

  async function goToScene(name) {
    const n = String(name).trim().replace(/\.scene$/i, '');
    const rel = sceneFiles.find(r => stem(r) === n) || sceneFiles.find(r => stem(r).toLowerCase() === n.toLowerCase());
    if (!rel) { log('error', `Scène introuvable : « ${name} ».`); return; }
    const st = vm.runtime.getTargetForStage();
    const vars = Object.values(st.variables).filter(v => (v.type === '' || v.type === 'list') && !v.name.startsWith('_'))
      .map(v => ({ name: v.name, type: v.type, value: Array.isArray(v.value) ? v.value.slice() : v.value }));
    try { current = rel; await launch(readScene(files, rel, project.type), vars, stem(rel), false); }
    catch (e) { log('error', 'Changement de scène impossible : ' + (e.message || e)); }
  }

  await launch(project.scene, null, stem(project.scenePath), true);
  // Recommencer : reprend depuis la scène de départ
  return { project, stop: () => vm.stopAll(), restart: () => launch(project.scene, null, stem(project.scenePath), false), get scene() { return current; } };
}
