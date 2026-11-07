// Bâtisseur d'arène : plugin fourni avec MaxyStudio (projets 3D).
// Construit en un clic une arène de jeu : sol, murs, caisses, piliers et rampes, regroupés sous un objet « Arène ».

export function activate(api) {
  api.ui.addButton({ label: 'Arène', icon: 'hammer', title: 'Bâtisseur d\'arène : construire une arène 3D', onClick: () => open() });
  api.ui.addMenuItem({ label: 'Construire une arène…', icon: 'hammer', onClick: () => open() });

  async function open() {
    if (api.project.type !== '3d') return api.ui.toast('Ce plugin marche dans les projets 3D.', true);
    const last = api.storage.get('settings', { size: 40, height: 3, crates: 12, pillars: 4, ramps: true, floor: '#5b6b7f', walls: '#3f4a5c', crate: '#c98a4b' });
    const field = (k, label, html) => `<label style="display:grid;grid-template-columns:150px 1fr;align-items:center;gap:8px;margin:6px 0;font-size:13px">${label}${html}</label>`;
    const html =
      field('size', 'Taille (m)', `<input class="f" data-k="size" type="number" min="16" max="120" value="${last.size}">`) +
      field('height', 'Hauteur des murs (m)', `<input class="f" data-k="height" type="number" min="1" max="12" step="0.5" value="${last.height}">`) +
      field('crates', 'Caisses', `<input class="f" data-k="crates" type="number" min="0" max="60" value="${last.crates}">`) +
      field('pillars', 'Piliers', `<input class="f" data-k="pillars" type="number" min="0" max="16" value="${last.pillars}">`) +
      field('ramps', 'Rampes', `<input data-k="ramps" type="checkbox"${last.ramps ? ' checked' : ''}>`) +
      field('floor', 'Couleur du sol', `<input class="f" data-k="floor" type="color" value="${last.floor}">`) +
      field('walls', 'Couleur des murs', `<input class="f" data-k="walls" type="color" value="${last.walls}">`) +
      field('crate', 'Couleur des caisses', `<input class="f" data-k="crate" type="color" value="${last.crate}">`);
    let body = null;
    const ok = await api.ui.dialog('Construire une arène', html, { ok: 'Construire', onOpen: b => { body = b; } });
    if (!ok || !body) return;
    const val = k => { const el = body.querySelector(`[data-k="${k}"]`); return el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; };
    const opt = {};
    for (const k of Object.keys(last)) opt[k] = val(k);
    opt.size = clamp(opt.size, 16, 120); opt.height = clamp(opt.height, 1, 12);
    opt.crates = Math.round(clamp(opt.crates, 0, 60)); opt.pillars = Math.round(clamp(opt.pillars, 0, 16));
    api.storage.set('settings', opt);
    await api.scene.update(scene => build(scene, opt));
    api.console.ok(`Arène de ${opt.size} m construite. Ctrl+Z pour annuler.`);
    api.ui.toast('Arène construite.');
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const id = () => Math.random().toString(36).slice(2, 10);

function shape(kind, name, parent, position, scale, color, extra = {}) {
  return Object.assign({
    id: id(), name, kind, parent, active: true, position, rotation: [0, 0, 0], scale, script: '', collider: true,
    rigidbody: { enabled: false, gravity: 1, bounce: 0 },
    mesh: { color, texture: '', opacity: 1, metalness: 0, roughness: 0.8, castShadow: true, receiveShadow: true }
  }, extra);
}

function build(scene, o) {
  // Graine fixe : la même taille donne la même arène (pratique pour refaire un niveau).
  let seed = o.size * 7919 + o.crates * 31 + o.pillars;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const root = { id: id(), name: uniqueName(scene, 'Arène'), kind: 'empty', parent: null, active: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], script: '', collider: false, rigidbody: { enabled: false, gravity: 1, bounce: 0 } };
  const out = [root];
  const s = o.size, h = o.height, half = s / 2, t = 1;
  out.push(shape('cube', 'Sol', root.id, [0, -0.25, 0], [s, 0.5, s], o.floor));
  out.push(shape('cube', 'Mur nord', root.id, [0, h / 2, -half], [s + t, h, t], o.walls));
  out.push(shape('cube', 'Mur sud', root.id, [0, h / 2, half], [s + t, h, t], o.walls));
  out.push(shape('cube', 'Mur est', root.id, [half, h / 2, 0], [t, h, s + t], o.walls));
  out.push(shape('cube', 'Mur ouest', root.id, [-half, h / 2, 0], [t, h, s + t], o.walls));

  // Piliers en cercle, à mi-chemin entre le centre et les murs.
  for (let i = 0; i < o.pillars; i++) {
    const a = (i / o.pillars) * Math.PI * 2 + Math.PI / 4;
    const r = s * 0.28;
    out.push(shape('cylinder', `Pilier ${i + 1}`, root.id, [round(Math.cos(a) * r), h / 2 + 0.5, round(Math.sin(a) * r)], [1.6, h + 1, 1.6], o.walls));
  }

  // Caisses dispersées (pas au centre, où le joueur apparaît).
  for (let i = 0; i < o.crates; i++) {
    let x, z, tries = 0;
    do { x = (rnd() - 0.5) * (s - 4); z = (rnd() - 0.5) * (s - 4); tries++; } while (Math.hypot(x, z) < 4 && tries < 20);
    const size = 1 + Math.round(rnd() * 2) * 0.5;
    out.push(shape('cube', `Caisse ${i + 1}`, root.id, [round(x), size / 2, round(z)], [size, size, size], o.crate, { rotation: [0, Math.round(rnd() * 90), 0] }));
  }

  // Deux rampes qui montent vers des plateformes, pour jouer en hauteur.
  if (o.ramps) {
    for (const side of [-1, 1]) {
      const x = side * s * 0.3;
      out.push(shape('cube', `Plateforme ${side < 0 ? 'ouest' : 'est'}`, root.id, [x, 2, -s * 0.3], [6, 0.5, 6], o.walls));
      out.push(shape('cube', `Rampe ${side < 0 ? 'ouest' : 'est'}`, root.id, [x, 1, -s * 0.3 + 6], [4, 0.4, 6.5], o.floor, { rotation: [18, 0, 0] }));
    }
  }

  out.push({ id: id(), name: 'Lumière de l\'arène', kind: 'light', parent: root.id, active: true, position: [0, h + 6, 0], rotation: [0, 0, 0], scale: [1, 1, 1], script: '', collider: false, rigidbody: { enabled: false, gravity: 1, bounce: 0 }, light: { type: 'point', color: '#ffffff', intensity: 2.5, range: s } });
  scene.objects.push(...out);
}

const round = v => Math.round(v * 10) / 10;
function uniqueName(scene, name) {
  const names = new Set(scene.objects.map(o => o.name));
  if (!names.has(name)) return name;
  let i = 2;
  while (names.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}
