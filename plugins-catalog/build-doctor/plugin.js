// Vérificateur de build : plugin fourni avec MaxyStudio.
// Il cherche ce qui empêche un projet de marcher une fois exporté, et corrige ce qui peut l'être automatiquement.

export function activate(api) {
  api.ui.addButton({ label: 'Vérifier', icon: 'wrench', title: 'Vérificateur de build : chercher les problèmes du projet', onClick: () => report() });
  api.ui.addMenuItem({ label: 'Vérificateur de build', icon: 'wrench', onClick: () => report() });

  // Avant chaque export : les fichiers manquants bloquent (l'export marcherait, mais le jeu serait cassé).
  api.on('beforeExport', async () => {
    const problems = await inspect();
    return problems.map(p => ({ level: p.blocking ? 'error' : 'warn', message: p.message }));
  });

  async function inspect() {
    const scene = api.scene.get();
    const files = new Set(api.project.files());
    const problems = [];
    const missing = (rel, where, fix) => {
      if (rel && !files.has(rel)) problems.push({ blocking: true, message: `${where} : le fichier « ${rel} » n'existe plus.`, fix });
    };

    if (api.project.type === '3d') {
      missing(scene.worldScript, 'Script du monde', s => { s.worldScript = ''; });
      for (const o of scene.objects) {
        const id = o.id;
        missing(o.script, `« ${o.name} »`, s => { find(s, id).script = ''; });
        missing(o.model, `« ${o.name} » (modèle 3D)`, s => { find(s, id).model = ''; });
        if (o.mesh) missing(o.mesh.texture, `« ${o.name} » (texture)`, s => { find(s, id).mesh.texture = ''; });
      }
    } else if (scene.stage) {
      missing(scene.stage.script, 'Script de la scène', s => { s.stage.script = ''; });
      for (const rel of scene.stage.backdrops || []) missing(rel, 'Arrière-plan', s => { s.stage.backdrops = s.stage.backdrops.filter(r => r !== rel); });
      for (const o of scene.objects) {
        const id = o.id;
        missing(o.script, `« ${o.name} »`, s => { find(s, id).script = ''; });
        for (const rel of o.costumes || []) missing(rel, `« ${o.name} » (costume)`, s => { const t = find(s, id); t.costumes = t.costumes.filter(r => r !== rel); });
        for (const rel of o.sounds || []) missing(rel, `« ${o.name} » (son)`, s => { const t = find(s, id); t.sounds = t.sounds.filter(r => r !== rel); });
        if (o.costumes && !o.costumes.filter(r => files.has(r)).length) problems.push({ blocking: true, message: `« ${o.name} » n'a aucun costume : il sera invisible.` });
      }
    }

    // Deux objets avec le même nom : seul le premier exécute son script.
    const seen = new Map();
    for (const o of scene.objects) {
      if (api.project.type === '3d' && !o.script) continue;
      if (seen.has(o.name)) {
        const id = o.id, name = o.name;
        problems.push({ blocking: false, message: `Deux objets s'appellent « ${name} » : seul le premier exécute son script.`, fix: s => { find(s, id).name = uniqueName(s, name); } });
      } else seen.set(o.name, o.id);
    }

    // Scripts vides ou jamais utilisés.
    const used = new Set([scene.worldScript, scene.stage && scene.stage.script, ...scene.objects.map(o => o.script)].filter(Boolean));
    for (const rel of files) {
      if (!rel.endsWith('.sc')) continue;
      if (!used.has(rel)) problems.push({ blocking: false, message: `Le script « ${rel} » n'est attaché à aucun objet.` });
      else if (!(await api.project.read(rel)).trim()) problems.push({ blocking: false, message: `Le script « ${rel} » est vide.` });
    }
    return problems;
  }

  async function report() {
    const problems = await inspect();
    if (!problems.length) {
      api.console.ok('Aucun problème : le projet est prêt à être exporté.');
      return api.ui.toast('Aucun problème trouvé. Le projet est prêt.');
    }
    const fixable = problems.filter(p => p.fix);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const html = `<p class="in-note" style="font-size:13px">${problems.length} problème${problems.length > 1 ? 's' : ''} trouvé${problems.length > 1 ? 's' : ''}${fixable.length ? `, dont ${fixable.length} réparable${fixable.length > 1 ? 's' : ''} automatiquement` : ''}.</p>
      <ul class="pl-problems">${problems.map(p => `<li>${p.blocking ? '<b>Bloquant</b> ' : ''}${esc(p.message)}${p.fix ? ' <i>(réparable)</i>' : ''}</li>`).join('')}</ul>`;
    for (const p of problems) (p.blocking ? api.console.error : api.console.warn)(p.message);
    const ok = await api.ui.dialog('Vérificateur de build', html, { ok: fixable.length ? 'Réparer' : 'Fermer', cancel: fixable.length ? 'Plus tard' : '' });
    if (!ok || !fixable.length) return;
    await api.scene.update(scene => { for (const p of fixable) p.fix(scene); });
    api.console.ok(`${fixable.length} problème${fixable.length > 1 ? 's' : ''} réparé${fixable.length > 1 ? 's' : ''}. Ctrl+Z pour annuler.`);
    api.ui.toast(`${fixable.length} réparation${fixable.length > 1 ? 's' : ''} faite${fixable.length > 1 ? 's' : ''}.`);
  }
}

const find = (scene, id) => scene.objects.find(o => o.id === id) || {};
function uniqueName(scene, name) {
  const names = new Set(scene.objects.map(o => o.name));
  let i = 2;
  while (names.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}
