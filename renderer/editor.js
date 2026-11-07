/* MaxyStudio - espace de travail (disposition inspirée des IDE JetBrains) */
hydrateIcons();
const $ = s => document.querySelector(s);
const DIR = new URLSearchParams(location.search).get('dir');
const state = {
  config: null, tree: [], open: [], active: null, models: new Map(), saved: new Map(), expanded: new Set(['sprites']),
  running: false, problems: {}, recentFiles: [], leftTool: 'project', bottomTab: 'run'
};
let monacoApi = null, editor = null, ignoreDisk = new Map(), gutterDecos = [];
const prefs = JSON.parse(localStorage.getItem('studio.prefs') || '{"fontSize":14,"minimap":false,"turbo":false}');
const savePrefs = () => localStorage.setItem('studio.prefs', JSON.stringify(prefs));

const cleanErr = e => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function toast(msg, err) {
  const t = $('#toast');
  t.className = 'toast show' + (err ? ' err' : '');
  t.innerHTML = icon(err ? 'alert' : 'check') + '<span></span>';
  t.querySelector('span').textContent = msg;
  clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', 4000);
}
function setState(text, ic = 'check') { $('#sState').innerHTML = icon(ic, 13) + `<span>${esc(text)}</span>`; }
const isDirty = rel => state.models.has(rel) && state.models.get(rel).getValue() !== state.saved.get(rel);
const spriteName = rel => rel.replace(/^sprites\//, '').replace(/\.sc$/, '');
const time = () => new Date().toLocaleTimeString('fr-FR');

// ---------------- Journal et console d'exécution ----------------
function logTo(panel, text, cls = '') {
  const box = $(panel);
  const line = document.createElement('div');
  line.className = 'ln ' + cls;
  line.innerHTML = text;
  box.appendChild(line);
  while (box.children.length > 500) box.firstChild.remove();
  box.parentElement.scrollTop = box.parentElement.scrollHeight;
}
const runLog = (t, c) => logTo('#runPanel', t, c);
const journal = (t, c) => logTo('#consolePanel', `<span class="dim">${time()}</span>  ${t}`, c);

// ---------------- Fenêtres d'outils ----------------
function showLeft(tool) {
  const panel = $('#toolLeft');
  if (state.leftTool === tool && !panel.hidden) { panel.hidden = true; markStripes(); return; }
  state.leftTool = tool;
  panel.hidden = false;
  $('#leftTitle').textContent = tool === 'project' ? 'Projet' : 'Structure';
  $('#tree').hidden = tool !== 'project';
  $('#structure').hidden = tool !== 'structure';
  $('#newSprite').hidden = tool !== 'project';
  $('#refreshTree').hidden = tool !== 'project';
  if (tool === 'structure') renderStructure();
  markStripes();
}
function showBottom(tab, toggle = true) {
  const panel = $('#toolBottom');
  if (toggle && state.bottomTab === tab && !panel.hidden) { panel.hidden = true; markStripes(); return; }
  state.bottomTab = tab;
  panel.hidden = false;
  $('#runPanel').hidden = tab !== 'run';
  $('#problemsPanel').hidden = tab !== 'problems';
  $('#consolePanel').hidden = tab !== 'console';
  document.querySelectorAll('[data-btab]').forEach(b => b.classList.toggle('active', b.dataset.btab === tab));
  if (tab === 'problems') renderProblems();
  markStripes();
}
function toggleRight() { $('#toolRight').hidden = !$('#toolRight').hidden; markStripes(); }
function markStripes() {
  document.querySelectorAll('[data-tool="project"],[data-tool="structure"]').forEach(b =>
    b.classList.toggle('active', !$('#toolLeft').hidden && state.leftTool === b.dataset.tool));
  document.querySelectorAll('[data-bottom]').forEach(b =>
    b.classList.toggle('active', !$('#toolBottom').hidden && state.bottomTab === b.dataset.bottom));
  document.querySelector('[data-tool="game"]').classList.toggle('active', !$('#toolRight').hidden);
  editor && editor.layout();
}
document.querySelectorAll('[data-tool="project"],[data-tool="structure"]').forEach(b => b.onclick = () => showLeft(b.dataset.tool));
document.querySelectorAll('[data-bottom]').forEach(b => b.onclick = () => showBottom(b.dataset.bottom));
document.querySelectorAll('[data-btab]').forEach(b => b.onclick = () => showBottom(b.dataset.btab, false));
document.querySelector('[data-tool="game"]').onclick = toggleRight;
document.querySelectorAll('[data-hide]').forEach(b => b.onclick = () => {
  ({ left: $('#toolLeft'), right: $('#toolRight'), bottom: $('#toolBottom') })[b.dataset.hide].hidden = true;
  markStripes();
});
$('#clearConsole').onclick = () => { $(state.bottomTab === 'console' ? '#consolePanel' : '#runPanel').innerHTML = ''; };

// ---------------- Projet (arborescence) ----------------
function fileIcon(name) {
  if (name.endsWith('.sc')) return ['fileCode', 'sc'];
  if (name.endsWith('.sb3')) return ['box', 'sc'];
  if (name.endsWith('.scratchcode') || name.endsWith('.json')) return ['braces', 'json'];
  if (name.endsWith('.md')) return ['book', 'md'];
  return ['file', ''];
}
function renderTree() {
  const box = $('#tree'); box.innerHTML = '';
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const el = document.createElement('div');
      el.className = 'node' + (n.path === state.active ? ' active' : '');
      el.style.paddingLeft = (8 + depth * 16) + 'px';
      if (n.type === 'dir') {
        const open = state.expanded.has(n.path);
        el.innerHTML = `<span class="tw">${icon(open ? 'chevronDown' : 'chevronRight', 14)}</span><span class="fi dir">${icon(open ? 'folderOpen' : 'folder', 16)}</span><span class="nm"></span>`;
        el.onclick = () => { open ? state.expanded.delete(n.path) : state.expanded.add(n.path); renderTree(); };
      } else {
        const [ic, cls] = fileIcon(n.name);
        const errs = (state.problems[n.path] || []).length;
        el.innerHTML = `<span class="tw"></span><span class="fi ${cls}">${icon(ic, 16)}</span><span class="nm"></span>${errs ? `<span class="badge">${errs}</span>` : ''}`;
        el.onclick = () => openFile(n.path);
      }
      el.querySelector('.nm').textContent = n.name;
      el.oncontextmenu = e => { e.preventDefault(); treeMenu(e, n); };
      box.appendChild(el);
      if (n.type === 'dir' && state.expanded.has(n.path)) walk(n.children, depth + 1);
    }
  };
  const root = document.createElement('div');
  root.className = 'node';
  root.style.paddingLeft = '8px';
  root.innerHTML = `<span class="tw">${icon('chevronDown', 14)}</span><span class="fi dir">${icon('folderOpen', 16)}</span><span class="nm"></span>`;
  root.querySelector('.nm').innerHTML = `<b>${esc(state.config ? state.config.name : 'Projet')}</b> <span style="color:var(--muted)">${esc(DIR)}</span>`;
  box.appendChild(root);
  walk(state.tree, 1);
}
async function refreshTree() {
  const p = await studio.readProject(DIR);
  state.config = p.config; state.tree = p.tree;
  renderTree();
}
const allFiles = (nodes = state.tree, out = []) => { for (const n of nodes) n.type === 'dir' ? allFiles(n.children, out) : out.push(n.path); return out; };

// ---------------- Structure : scripts du fichier ouvert ----------------
function scriptsOf(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (/^when\b/.test(line)) out.push({ kind: /^when I receive/.test(line) ? 'msg' : 'hat', label: line, line: i + 1 });
    else if (/^define!?\s/.test(line)) out.push({ kind: 'def', label: line, line: i + 1 });
  });
  return out;
}
function renderStructure() {
  const box = $('#structure');
  if (!state.active || !state.active.endsWith('.sc')) { box.innerHTML = '<div class="st-empty">Ouvre un fichier .sc pour voir ses scripts.</div>'; return; }
  const items = scriptsOf(state.models.get(state.active).getValue());
  box.innerHTML = items.length ? items.map(s => `<div class="st-item" data-line="${s.line}"><span class="st-kind ${s.kind}">${s.kind === 'def' ? 'f' : s.kind === 'msg' ? 'm' : '▸'}</span><span>${esc(s.label)}</span><span class="st-line">${s.line}</span></div>`).join('')
    : '<div class="st-empty">Aucun script dans ce fichier.</div>';
  box.querySelectorAll('.st-item').forEach(el => el.onclick = () => goToLine(+el.dataset.line));
}
function goToLine(line) {
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.focus();
}

// ---------------- Onglets et éditeur ----------------
async function openFile(rel, line) {
  if (rel.endsWith('.sb3') || (rel.endsWith('.scratchcode') && rel !== 'project.scratchcode')) {
    toast(`« ${rel} » est le projet compilé : ouvre-le dans ScratchCode, Scratch ou TurboWarp.`);
    return;
  }
  if (!state.models.has(rel)) {
    const text = await studio.readFile(DIR, rel);
    const lang = rel.endsWith('.sc') ? 'scratchcode' : rel.endsWith('.md') ? 'markdown' : (rel.endsWith('.json') || rel.endsWith('.scratchcode')) ? 'json' : 'plaintext';
    const model = monacoApi.editor.createModel(text, lang, monacoApi.Uri.parse('file:///' + rel));
    model.onDidChangeContent(() => { renderTabs(); if (rel === state.active) { updateGutter(); if (state.leftTool === 'structure') renderStructure(); } });
    state.models.set(rel, model); state.saved.set(rel, text);
  }
  if (!state.open.includes(rel)) state.open.push(rel);
  state.recentFiles = [rel, ...state.recentFiles.filter(r => r !== rel)].slice(0, 20);
  state.active = rel;
  editor.setModel(state.models.get(rel));
  $('#welcome').style.display = 'none'; $('#monaco').style.display = 'block';
  editor.focus();
  if (line) goToLine(line);
  $('#sLang').textContent = rel.endsWith('.sc') ? 'ScratchCode' : rel.endsWith('.md') ? 'Markdown' : 'JSON';
  applyMarkers(rel); updateGutter(); updateInspection();
  renderTabs(); renderTree(); renderInspector();
  if (state.leftTool === 'structure') renderStructure();
}
function closeTab(rel) {
  if (isDirty(rel)) saveFile(rel);
  state.open = state.open.filter(r => r !== rel);
  if (state.active === rel) {
    state.active = state.open[state.open.length - 1] || null;
    if (state.active) return openFile(state.active);
    editor.setModel(null); $('#monaco').style.display = 'none'; $('#welcome').style.display = 'grid';
  }
  renderTabs(); renderTree(); renderInspector(); updateInspection();
}
function renderTabs() {
  const tabs = $('#tabs'); tabs.innerHTML = '';
  for (const rel of state.open) {
    const [ic, cls] = fileIcon(rel);
    const t = document.createElement('div');
    t.className = 'tab' + (rel === state.active ? ' active' : '');
    t.title = rel;
    t.innerHTML = `<span class="fi ${cls}" style="color:${cls === 'sc' ? '#c77dff' : cls === 'json' ? '#e0b44c' : '#6aa7e6'}">${icon(ic, 14)}</span><span class="nm"></span>` +
      (isDirty(rel) ? '<span class="dot" title="Non enregistré"></span>' : `<button class="x" title="Fermer (Ctrl+F4)">${icon('x', 13)}</button>`);
    t.querySelector('.nm').textContent = rel.split('/').pop();
    t.onclick = e => { if (e.target.closest('.x')) closeTab(rel); else openFile(rel); };
    t.onauxclick = e => { if (e.button === 1) closeTab(rel); };
    tabs.appendChild(t);
  }
  const parts = state.active ? [state.config.name, ...state.active.split('/')] : [state.config ? state.config.name : ''];
  $('#crumb').innerHTML = parts.map(p => `<span>${esc(p)}</span>`).join(icon('chevronRight', 11));
}

async function saveFile(rel) {
  const m = state.models.get(rel); if (!m) return;
  const text = m.getValue();
  ignoreDisk.set(rel, Date.now());
  await studio.writeFile(DIR, rel, text);
  state.saved.set(rel, text);
  renderTabs();
  journal(`Enregistré : ${esc(rel)}`);
}
async function saveAll() {
  const dirty = state.open.filter(isDirty);
  for (const rel of dirty) await saveFile(rel);
  if (dirty.length) setState(dirty.length === 1 ? `${dirty[0]} enregistré` : `${dirty.length} fichiers enregistrés`, 'save');
  if (state.running && dirty.some(r => r.endsWith('.sc'))) syncEngine(false);
}

// ---------------- Changements externes (autre éditeur, assistant…) ----------------
studio.onChanged(async files => {
  let treeChanged = false, codeChanged = false;
  for (const rel of files) {
    const recent = ignoreDisk.get(rel);
    if (recent && Date.now() - recent < 800) continue;
    treeChanged = true;
    if (rel.endsWith('.sc')) codeChanged = true;
    const m = state.models.get(rel);
    if (m && !isDirty(rel)) {
      try {
        const text = await studio.readFile(DIR, rel);
        if (text !== m.getValue()) {
          const pos = rel === state.active ? editor.getPosition() : null;
          m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null);
          state.saved.set(rel, text);
          if (pos) editor.setPosition(pos);
          journal(`Rechargé depuis le disque : ${esc(rel)}`);
        }
      } catch { /* fichier supprimé */ }
    }
  }
  if (treeChanged) {
    await refreshTree();
    const exist = new Set(allFiles());
    for (const rel of [...state.open]) if (!exist.has(rel) && !isDirty(rel)) { state.models.get(rel)?.dispose(); state.models.delete(rel); state.open = state.open.filter(r => r !== rel); if (state.active === rel) state.active = null; }
    if (!state.active && state.open.length) openFile(state.open[0]); else renderTabs();
    $('#sWatch').innerHTML = icon('refresh', 12) + '<span>Modifié sur le disque, rechargé</span>';
    setTimeout(() => $('#sWatch').innerHTML = icon('refresh', 12) + '<span>Synchronisé avec le disque</span>', 2500);
  }
  if (codeChanged && state.running) syncEngine(false);
});

// ---------------- Moteur Scratch (fenêtre Jeu) ----------------
const frame = $('#engine');
const ENGINE_CSS = `
  html,body{background:#111!important;overflow:hidden!important}
  .menubar,.editor-pane,.target-pane,.stage-header,.bottom-nav,.m-sheet,.sheet-back,.toast,.modal-back,.backpack{display:none!important}
  .gui{padding:0!important;margin:0!important;height:100vh!important;display:flex!important;align-items:center!important;justify-content:center!important}
  .stage-pane{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important;gap:0!important}
  .stage-wrap{width:min(100vw,calc(100vh * 4 / 3))!important;border:0!important;border-radius:0!important}`;
function engine() { return frame.contentWindow && frame.contentWindow.scratchcode; }
function waitEngine(timeout = 20000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      const sc = engine();
      if (sc && sc.vm && sc.setCode) return res(sc);
      if (Date.now() - t0 > timeout) return rej(new Error('Le moteur Scratch ne répond pas.'));
      setTimeout(poll, 120);
    })();
  });
}
frame.addEventListener('load', async () => {
  const doc = frame.contentDocument;
  const st = doc.createElement('style'); st.textContent = ENGINE_CSS; doc.head.appendChild(st);
  try {
    const sc = await waitEngine();
    $('#engineLoading').style.display = 'none';
    sc.vm.on('PROJECT_RUN_START', () => setRunning(true));
    sc.vm.on('PROJECT_RUN_STOP', () => setRunning(false));
    sc.vm.runtime.on('SAY', (target, type, text) => {
      if (state.running && text !== '' && text != null) runLog(`<span class="who">${esc(target.getName())}</span> ${type === 'think' ? 'pense' : 'dit'} : ${esc(text)}`);
    });
    sc.vm.setTurboMode(!!prefs.turbo);
    journal('Moteur Scratch prêt.');
    await syncEngine(false).catch(() => {});
  } catch (e) { $('#engineLoading').textContent = cleanErr(e); journal(esc(cleanErr(e)), 'err'); }
});
function setRunning(on) {
  if (state.running === on) return;
  state.running = on;
  $('#runBtn').classList.toggle('on', on);
  $('#stopBtn').disabled = !on;
  $('#status').classList.toggle('running', on);
  setState(on ? 'En cours d\'exécution' : 'Prêt', on ? 'play' : 'check');
  if (!on) runLog('Exécution terminée.', 'dim');
}

async function readProjectCode() {
  const files = allFiles();
  const sprites = {};
  for (const rel of files.filter(f => /^sprites\/[^/]+\.sc$/.test(f))) sprites[spriteName(rel)] = { rel, code: state.models.has(rel) ? state.models.get(rel).getValue() : await studio.readFile(DIR, rel) };
  const stage = files.includes('stage.sc') ? (state.models.has('stage.sc') ? state.models.get('stage.sc').getValue() : await studio.readFile(DIR, 'stage.sc')) : '';
  return { stage, sprites };
}

async function syncEngine(run) {
  const sc = await waitEngine();
  const vm = sc.vm;
  const { stage, sprites } = await readProjectCode();
  const names = Object.keys(sprites);
  const originals = () => vm.runtime.targets.filter(t => t.isOriginal && !t.isStage);
  const byName = new Map(originals().map(t => [t.getName(), t]));
  const spare = originals().filter(t => !names.includes(t.getName()));
  for (const name of names) {
    if (byName.has(name)) continue;
    let t = spare.shift();
    if (!t) {
      const base = originals()[0];
      if (!base) continue;
      const before = new Set(vm.runtime.targets.map(x => x.id));
      await vm.duplicateSprite(base.id);
      t = vm.runtime.targets.find(x => !before.has(x.id) && x.isOriginal);
      if (!t) continue;
    }
    vm.renameSprite(t.id, name);
    byName.set(name, t);
  }
  if (names.length) for (const t of spare) vm.deleteSprite(t.id);

  state.problems = {};
  const stageTarget = vm.runtime.getTargetForStage();
  state.problems['stage.sc'] = normErrors(await sc.setCode(stageTarget, stage));
  for (const name of names) {
    const t = byName.get(name); if (!t) continue;
    state.problems[sprites[name].rel] = normErrors(await sc.setCode(t, sprites[name].code));
  }
  const total = Object.values(state.problems).reduce((a, b) => a + b.length, 0);
  $('#probCount').textContent = total || '';
  if (state.active) applyMarkers(state.active);
  updateInspection();
  if (!$('#problemsPanel').hidden) renderProblems();
  await syncArchivesOnDisk(sc, stage, sprites).catch(e => journal('Écriture du .sb3 impossible : ' + esc(cleanErr(e)), 'err'));
  await refreshTree();
  renderInspector();
  if (run) {
    if (total) {
      runLog(`${total} erreur${total > 1 ? 's' : ''} : les scripts concernés ne sont pas chargés.`, 'err');
      for (const [rel, list] of Object.entries(state.problems)) for (const e of list) runLog(`  ${esc(rel)}:${e.line}  ${esc(e.message)}`, 'err');
    } else runLog('Compilation réussie : ' + (names.length + 1) + ' fichier(s), aucune erreur.', 'ok');
    vm.greenFlag();
  }
  return total;
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
async function syncArchivesOnDisk(sc, stage, sprites) {
  if (!state.config || !sc || !sc.saveSb3) return;
  const projName = state.config.name || 'MonProjet';
  const sources = { Stage: stage };
  for (const [k, v] of Object.entries(sprites)) sources[k] = v.code;
  const updatedCfg = { ...state.config, title: projName, sources, exportFormat: 'sb3', updated: new Date().toISOString() };
  ignoreDisk.set('project.scratchcode', Date.now());
  await studio.writeFile(DIR, 'project.scratchcode', JSON.stringify(updatedCfg, null, 2));
  const blob = await sc.saveSb3(projName);
  const sb3Name = `${projName}.sb3`;
  ignoreDisk.set(sb3Name, Date.now());
  await studio.writeBinary(DIR, sb3Name, await blobToBase64(blob));
}
function normErrors(list) {
  return (list || []).map(e => ({
    line: Number(e.line ?? e.lineNumber ?? e.row ?? (e.from && e.from.line) ?? 1) || 1,
    message: String(e.message ?? e.msg ?? e.error ?? e.text ?? e)
  }));
}
function applyMarkers(rel) {
  const m = state.models.get(rel); if (!m || !monacoApi) return;
  const errs = state.problems[rel] || [];
  monacoApi.editor.setModelMarkers(m, 'scratchcode', errs.map(e => ({
    severity: monacoApi.MarkerSeverity.Error, message: e.message,
    startLineNumber: e.line, endLineNumber: e.line, startColumn: 1, endColumn: m.getLineMaxColumn(Math.min(e.line, m.getLineCount()))
  })));
}
function updateInspection() {
  const el = $('#inspection');
  if (!state.active || !state.active.endsWith('.sc')) { el.innerHTML = ''; return; }
  const n = (state.problems[state.active] || []).length;
  el.className = 'jb-inspection ' + (n ? 'err' : 'ok');
  el.innerHTML = n ? `${icon('alert', 13)}<span>${n}</span>` : icon('check', 14);
  el.title = n ? `${n} erreur${n > 1 ? 's' : ''} dans ce fichier` : 'Aucun problème dans ce fichier';
}
$('#inspection').onclick = () => showBottom('problems', false);
function renderProblems() {
  const entries = Object.entries(state.problems).flatMap(([r, list]) => list.map(e => ({ r, ...e })));
  $('#problemsPanel').innerHTML = entries.length
    ? entries.map(e => `<div class="pr" data-rel="${esc(e.r)}" data-line="${e.line}">${icon('alert', 14)}<span>${esc(e.message)}</span><span class="loc">${esc(e.r)}:${e.line}</span></div>`).join('')
    : `<div class="pr-ok">${icon('check', 14)} Aucun problème. Lance le jeu pour vérifier tout le projet.</div>`;
  $('#problemsPanel').querySelectorAll('.pr').forEach(p => p.onclick = () => openFile(p.dataset.rel, +p.dataset.line));
}

// Icônes « Lancer » dans la gouttière, devant chaque bloc chapeau
function updateGutter() {
  if (!editor || !state.active || !state.active.endsWith('.sc')) { gutterDecos = editor ? editor.deltaDecorations(gutterDecos, []) : []; return; }
  const items = scriptsOf(state.models.get(state.active).getValue()).filter(s => s.kind !== 'def');
  gutterDecos = editor.deltaDecorations(gutterDecos, items.map(s => ({
    range: new monacoApi.Range(s.line, 1, s.line, 1),
    options: { glyphMarginClassName: 'jb-gutter-run', glyphMarginHoverMessage: { value: 'Lancer le jeu' } }
  })));
}

async function run() {
  if ($('#toolRight').hidden) toggleRight();
  showBottom('run', false);
  $('#runPanel').innerHTML = '';
  runLog(`${time()}  Lancement de « Jeu » (${esc(state.config ? state.config.name : 'projet')})…`, 'dim');
  try {
    await saveAll(); setState('Compilation…', 'refresh');
    const errors = await syncEngine(true);
    setState(errors ? `${errors} erreur${errors > 1 ? 's' : ''}` : 'En cours d\'exécution', errors ? 'alert' : 'play');
    frame.focus();
  }
  catch (e) { runLog(esc(cleanErr(e)), 'err'); toast(cleanErr(e), true); setState('Erreur', 'alert'); }
}
function stop() { const sc = engine(); if (sc) sc.vm.stopAll(); setRunning(false); }

// ---------------- Inspecteur ----------------
function renderInspector() {
  const box = $('#inspector');
  const rel = state.active;
  const sc = engine();
  if (rel && /^sprites\/.+\.sc$/.test(rel)) {
    const t = sc && sc.vm.runtime.targets.find(x => x.isOriginal && !x.isStage && x.getName() === spriteName(rel));
    box.innerHTML = `<div class="comp"><div class="comp-head">${icon('box', 14)}<span>${esc(spriteName(rel))}</span></div><div class="comp-body">
      <span class="lbl">Fichier</span><span class="val" style="grid-column:span 2">${esc(rel)}</span></div></div>
      <div class="comp"><div class="comp-head">${icon('maximize', 14)}Transformation</div><div class="comp-body" id="insT">
      <span class="lbl">Position</span><span class="val"><span class="ax">X</span><b id="iX">-</b></span><span class="val"><span class="ay">Y</span><b id="iY">-</b></span>
      <span class="lbl">Direction</span><span class="val" style="grid-column:span 2" id="iD">-</span>
      <span class="lbl">Taille</span><span class="val" style="grid-column:span 2" id="iS">-</span></div></div>
      <div class="comp"><div class="comp-head">${icon('image', 14)}Rendu</div><div class="comp-body">
      <span class="lbl">Visible</span><span class="val" style="grid-column:span 2" id="iV">-</span>
      <span class="lbl">Costume</span><span class="val" style="grid-column:span 2" id="iC">-</span>
      <span class="lbl">Clones</span><span class="val" style="grid-column:span 2" id="iK">-</span></div></div>`;
    if (!t) box.querySelector('#insT').insertAdjacentHTML('beforeend', '<span class="lbl" style="grid-column:span 3">Lance le jeu pour créer ce lutin dans la scène.</span>');
  } else if (rel === 'stage.sc') {
    box.innerHTML = `<div class="comp"><div class="comp-head">${icon('image', 14)}Scène</div><div class="comp-body">
      <span class="lbl">Fichier</span><span class="val" style="grid-column:span 2">stage.sc</span>
      <span class="lbl">Taille</span><span class="val" style="grid-column:span 2">480 × 360</span></div></div>`;
  } else {
    box.innerHTML = `<div class="comp"><div class="comp-head">${icon('layers', 14)}<span>${esc(state.config ? state.config.name : 'Projet')}</span></div><div class="comp-body">
      <span class="lbl">Dossier</span><span class="val" style="grid-column:span 2" title="${esc(DIR)}">${esc(DIR)}</span>
      <span class="lbl">Lutins</span><span class="val" style="grid-column:span 2">${allFiles().filter(f => /^sprites\/.+\.sc$/.test(f)).length}</span></div></div>`;
  }
}
setInterval(() => {
  const rel = state.active; const sc = engine();
  if (!rel || !sc || !$('#iX')) return;
  const t = sc.vm.runtime.targets.find(x => x.isOriginal && !x.isStage && x.getName() === spriteName(rel));
  if (!t) return;
  $('#iX').textContent = Math.round(t.x); $('#iY').textContent = Math.round(t.y);
  $('#iD').textContent = Math.round(t.direction) + '°'; $('#iS').textContent = Math.round(t.size) + ' %';
  $('#iV').textContent = t.visible ? 'Oui' : 'Non';
  const c = t.getCostumes()[t.currentCostume]; $('#iC').textContent = c ? c.name : '-';
  $('#iK').textContent = String(t.sprite.clones.length - 1);
}, 200);

// ---------------- Menus ----------------
function showMenu(x, y, items) {
  const m = $('#menu'); m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    if (typeof it === 'string') { const t = document.createElement('div'); t.className = 'menu-title'; t.textContent = it; m.appendChild(t); continue; }
    const b = document.createElement('button');
    b.innerHTML = icon(it.ic || 'file', 14) + '<span></span>' + (it.key ? `<span class="key">${esc(it.key)}</span>` : '');
    b.querySelector('span').textContent = it.label;
    b.onclick = () => { m.classList.remove('show'); it.fn(); };
    m.appendChild(b);
  }
  m.classList.add('show');
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
}
const menuAt = (el, items) => { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, items); };
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) $('#menu').classList.remove('show'); });
function ask(title, value = '') {
  return new Promise(res => {
    $('#modalTitle').textContent = title; $('#modalInput').value = value;
    $('#modalBack').classList.add('show'); $('#modalInput').focus(); $('#modalInput').select();
    const done = v => { $('#modalBack').classList.remove('show'); res(v); };
    $('#modalOk').onclick = () => done($('#modalInput').value.trim());
    $('#modalCancel').onclick = () => done(null);
    $('#modalInput').onkeydown = e => { if (e.key === 'Enter') done($('#modalInput').value.trim()); if (e.key === 'Escape') done(null); };
  });
}
async function newSprite() {
  const name = await ask('Nom du nouveau lutin');
  if (!name) return;
  const safe = name.replace(/[<>:"/\\|?*]/g, '');
  const rel = `sprites/${safe}.sc`;
  if (allFiles().includes(rel)) return toast('Ce lutin existe déjà.', true);
  ignoreDisk.set(rel, Date.now());
  await studio.writeFile(DIR, rel, `when flag clicked\ngo to x: (0) y: (0)\nsay [Je suis ${safe} !] for (2) seconds\n`);
  state.expanded.add('sprites');
  journal(`Lutin créé : ${esc(rel)}`);
  await refreshTree(); openFile(rel);
}
async function renameNode(n) {
  const v = await ask('Renommer', n.name); if (!v || v === n.name) return;
  const to = n.path.split('/').slice(0, -1).concat(v).join('/');
  await studio.renameFile(DIR, n.path, to);
  if (state.models.has(n.path)) { state.models.get(n.path).dispose(); state.models.delete(n.path); state.open = state.open.map(r => r === n.path ? to : r); if (state.active === n.path) state.active = to; }
  await refreshTree(); if (state.active === to) openFile(to);
}
async function deleteNode(n) {
  if (!confirm(`Supprimer définitivement « ${n.path} » ?`)) return;
  await studio.deleteFile(DIR, n.path);
  if (state.models.has(n.path)) { state.models.get(n.path).dispose(); state.models.delete(n.path); }
  state.open = state.open.filter(r => r !== n.path); if (state.active === n.path) state.active = null;
  journal(`Supprimé : ${esc(n.path)}`);
  await refreshTree(); if (state.open.length) openFile(state.open[0]); else closeTab('__none__');
}
function treeMenu(e, n) {
  const items = [{ label: 'Nouveau lutin', ic: 'plus', key: 'Alt+Insér', fn: newSprite }];
  if (n.type === 'file') items.unshift({ label: 'Ouvrir', ic: 'fileCode', fn: () => openFile(n.path) });
  if (n.path !== 'project.scratchcode') items.push('-', { label: 'Renommer…', ic: 'edit', key: 'Maj+F6', fn: () => renameNode(n) }, { label: 'Supprimer', ic: 'trash', key: 'Suppr', fn: () => deleteNode(n) });
  showMenu(e.clientX, e.clientY, items);
}
async function exportAs() {
  try {
    await saveAll();
    await syncEngine(false);
    const sc = await waitEngine();
    const projName = (state.config && state.config.name) || 'MonProjet';
    const b64 = await blobToBase64(await sc.saveSb3(projName));
    await studio.writeBinary(DIR, `${projName}.sb3`, b64);
    const savedPath = await studio.exportSave(projName, 'sb3', b64);
    await refreshTree();
    if (savedPath) { toast(`Exporté : ${savedPath}`); journal(`Exporté en .sb3 : ${esc(savedPath)}`); }
  } catch (e) {
    toast(cleanErr(e), true);
  }
}
function setFontSize(delta) {
  prefs.fontSize = Math.max(10, Math.min(28, prefs.fontSize + delta));
  savePrefs(); editor.updateOptions({ fontSize: prefs.fontSize });
}
function toggleMinimap() { prefs.minimap = !prefs.minimap; savePrefs(); editor.updateOptions({ minimap: { enabled: prefs.minimap } }); }
function toggleTurbo() { prefs.turbo = !prefs.turbo; savePrefs(); const sc = engine(); if (sc) sc.vm.setTurboMode(prefs.turbo); toast(prefs.turbo ? 'Mode Turbo activé' : 'Mode Turbo désactivé'); }

// Toutes les actions (menu principal, « Rechercher une action »)
const ACTIONS = [
  { group: 'Fichier', label: 'Nouveau lutin', ic: 'plus', key: 'Alt+Insér', fn: newSprite },
  { group: 'Fichier', label: 'Enregistrer', ic: 'save', key: 'Ctrl+S', fn: () => state.active && saveFile(state.active) },
  { group: 'Fichier', label: 'Tout enregistrer', ic: 'save', key: 'Ctrl+Maj+S', fn: saveAll },
  { group: 'Fichier', label: 'Exporter en .sb3…', ic: 'box', fn: exportAs },
  { group: 'Fichier', label: 'Ouvrir le dossier du projet', ic: 'external', fn: () => studio.reveal(DIR) },
  { group: 'Fichier', label: 'Projets (écran d\'accueil)', ic: 'home', fn: () => studio.showHub() },
  { group: 'Fichier', label: 'Fermer l\'onglet', ic: 'x', key: 'Ctrl+F4', fn: () => state.active && closeTab(state.active) },
  { group: 'Navigation', label: 'Rechercher partout', ic: 'search', key: 'Maj Maj', fn: () => openSearch('all') },
  { group: 'Navigation', label: 'Aller au fichier…', ic: 'fileCode', key: 'Ctrl+Maj+N', fn: () => openSearch('files') },
  { group: 'Navigation', label: 'Fichiers récents', ic: 'clock', key: 'Ctrl+E', fn: () => openSearch('recent') },
  { group: 'Navigation', label: 'Aller à la ligne…', ic: 'list', key: 'Ctrl+G', fn: async () => { const v = await ask('Aller à la ligne'); if (v) goToLine(+v || 1); } },
  { group: 'Exécution', label: 'Lancer « Jeu »', ic: 'play', key: 'Maj+F10', fn: run },
  { group: 'Exécution', label: 'Arrêter', ic: 'stop', key: 'Ctrl+F2', fn: stop },
  { group: 'Exécution', label: 'Activer ou désactiver le mode Turbo', ic: 'rocket', fn: toggleTurbo },
  { group: 'Affichage', label: 'Projet', ic: 'folder', key: 'Alt+1', fn: () => showLeft('project') },
  { group: 'Affichage', label: 'Structure', ic: 'list', key: 'Alt+7', fn: () => showLeft('structure') },
  { group: 'Affichage', label: 'Exécution', ic: 'play', key: 'Alt+4', fn: () => showBottom('run') },
  { group: 'Affichage', label: 'Problèmes', ic: 'alert', key: 'Alt+6', fn: () => showBottom('problems') },
  { group: 'Affichage', label: 'Journal', ic: 'terminal', key: 'Alt+F12', fn: () => showBottom('console') },
  { group: 'Affichage', label: 'Fenêtre Jeu', ic: 'gamepad', fn: toggleRight },
  { group: 'Affichage', label: 'Agrandir le texte', ic: 'plus', key: 'Ctrl+=', fn: () => setFontSize(1) },
  { group: 'Affichage', label: 'Réduire le texte', ic: 'minus', key: 'Ctrl+-', fn: () => setFontSize(-1) },
  { group: 'Affichage', label: 'Afficher ou masquer la mini-carte', ic: 'layers', fn: toggleMinimap },
  { group: 'Aide', label: 'Guide de syntaxe ScratchCode', ic: 'book', fn: () => allFiles().includes('SCRATCHCODE.md') && openFile('SCRATCHCODE.md') },
  { group: 'Aide', label: 'Raccourcis clavier', ic: 'list', fn: () => openSearch('actions') }
];
$('#mainMenuBtn').onclick = e => {
  const items = [];
  for (const g of ['Fichier', 'Navigation', 'Exécution', 'Affichage', 'Aide']) {
    if (items.length) items.push('-');
    items.push(g, ...ACTIONS.filter(a => a.group === g));
  }
  menuAt(e.currentTarget, items);
};
$('#projectWidget').onclick = async e => {
  const el = e.currentTarget;
  const recent = (await studio.recent()).filter(p => p.path !== DIR).slice(0, 8);
  menuAt(el, ['Projets récents', ...(recent.length ? recent.map(p => ({ label: p.name, ic: 'folder', fn: () => studio.openProject(p.path) })) : [{ label: 'Aucun autre projet', ic: 'folder', fn: () => {} }]),
    '-', { label: 'Nouveau projet…', ic: 'folderPlus', fn: () => studio.showHub() }, { label: 'Ouvrir…', ic: 'folderOpen', fn: () => studio.showHub() },
    { label: 'Ouvrir le dossier dans l\'explorateur', ic: 'external', fn: () => studio.reveal(DIR) }]);
};
$('#runConfig').onclick = e => menuAt(e.currentTarget, ['Configurations d\'exécution',
  { label: 'Jeu (drapeau vert)', ic: 'gamepad', key: 'Maj+F10', fn: run },
  { label: prefs.turbo ? 'Désactiver le mode Turbo' : 'Activer le mode Turbo', ic: 'rocket', fn: toggleTurbo }]);
$('#settingsBtn').onclick = e => menuAt(e.currentTarget, ['Paramètres',
  { label: `Taille du texte : ${prefs.fontSize}  (agrandir)`, ic: 'plus', key: 'Ctrl+=', fn: () => setFontSize(1) },
  { label: 'Réduire le texte', ic: 'minus', key: 'Ctrl+-', fn: () => setFontSize(-1) },
  { label: prefs.minimap ? 'Masquer la mini-carte' : 'Afficher la mini-carte', ic: 'layers', fn: toggleMinimap },
  { label: prefs.turbo ? 'Désactiver le mode Turbo' : 'Activer le mode Turbo', ic: 'rocket', fn: toggleTurbo }]);
$('#runBtn').onclick = run; $('#stopBtn').onclick = stop; $('#gameRun').onclick = run;
$('#exportBtn').onclick = exportAs;
$('#newSprite').onclick = newSprite; $('#refreshTree').onclick = refreshTree;
$('#actReveal').onclick = () => studio.reveal(DIR);

// ---------------- Rechercher partout ----------------
let searchScope = 'all', searchItems = [], searchSel = 0;
async function collectSymbols() {
  const out = [];
  for (const rel of allFiles().filter(f => f.endsWith('.sc'))) {
    const text = state.models.has(rel) ? state.models.get(rel).getValue() : await studio.readFile(DIR, rel).catch(() => '');
    for (const s of scriptsOf(text)) out.push({ type: 'symbol', label: s.label, hint: `${rel}:${s.line}`, fn: () => openFile(rel, s.line) });
  }
  return out;
}
async function openSearch(scope) {
  searchScope = scope;
  document.querySelectorAll('#searchTabs button').forEach(b => b.classList.toggle('active', b.dataset.scope === (scope === 'recent' ? 'files' : scope)));
  $('#searchBack').classList.add('show');
  $('#searchInput').value = '';
  $('#searchInput').placeholder = scope === 'recent' ? 'Fichiers récents' : 'Tape pour rechercher';
  $('#searchInput').focus();
  state.symbols = await collectSymbols();
  renderSearch();
}
function closeSearch() { $('#searchBack').classList.remove('show'); editor && editor.focus(); }
function renderSearch() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const match = s => !q || s.toLowerCase().includes(q);
  const groups = [];
  const files = (searchScope === 'recent' ? state.recentFiles : allFiles()).filter(match)
    .map(rel => ({ label: rel.split('/').pop(), hint: rel, ic: fileIcon(rel)[0], fn: () => openFile(rel) }));
  const syms = (state.symbols || []).filter(s => match(s.label)).map(s => ({ ...s, ic: 'flag' }));
  const acts = ACTIONS.filter(a => match(a.label)).map(a => ({ label: a.label, hint: a.key || a.group, ic: a.ic, fn: a.fn }));
  if (searchScope === 'all' || searchScope === 'files' || searchScope === 'recent') groups.push(['Fichiers', files]);
  if (searchScope === 'all' || searchScope === 'symbols') groups.push(['Scripts', syms]);
  if (searchScope === 'all' || searchScope === 'actions') groups.push(['Actions', acts]);
  searchItems = [];
  let html = '';
  for (const [name, list] of groups) {
    const shown = list.slice(0, searchScope === 'all' ? 6 : 40);
    if (!shown.length) continue;
    if (searchScope === 'all') html += `<div class="group">${name}</div>`;
    for (const it of shown) {
      html += `<div class="it" data-i="${searchItems.length}">${icon(it.ic || 'file', 15)}<span>${esc(it.label)}</span><span class="hint">${esc(it.hint || '')}</span></div>`;
      searchItems.push(it);
    }
  }
  $('#searchList').innerHTML = html || '<div class="empty">Aucun résultat.</div>';
  searchSel = 0; markSearch();
  $('#searchList').querySelectorAll('.it').forEach(el => {
    el.onmousemove = () => { searchSel = +el.dataset.i; markSearch(); };
    el.onclick = () => pickSearch(+el.dataset.i);
  });
}
function markSearch() {
  $('#searchList').querySelectorAll('.it').forEach(el => el.classList.toggle('sel', +el.dataset.i === searchSel));
  const sel = $('#searchList').querySelector('.it.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function pickSearch(i) { const it = searchItems[i]; closeSearch(); if (it) it.fn(); }
$('#searchInput').addEventListener('input', renderSearch);
$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); searchSel = Math.min(searchItems.length - 1, searchSel + 1); markSearch(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); searchSel = Math.max(0, searchSel - 1); markSearch(); }
  if (e.key === 'Enter') { e.preventDefault(); pickSearch(searchSel); }
  if (e.key === 'Escape') closeSearch();
  if (e.key === 'Tab') {
    e.preventDefault();
    const order = ['all', 'files', 'symbols', 'actions'];
    openSearch(order[(order.indexOf(searchScope === 'recent' ? 'files' : searchScope) + 1) % order.length]);
  }
});
document.querySelectorAll('#searchTabs button').forEach(b => b.onclick = () => openSearch(b.dataset.scope));
$('#searchBack').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeSearch(); });
$('#searchBtn').onclick = () => openSearch('all');

// ---------------- Raccourcis clavier (style JetBrains) ----------------
let lastShift = 0;
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Shift' && !e.repeat && !ctrl && !e.altKey) {
    if (Date.now() - lastShift < 350) { lastShift = 0; openSearch('all'); return; }
    lastShift = Date.now();
    return;
  }
  if (ctrl && k === 's') { e.preventDefault(); e.shiftKey ? saveAll() : state.active && saveFile(state.active).then(() => setState(`${state.active} enregistré`, 'save')); }
  else if (ctrl && e.shiftKey && k === 'n') { e.preventDefault(); openSearch('files'); }
  else if (ctrl && e.shiftKey && k === 'a') { e.preventDefault(); openSearch('actions'); }
  else if (ctrl && k === 'e') { e.preventDefault(); openSearch('recent'); }
  else if (ctrl && k === 'g') { e.preventDefault(); ACTIONS.find(a => a.key === 'Ctrl+G').fn(); }
  else if ((e.shiftKey && e.key === 'F10') || (e.key === 'F5' && !e.shiftKey)) { e.preventDefault(); run(); }
  else if ((ctrl && e.key === 'F2') || (e.shiftKey && e.key === 'F5')) { e.preventDefault(); stop(); }
  else if (ctrl && (e.key === 'F4' || k === 'w') && state.active) { e.preventDefault(); closeTab(state.active); }
  else if (e.altKey && e.key === 'Insert') { e.preventDefault(); newSprite(); }
  else if (e.altKey && ['1', '4', '6', '7'].includes(e.key)) { e.preventDefault(); ({ 1: () => showLeft('project'), 4: () => showBottom('run'), 6: () => showBottom('problems'), 7: () => showLeft('structure') })[e.key](); }
  else if (e.altKey && e.key === 'F12') { e.preventDefault(); showBottom('console'); }
  else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setFontSize(1); }
  else if (ctrl && e.key === '-') { e.preventDefault(); setFontSize(-1); }
  else if (e.key === 'Escape') { $('#menu').classList.remove('show'); }
}, true);
window.addEventListener('beforeunload', () => { if (state.open.some(isDirty)) saveAll(); });

// ---------------- Redimensionnement des fenêtres d'outils ----------------
document.querySelectorAll('.sash').forEach(s => s.addEventListener('mousedown', e => {
  e.preventDefault(); s.classList.add('drag'); frame.style.pointerEvents = 'none';
  const wb = $('#wb'); const kind = s.dataset.sash; const box = wb.getBoundingClientRect();
  const move = ev => {
    if (kind === 'side') wb.style.setProperty('--side-w', Math.max(170, Math.min(520, ev.clientX - box.left)) + 'px');
    else if (kind === 'game') wb.style.setProperty('--game-w', Math.max(300, Math.min(900, box.right - ev.clientX)) + 'px');
    else wb.style.setProperty('--bottom-h', Math.max(90, Math.min(box.height - 160, box.bottom - ev.clientY)) + 'px');
    editor && editor.layout();
  };
  const up = () => { s.classList.remove('drag'); frame.style.pointerEvents = ''; removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}));

// ---------------- Monaco ----------------
window.MonacoEnvironment = { getWorkerUrl: () => '/monaco/vs/base/worker/workerMain.js' };
require.config({ paths: { vs: '/monaco/vs' } });
require(['vs/editor/editor.main'], async () => {
  monacoApi = window.monaco;
  monacoApi.languages.register({ id: 'scratchcode', extensions: ['.sc'] });
  monacoApi.languages.setMonarchTokensProvider('scratchcode', {
    tokenizer: { root: [
      [/\/\/.*$/, 'comment'],
      [/^\s*(when|define!?)\b/, 'hat'],
      [/\b(forever|repeat until|repeat|if|then|else|end|wait until|wait|stop|create clone of|delete this clone|broadcast and wait|broadcast)\b/, 'control'],
      [/\b(set|change|go to|glide|move|turn|point in direction|point towards|say|think|show|hide|switch costume to|next costume|play sound|start sound|add|delete|insert|replace)\b/, 'action'],
      [/\[[^\]]*\]/, 'string'],
      [/\(\s*-?\d+(\.\d+)?\s*\)/, 'number'],
      [/[<>]/, 'boolean'],
      [/[()]/, 'paren']
    ] }
  });
  monacoApi.languages.setLanguageConfiguration('scratchcode', { comments: { lineComment: '//' }, brackets: [['(', ')'], ['[', ']'], ['<', '>']], autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '<', close: '>' }] });
  const kw = ['when flag clicked', 'when this sprite clicked', 'when [space v] key pressed', 'when I receive [message v]', 'when I start as a clone', 'forever', 'repeat (10)', 'repeat until <>', 'if <> then', 'else', 'end', 'wait (1) seconds', 'wait until <>', 'move (10) steps', 'turn right (15) degrees', 'go to x: (0) y: (0)', 'change x by (10)', 'change y by (10)', 'set x to (0)', 'set y to (0)', 'point in direction (90)', 'say [Bonjour !] for (2) seconds', 'say [Bonjour !]', 'show', 'hide', 'next costume', 'set size to (100) %', 'set [variable v] to (0)', 'change [variable v] by (1)', 'broadcast [message v]', 'create clone of (myself v)', 'delete this clone', 'stop [all v]', 'key (space v) pressed?', 'touching (edge v)?', 'mouse down?', 'define '];
  monacoApi.languages.registerCompletionItemProvider('scratchcode', { provideCompletionItems: (model, pos) => {
    const w = model.getWordUntilPosition(pos);
    const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
    return { suggestions: kw.map(k => ({ label: k, kind: monacoApi.languages.CompletionItemKind.Keyword, insertText: k, range })) };
  } });
  // Couleurs proches du thème sombre des IDE JetBrains, avec les teintes des catégories Scratch
  monacoApi.editor.defineTheme('jb-dark', { base: 'vs-dark', inherit: true, rules: [
    { token: 'hat', foreground: 'e8b84a', fontStyle: 'bold' }, { token: 'control', foreground: 'cf8e6d' }, { token: 'action', foreground: '56a8f5' },
    { token: 'string', foreground: '6aab73' }, { token: 'number', foreground: '2aacb8' }, { token: 'comment', foreground: '7a7e85', fontStyle: 'italic' },
    { token: 'boolean', foreground: 'c77dff' }, { token: 'paren', foreground: 'bcbec4' }
  ], colors: {
    'editor.background': '#1e1f22', 'editor.foreground': '#bcbec4', 'editorLineNumber.foreground': '#4b5059', 'editorLineNumber.activeForeground': '#a1a3ab',
    'editor.lineHighlightBackground': '#26282e', 'editor.lineHighlightBorder': '#26282e', 'editor.selectionBackground': '#214283', 'editorIndentGuide.background': '#313438',
    'editorIndentGuide.activeBackground': '#4b5059', 'editorCursor.foreground': '#ced0d6', 'editorGutter.background': '#1e1f22', 'editorWidget.background': '#2b2d30',
    'editorSuggestWidget.background': '#2b2d30', 'editorSuggestWidget.selectedBackground': '#2e436e', 'scrollbarSlider.background': '#4d4f5480'
  } });
  editor = monacoApi.editor.create($('#monaco'), {
    theme: 'jb-dark', automaticLayout: true, fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace', fontSize: prefs.fontSize, lineHeight: 1.6 * prefs.fontSize,
    fontLigatures: true, tabSize: 4, insertSpaces: true, minimap: { enabled: prefs.minimap }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on',
    glyphMargin: true, lineNumbersMinChars: 3, renderLineHighlight: 'all', scrollBeyondLastLine: false, guides: { indentation: true }, model: null
  });
  document.fonts.load(`${prefs.fontSize}px "JetBrains Mono"`).then(() => monacoApi.editor.remeasureFonts());
  editor.onDidChangeCursorPosition(e => $('#sCursor').textContent = `${e.position.lineNumber}:${e.position.column}`);
  editor.onMouseDown(e => {
    if (e.target.type === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && /jb-gutter-run/.test(e.target.element.className)) run();
  });
  $('#monaco').style.display = 'none';

  try {
    await refreshTree();
    const name = state.config.name;
    $('#tProject').textContent = name; $('#tPath').textContent = DIR;
    $('#projIcon').textContent = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'SC';
    document.title = `${name} - MaxyStudio`;
    journal(`Projet ouvert : ${esc(DIR)}`);
    const first = allFiles().find(f => /^sprites\/.+\.sc$/.test(f)) || (allFiles().includes('stage.sc') ? 'stage.sc' : null);
    if (first) await openFile(first); else renderInspector();
    renderTabs(); setState('Prêt');
  } catch (e) { toast(cleanErr(e), true); }
});
