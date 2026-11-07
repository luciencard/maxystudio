# MaxyStudio

Le moteur de jeu de [ScratchCode](https://scratchcode.web.app) : des projets 2D, 3D ou des applications, avec le code écrit en ScratchCode (les blocs Scratch en texte).

## Ce qu'il y a dedans

- **Trois types de projets** : 2D (la scène Scratch et ses lutins), 3D (objets, lumières, caméra, physique, modèles importés) et Application (boutons, textes, champs de saisie).
- **Un éditeur organisé comme les grands moteurs** : Hiérarchie, vue Scène avec outils Déplacer, Pivoter et Redimensionner, vue Jeu, Inspecteur avec composants (Rendu, Lumière, Caméra, Collision, Physique, Script), panneau Projet, Console, boutons Lecture, Pause et Image suivante, Annuler et Rétablir.
- **Le code** : un script `.sc` par objet. `when app run` remplace le drapeau vert. Les projets 3D ont plus de 50 nouveaux blocs (`move forward (0.1)`, `jump with force (6)`, `camera follow [myself] distance (7) height (3)`...).
- **Les assets** : modèles `.glb` `.gltf` `.obj` `.fbx` `.stl` `.ply` `.dae` (avec leurs animations), images et sons, à glisser dans le panneau Projet.
- **Le format `.maxycode`** : un projet est un dossier (`project.maxycode`, `scenes/`, `scripts/`, `assets/`), et Exporter le transforme en un seul fichier `.maxycode` à partager. Les anciens projets `.scratchcode` s'ouvrent toujours et sont convertis automatiquement.
- **Les plugins** (nouveau en 2.0) : menu **Plugins → Ajouter un plugin**. Un plugin ajoute des boutons et des outils au studio (générateurs de niveaux, vérification des builds, assistants...). Deux exemples sont fournis : le Vérificateur de build et le Bâtisseur d'arène. Pour créer le tien, lis [PLUGINS.md](PLUGINS.md).

MaxyStudio s'appelait auparavant ScratchCode Studio. Les projets `.scratchcode` existants s'ouvrent sans changement, et la liste des projets récents est reprise automatiquement.

## Télécharger

Les installateurs pour Windows, macOS et Linux sont sur la [page de téléchargement](https://scratchcode.web.app/installer/) et dans les [Releases](https://github.com/luciencard/maxystudio/releases).

## Raccourcis

| Action | Raccourci |
| --- | --- |
| Lancer ou arrêter | `Ctrl` + `P` |
| Pause / image suivante | `Ctrl` + `Maj` + `P` / `Ctrl` + `Alt` + `P` |
| Tout enregistrer | `Ctrl` + `S` |
| Annuler / rétablir | `Ctrl` + `Z` / `Ctrl` + `Y` |
| Dupliquer, supprimer, renommer | `Ctrl` + `D`, `Suppr`, `F2` |
| Outils Main, Déplacer, Pivoter, Redimensionner | `Q`, `W`, `E`, `R` |
| Cadrer la sélection | `F` |
| Se déplacer dans la scène | clic droit + `ZQSD` / `WASD` |

## Développer

```bash
npm ci
npm start
```

Pour publier une version, pousse un tag `vX.Y.Z` : GitHub Actions compile les installateurs des trois systèmes et les joint à la Release.

## Licences

Le code de MaxyStudio est sous licence MIT. Le moteur Scratch (scratch-vm, scratch-render, scratch-storage) appartient à la Scratch Foundation et reste soumis à ses propres licences. Le moteur 3D utilise [three.js](https://threejs.org) (licence MIT). La police JetBrains Mono est distribuée sous licence SIL Open Font 1.1 (`renderer/fonts/JetBrainsMono-OFL.txt`).

ScratchCode est un projet indépendant, ni affilié à la Scratch Foundation ni au MIT, ni approuvé par eux.
