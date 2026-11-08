// Modèles de projets de MaxyStudio 2.0 (2D, 3D et Application) et guide de syntaxe.
const crypto = require('crypto');
const id = () => crypto.randomBytes(4).toString('hex');
const json = o => JSON.stringify(o, null, 2);

// ---------- Images des modèles 2D (dessins originaux) ----------
const SVG = {
  lutin: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="50" r="38" fill="#855cd6" stroke="#5b3da8" stroke-width="4"/><ellipse cx="36" cy="44" rx="7" ry="9" fill="#fff"/><ellipse cx="60" cy="44" rx="7" ry="9" fill="#fff"/><circle cx="37" cy="46" r="4" fill="#2a1f4a"/><circle cx="61" cy="46" r="4" fill="#2a1f4a"/><path d="M36 64 Q48 74 60 64" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="26" cy="58" r="5" fill="#ff8fb1" opacity=".7"/><circle cx="70" cy="58" r="5" fill="#ff8fb1" opacity=".7"/></svg>',
  joueur: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="70" viewBox="0 0 60 70"><rect x="4" y="6" width="52" height="58" rx="12" fill="#ff8c1a" stroke="#c96a0e" stroke-width="4"/><rect x="14" y="20" width="10" height="13" rx="4" fill="#fff"/><rect x="36" y="20" width="10" height="13" rx="4" fill="#fff"/><circle cx="20" cy="28" r="3" fill="#33220f"/><circle cx="42" cy="28" r="3" fill="#33220f"/><path d="M20 46 Q30 53 40 46" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
  vaisseau: '<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70"><path d="M35 4 L60 60 L35 48 L10 60 Z" fill="#4c97ff" stroke="#2a64c4" stroke-width="4" stroke-linejoin="round"/><circle cx="35" cy="32" r="7" fill="#d8ecff"/><path d="M26 58 L35 68 L44 58" fill="#ffb84c"/></svg>',
  laser: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="34" viewBox="0 0 10 34"><rect x="1" y="1" width="8" height="32" rx="4" fill="#ff6680" stroke="#ffd0da" stroke-width="2"/></svg>',
  fondJour: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5ff"/><stop offset="1" stop-color="#e6f3ff"/></linearGradient></defs><rect width="480" height="360" fill="url(#c)"/><circle cx="400" cy="70" r="32" fill="#ffe27a"/><ellipse cx="110" cy="80" rx="46" ry="16" fill="#fff" opacity=".9"/><ellipse cx="290" cy="110" rx="60" ry="18" fill="#fff" opacity=".8"/><rect y="300" width="480" height="60" fill="#5cb85c"/><rect y="300" width="480" height="10" fill="#7fd27f"/></svg>',
  fondEspace: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#14122b"/><g fill="#fff"><circle cx="40" cy="50" r="1.6"/><circle cx="120" cy="20" r="1.2"/><circle cx="200" cy="90" r="1.8"/><circle cx="330" cy="40" r="1.3"/><circle cx="420" cy="120" r="1.7"/><circle cx="80" cy="200" r="1.2"/><circle cx="260" cy="230" r="1.5"/><circle cx="380" cy="280" r="1.2"/><circle cx="150" cy="320" r="1.6"/><circle cx="450" cy="330" r="1.3"/></g><circle cx="390" cy="210" r="40" fill="#9966ff" opacity=".85"/><ellipse cx="390" cy="210" rx="62" ry="12" fill="none" stroke="#cdb6ff" stroke-width="4" opacity=".8"/></svg>',
  fondBlanc: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#ffffff"/></svg>'
};

function sprite(name, extra) {
  return Object.assign({ id: id(), name, kind: 'sprite', x: 0, y: 0, size: 100, direction: 90, visible: true, rotationStyle: 'all around', draggable: false, costumes: [], sounds: [], script: `scripts/${name}.sc` }, extra);
}
function obj(kind, name, extra) {
  const o = {
    id: id(), name, kind, parent: null, active: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], script: '',
    collider: !['light', 'camera', 'empty'].includes(kind), rigidbody: { enabled: false, gravity: 1, bounce: 0 }
  };
  if (['cube', 'sphere', 'cylinder', 'cone', 'capsule', 'plane', 'torus'].includes(kind)) o.mesh = { color: '#c9ccd4', texture: '', opacity: 1, metalness: 0, roughness: 0.75, castShadow: true, receiveShadow: true };
  if (kind === 'camera') o.camera = { fov: 60, main: true };
  if (kind === 'light') o.light = { type: 'point', color: '#ffffff', intensity: 2, range: 12 };
  return deepMerge(o, extra || {});
}
function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return a;
}
const env = (extra = {}) => deepMerge({
  skyTop: '#5d9fe8', skyBottom: '#dcecfb', ambient: 0.55,
  sun: { color: '#fff6e5', intensity: 1.6, direction: [-0.6, -1, -0.4], shadows: true },
  fog: { enabled: false, color: '#dcecfb', near: 40, far: 160 }, gravity: 9.81
}, extra);
const scene = (type, body) => json(Object.assign({ format: 'scratchcode-scene', version: 1, type }, body));

// ---------- Modèles 2D ----------
const T2D = {
  // Vide : une scène blanche, sans lutin ni code. Les autres modèles sont des exemples.
  vide: () => ({
    'assets/Fond.svg': SVG.fondBlanc,
    'scenes/Main.scene': scene('2d', { stage: { backdrops: ['assets/Fond.svg'], script: '' }, objects: [] })
  }),
  plateforme: () => ({
    'assets/Joueur.svg': SVG.joueur, 'assets/Fond.svg': SVG.fondJour,
    'scripts/Scène.sc': 'when app run\nset [niveau v] to (1)\n',
    'scripts/Joueur.sc': 'when app run\ngo to x: (-180) y: (-110)\nset [vy v] to (0)\nforever\n    change [vy v] by (-1)\n    change y by (vy)\n    if <(y position) < (-110)> then\n        set y to (-110)\n        set [vy v] to (0)\n        if <key (up arrow v) pressed?> then\n            set [vy v] to (14)\n        end\n    end\n    if <key (right arrow v) pressed?> then\n        change x by (6)\n    end\n    if <key (left arrow v) pressed?> then\n        change x by (-6)\n    end\nend\n',
    'scenes/Main.scene': scene('2d', { stage: { backdrops: ['assets/Fond.svg'], script: 'scripts/Scène.sc' }, objects: [sprite('Joueur', { x: -180, y: -110, costumes: ['assets/Joueur.svg'] })] })
  }),
  arcade: () => ({
    'assets/Vaisseau.svg': SVG.vaisseau, 'assets/Laser.svg': SVG.laser, 'assets/Espace.svg': SVG.fondEspace,
    'scripts/Scène.sc': 'when app run\nset [score v] to (0)\n',
    'scripts/Vaisseau.sc': 'when app run\ngo to x: (0) y: (-130)\nforever\n    set x to (mouse x)\n    if <mouse down?> then\n        broadcast [tirer v]\n        wait (0.25) seconds\n    end\nend\n',
    'scripts/Laser.sc': 'when app run\nhide\n\nwhen I receive [tirer v]\ncreate clone of (myself v)\n\nwhen I start as a clone\ngo to (Vaisseau v)\nshow\nrepeat until <(y position) > (170)>\n    change y by (15)\nend\ndelete this clone\n',
    'scenes/Main.scene': scene('2d', {
      stage: { backdrops: ['assets/Espace.svg'], script: 'scripts/Scène.sc' },
      objects: [sprite('Vaisseau', { y: -130, costumes: ['assets/Vaisseau.svg'] }), sprite('Laser', { visible: false, costumes: ['assets/Laser.svg'] })]
    })
  })
};

// ---------- Modèles 3D ----------
const camera = (pos, rot) => obj('camera', 'Main Camera', { position: pos, rotation: rot });
const T3D = {
  // Vide : une caméra et un sol, sans code. Les autres modèles sont des exemples.
  vide: () => ({
    'scenes/Main.scene': scene('3d', {
      environment: env(), worldScript: '',
      objects: [
        camera([0, 3, 8], [-15, 0, 0]),
        obj('plane', 'Sol', { scale: [20, 1, 20], mesh: { color: '#9aa3b5' } })
      ]
    })
  }),
  aventure: () => {
    const plats = [[4, 1, -3, '#ff8c1a'], [8, 2.2, -7, '#4c97ff'], [3, 3.4, -12, '#59c059'], [-3, 4.6, -10, '#cf63cf']];
    const coins = [[4, 2.3, -3], [8, 3.5, -7], [3, 4.7, -12], [-3, 5.9, -10], [-6, 0.9, 2]];
    return {
      'scripts/Monde.sc': 'when app run\nset [pièces v] to (0)\n\nwhen I receive [gagné v]\nshow message [Bravo, tu as ramassé les 5 pièces !]\n',
      'scripts/Joueur.sc': 'when app run\nturn physics [on v]\ncamera follow [myself] distance (7) height (3.5)\nshow message [Ramasse les 5 pièces. Flèches ou ZQSD pour bouger, espace pour sauter.]\nforever\n    rotate by x: (0) y: ((axis [horizontal v]) * (-3)) z: (0) degrees\n    move forward ((axis [vertical v]) * (0.12))\n    if <key (space v) pressed?> then\n        jump with force (6.5)\n    end\n    if <([y position v] of object [myself]) < (-10)> then\n        set position to x: (0) y: (2) z: (0)\n    end\nend\n',
      'scripts/Pièce.sc': 'when app run\nshow object [myself]\nforever\n    rotate by x: (0) y: (4) z: (0) degrees\nend\n\nwhen this object touches [Joueur]\nhide object [myself]\nchange [pièces v] by (1)\nif <(pièces) = (5)> then\n    broadcast [gagné v]\nend\n',
      'scenes/Main.scene': scene('3d', {
        environment: env({ fog: { enabled: true, near: 30, far: 90 } }), worldScript: 'scripts/Monde.sc',
        objects: [
          camera([0, 4, 9], [-18, 0, 0]),
          obj('plane', 'Sol', { scale: [40, 1, 40], mesh: { color: '#79c06a' } }),
          obj('capsule', 'Joueur', { position: [0, 1, 0], script: 'scripts/Joueur.sc', rigidbody: { enabled: true }, mesh: { color: '#ff6680' } }),
          ...plats.map(([x, y, z, c], i) => obj('cube', `Plateforme ${i + 1}`, { position: [x, y, z], scale: [3, 0.5, 3], mesh: { color: c } })),
          ...coins.map(([x, y, z], i) => obj('torus', `Pièce ${i + 1}`, { position: [x, y, z], script: 'scripts/Pièce.sc', collider: false, mesh: { color: '#ffcc33', metalness: 0.6, roughness: 0.3 } })),
          obj('light', 'Lampe', { position: [-6, 3, 2], light: { color: '#ffd28a', intensity: 3, range: 10 } })
        ]
      })
    };
  },
  fps: () => {
    const targets = [[-4, 1, -8], [0, 2, -12], [4, 1, -8], [7, 3, -14], [-7, 3, -14]];
    return {
      'scripts/Monde.sc': 'when app run\nset [cibles v] to (0)\nshow message [Clique sur la scène pour viser à la souris. Clique sur les cibles !]\n\nwhen stage clicked\nlock mouse pointer\n',
      'scripts/Joueur.sc': 'when app run\nturn physics [on v]\nfirst person camera on [myself] eye height (1.6)\nforever\n    move forward ((axis [vertical v]) * (0.12))\n    move sideways ((axis [horizontal v]) * (0.1))\n    if <key (space v) pressed?> then\n        jump with force (6)\n    end\nend\n',
      'scripts/Cible.sc': 'when app run\nshow object [myself]\n\nwhen this object clicked\nhide object [myself]\nchange [cibles v] by (1)\nshow message (join [Cibles touchées : ] (cibles))\n',
      'scenes/Main.scene': scene('3d', {
        environment: env({ skyTop: '#2f3b63', skyBottom: '#f0a868', ambient: 0.45, sun: { color: '#ffd9a8', intensity: 1.3, direction: [0.7, -0.6, 0.3] } }), worldScript: 'scripts/Monde.sc',
        objects: [
          obj('plane', 'Sol', { scale: [50, 1, 50], mesh: { color: '#8a8f99' } }),
          obj('capsule', 'Joueur', { position: [0, 1, 4], rotation: [0, 180, 0], script: 'scripts/Joueur.sc', rigidbody: { enabled: true }, mesh: { color: '#4c97ff' } }),
          obj('cube', 'Mur', { position: [0, 1.5, -18], scale: [30, 3, 1], mesh: { color: '#b7a07a' } }),
          ...targets.map(([x, y, z], i) => obj('cylinder', `Cible ${i + 1}`, { position: [x, y, z], rotation: [90, 0, 0], scale: [1.2, 0.2, 1.2], script: 'scripts/Cible.sc', mesh: { color: '#ff4d4d' } }))
        ]
      })
    };
  }
};

// ---------- Modèles Application ----------
const TAPP = {
  // Vide : un fond blanc, sans code. Le modèle Quiz est un exemple.
  vide: () => ({
    'assets/Fond.svg': SVG.fondBlanc,
    'scenes/Main.scene': scene('app', { stage: { backdrops: ['assets/Fond.svg'], script: '' }, objects: [] })
  }),
  quiz: () => ({
    'scripts/App.sc': 'when app run\nset [score v] to (0)\nset app background to [#eef7ff]\nadd title [titre] text [Quiz des capitales]\nadd label [question] text [Quelle est la capitale du Japon ?]\nadd button [r1] text [Kyoto]\nadd button [r2] text [Tokyo]\nadd button [r3] text [Osaka]\nadd label [résultat] text [ ]\n\nwhen button [r2] clicked\nchange [score v] by (1)\nset text of [résultat] to [Bonne réponse !]\nshow notification (join [Score : ] (score))\n\nwhen button [r1] clicked\nset text of [résultat] to [Non, essaie encore.]\n\nwhen button [r3] clicked\nset text of [résultat] to [Non, essaie encore.]\n',
    'assets/Fond.svg': SVG.fondBlanc,
    'scenes/Main.scene': scene('app', { stage: { backdrops: ['assets/Fond.svg'], script: 'scripts/App.sc' }, objects: [] })
  })
};

function build(type, template) {
  const t = type === '3d' ? '3d' : type === 'app' ? 'app' : '2d';
  const set = t === '3d' ? T3D : t === 'app' ? TAPP : T2D;
  const make = set[template] || set.vide;
  return { type: t, files: make() };
}

function legacyScene(names, hasStage) {
  return {
    format: 'scratchcode-scene', version: 1, type: '2d',
    stage: { backdrops: [], script: hasStage ? 'stage.sc' : '' },
    objects: names.map(n => sprite(n, { script: `sprites/${n}.sc` }))
  };
}

const BLOCKS_3D = `
## Blocs 3D (projets 3D)
« myself » désigne l'objet qui exécute le script. Les noms d'objets s'écrivent entre crochets : \`[Joueur]\`.
- Transformation : \`set position to x: (0) y: (1) z: (0)\`, \`change position by x: () y: () z: ()\`, \`move forward (0.1)\`, \`move sideways (0.1)\`,
  \`rotate by x: (0) y: (5) z: (0) degrees\`, \`set rotation to x: () y: () z: ()\`, \`look at object [Joueur]\`, \`look at x: () y: () z: ()\`,
  \`set scale to x: (1) y: (1) z: (1)\`, \`([x position v] of object [Joueur])\`, \`(distance to object [Joueur])\`
- Apparence : \`set color to [#ff6680]\`, \`set opacity to (50) %\`, \`set texture to [assets/bois.png]\`, \`show object [myself]\`, \`hide object [myself]\`,
  \`play animation [Walk]\`, \`play animation [Jump] once\`, \`stop animations\`, \`(animations of this object)\`
- Objets : \`create [cube v] named [Caisse] at x: (0) y: (3) z: (0)\`, \`create model [assets/arbre.glb] named [Arbre] at x: () y: () z: ()\`,
  \`clone object [myself] as [Copie]\`, \`delete object [Copie]\`, \`<object [Copie] exists?>\`, \`(name of this object)\`
- Physique : \`turn physics [on v]\`, \`set velocity to x: () y: () z: ()\`, \`change velocity by x: () y: () z: ()\`, \`jump with force (6)\`,
  \`set world gravity to (9.81)\`, \`<on ground?>\`, \`<touching object [anything]?>\`, \`when this object touches [Joueur]\`, \`([y v] velocity)\`
- Caméra : \`camera follow [myself] distance (7) height (3)\`, \`first person camera on [myself] eye height (1.6)\`, \`set camera position to x: () y: () z: ()\`,
  \`point camera at x: () y: () z: ()\`, \`set camera field of view to (60)\`, \`stop camera follow\`
- Entrées : \`(axis [horizontal v])\` et \`(axis [vertical v])\` (ZQSD, WASD, flèches, manette), \`(mouse movement [x v])\`, \`lock mouse pointer\`,
  \`unlock mouse pointer\`, \`when this object clicked\`, \`(object under mouse)\`
- Monde : \`set sky colors top [#5d9fe8] bottom [#dcecfb]\`, \`set fog from (20) to (90)\`, \`remove fog\`, \`set sun brightness to (1.6)\`,
  \`set ambient light to (0.5)\`, \`show message [Texte]\`, \`hide message\`, \`play sound file [assets/son.mp3]\`, \`stop sound files\`, \`(delta time)\`, \`print [Texte]\`
`;
const BLOCKS_UI = `
## Blocs Interface (projets Application)
- \`add title [id] text [Mon application]\`, \`add label [id] text [Bonjour]\`, \`add button [id] text [OK]\`, \`add text field [id] hint [Ton prénom]\`, \`add image [id] from [assets/logo.png]\`
- \`when button [ok] clicked\`, \`set text of [id] to [..]\`, \`(text of [id])\`, \`set [color v] of [id] to [#4c97ff]\`
- \`remove element [id]\`, \`clear interface\`, \`arrange elements in [row v]\`, \`set app background to [#f4f1ff]\`, \`show notification [Enregistré]\`
`;

function guide(type) {
  return `# Projet MaxyStudio 2.0 (${type === '3d' ? '3D' : type === 'app' ? 'Application' : '2D'})

Ce dossier est un projet **MaxyStudio** : des blocs Scratch écrits en texte, dans un moteur de jeu.

## Structure
- \`project.maxycode\` : configuration du projet (JSON)
- \`scenes/Main.scene\` : les objets de la scène (position, couleur, script...)
- \`scripts/<Nom>.sc\` : le code d'un objet. Plusieurs objets peuvent partager le même script.
- \`assets/\` : modèles 3D (.glb, .gltf, .obj, .fbx, .stl, .ply, .dae), images et sons importés

MaxyStudio surveille ce dossier : une modification faite par un autre outil (éditeur, assistant IA) est rechargée automatiquement.
Pour partager le projet, utilise Fichier > Exporter : tout le dossier devient un seul fichier \`.maxycode\`.

## Syntaxe
- Un bloc par ligne. Un script commence par un bloc chapeau, par exemple \`when app run\` (le drapeau vert de Scratch). Scripts séparés par une ligne vide.
- Entrées : \`(10)\` nombre, \`[bonjour]\` texte, \`[score v]\` menu, \`<...>\` condition, \`(x position)\` reporter.
- Blocs C (\`forever\`, \`repeat\`, \`if\`, \`repeat until\`, \`if/else\`) : indenter de 4 espaces et fermer avec \`end\`.
- Variables créées automatiquement par \`set [nom v] to (..)\`. Une variable créée dans le script du monde est partagée par tous les objets.
- Blocs personnalisés : \`define sauter (hauteur)\` puis \`sauter (10)\`. \`define!\` = sans rafraîchissement d'écran.
- Commentaires : \`// comme ceci\`
${type === '3d' ? BLOCKS_3D : type === 'app' ? BLOCKS_UI : ''}
## Exemple
\`\`\`
when app run
forever
    if <key (right arrow v) pressed?> then
        change x by (5)
    end
end
\`\`\`
`;
}

module.exports = { build, legacyScene, guide, SVG };
