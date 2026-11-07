# Créer un plugin pour MaxyStudio

Un plugin ajoute des outils à MaxyStudio : un bouton dans la barre **Plugins**, un élément dans le menu **Plugins**,
une fenêtre de réglages… Il peut lire et modifier la scène, les fichiers du projet, lancer le jeu, et vérifier le
projet avant chaque export. C'est le même principe que les plugins de Roblox Studio.

## 1. Les deux fichiers d'un plugin

Un plugin est un dossier qui contient au moins :

```
mon-plugin/
  plugin.json   la carte d'identité du plugin
  plugin.js     son code
```

`plugin.json` :

```json
{
  "id": "mon-plugin",
  "name": "Mon plugin",
  "version": "1.0.0",
  "author": "Ton pseudo",
  "description": "Ce que fait le plugin, en une ou deux phrases.",
  "main": "plugin.js",
  "icon": "plug"
}
```

- `id` : minuscules, chiffres et tirets seulement (2 à 41 caractères). Deux plugins ne peuvent pas avoir le même `id`.
- `icon` : un nom d'icône de MaxyStudio (`plug`, `wrench`, `hammer`, `box`, `rocket`, `gamepad`, `code`…).

`plugin.js` est un module JavaScript qui exporte une fonction `activate`. MaxyStudio l'appelle à l'ouverture
d'un projet, avec l'objet `api` :

```js
export function activate(api) {
  api.ui.addButton({
    label: 'Bonjour',
    icon: 'rocket',
    onClick: () => api.ui.toast('Bonjour depuis mon plugin !')
  });
}
```

## 2. Installer et tester

1. Menu **Plugins → Ajouter un plugin… → Depuis un dossier**, puis choisis le dossier `mon-plugin`.
2. Clique sur **Recharger** : le bouton « Bonjour » apparaît en haut à droite.
3. Après chaque modification du code, réinstalle le dossier (ou modifie directement la copie installée,
   menu **Plugins → Ouvrir le dossier des plugins**) et recharge.

Les erreurs de ton plugin s'affichent dans la **Console**, précédées de son nom.

## 3. Partager un plugin

Compresse le dossier en `.zip` et renomme-le en `.maxyplugin`. Les autres l'installent avec
**Plugins → Ajouter un plugin… → Depuis un fichier .maxyplugin**. Tu peux aussi le proposer sur maxygame.web.app.

Un plugin est un programme : il peut lire et modifier les projets. N'installe que des plugins de confiance, et
n'écris jamais de plugin qui envoie des fichiers ou des données personnelles sans le dire clairement.

## 4. L'API

### Interface
| Fonction | Rôle |
|---|---|
| `api.ui.addButton({ label, icon, title, onClick })` | Bouton dans la barre Plugins |
| `api.ui.addMenuItem({ label, icon, onClick })` | Élément du menu Plugins |
| `api.ui.dialog(titre, html, { ok, cancel, onOpen })` | Fenêtre ; `onOpen(corps)` pour lire ses champs. Renvoie `true` (OK) ou `null` |
| `api.ui.prompt(titre, valeur)` | Demande un texte |
| `api.ui.confirm(titre, texte, ok)` | Demande une confirmation |
| `api.ui.toast(message, erreur)` | Petit message en bas de l'écran |

### Scène
| Fonction | Rôle |
|---|---|
| `api.scene.get()` | Copie de la scène : `{ objects: [...], environment, worldScript }` en 3D |
| `api.scene.find(id)` | Copie d'un objet |
| `api.scene.update(async scene => { ... })` | Modifie la vraie scène en une fois (annulable avec Ctrl+Z) |
| `api.scene.create(kind, props, parentId)` | Crée un objet : `cube`, `sphere`, `cylinder`, `cone`, `capsule`, `plane`, `torus`, `light`, `camera`, `empty` (en 2D : un lutin) |
| `api.scene.remove(id)` | Supprime un objet et ses enfants |
| `api.selection.get()` / `api.selection.set(id)` | Objet sélectionné |

Un objet 3D ressemble à ceci :

```js
{ id, name, kind: 'cube', parent: null, position: [x, y, z], rotation: [x, y, z] /* degrés */, scale: [x, y, z],
  script: 'scripts/Joueur.sc', collider: true, rigidbody: { enabled: false, gravity: 1, bounce: 0 },
  mesh: { color: '#c9ccd4', texture: '', opacity: 1, metalness: 0, roughness: 0.75 } }
```

### Projet et jeu
| Fonction | Rôle |
|---|---|
| `api.project.name`, `api.project.type` | Nom et type (`2d`, `3d`, `app`) |
| `api.project.files()` / `api.project.exists(chemin)` | Fichiers du projet |
| `api.project.read(chemin)` / `api.project.write(chemin, texte)` | Lire ou écrire un fichier texte (scripts `.sc`, JSON…) |
| `api.project.openScript(chemin, ligne)` | Ouvre un script dans l'éditeur |
| `api.game.play()`, `api.game.stop()`, `api.game.playing` | Lancer, arrêter le jeu |

### Console, réglages, événements
| Fonction | Rôle |
|---|---|
| `api.console.log / ok / warn / error(texte)` | Message dans la Console |
| `api.storage.get(clé, défaut)` / `api.storage.set(clé, valeur)` | Réglages du plugin, gardés entre deux sessions |
| `api.on('play' \| 'stop' \| 'save' \| 'select', fn)` | Réagir à l'éditeur |
| `api.on('beforeExport', async () => [{ level: 'error' \| 'warn', message }])` | Vérifier le projet avant l'export : une erreur demande confirmation avant d'exporter |
| `api.openUrl('https://…')` | Ouvre une page dans le navigateur |

## 5. Exemples fournis

Deux plugins sont fournis avec MaxyStudio (menu **Plugins → Ajouter un plugin…**). Leur code est un bon point de départ :

- **Vérificateur de build** : fichiers manquants, noms en double, scripts vides ou jamais utilisés, avec réparation
  automatique et vérification avant l'export (`api.on('beforeExport')`, `api.scene.update`).
- **Bâtisseur d'arène** : une fenêtre de réglages (`api.ui.dialog` avec `onOpen`), des réglages retenus
  (`api.storage`), et la construction d'une arène 3D en une fois (`api.scene.update`).

## 6. Idées de plugins

- Un générateur de niveaux (labyrinthes, plateformes, villes).
- Un outil qui aligne ou répartit les objets sélectionnés.
- Un vérificateur de performance (trop d'objets, textures trop lourdes).
- Un assistant IA qui écrit des scripts : il demande alors sa propre clé d'API à son utilisateur et la garde avec
  `api.storage`, sans jamais l'envoyer ailleurs que chez le fournisseur d'IA.
