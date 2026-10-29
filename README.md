# ScratchCode Studio

L'application de bureau de [ScratchCode](https://scratchcode.web.app) pour écrire des projets Scratch 3 en texte.

Chaque projet est un dossier : un fichier `.sc` par lutin, un fichier `stage.sc` pour la scène, et un fichier `.sb3` régénéré à chaque exécution. Le `.sb3` s'ouvre dans ScratchCode, Scratch et TurboWarp.

L'interface reprend l'organisation des IDE JetBrains : écran d'accueil avec les projets récents, fenêtres d'outils (Projet, Structure, Jeu, Inspecteur, Exécution, Problèmes, Journal), recherche partout et raccourcis clavier.

## Télécharger

Les installateurs pour Windows, macOS et Linux sont sur la [page de téléchargement](https://scratchcode.web.app/installer/) et dans les [Releases](https://github.com/luciencard/scratchcode-studio/releases).

## Raccourcis

| Action | Raccourci |
| --- | --- |
| Rechercher partout | `Maj` `Maj` |
| Aller au fichier | `Ctrl` + `Maj` + `N` |
| Rechercher une action | `Ctrl` + `Maj` + `A` |
| Fichiers récents | `Ctrl` + `E` |
| Lancer le jeu | `Maj` + `F10` |
| Arrêter | `Ctrl` + `F2` |
| Nouveau lutin | `Alt` + `Insér` |
| Fenêtres Projet, Exécution, Problèmes, Structure | `Alt` + `1`, `4`, `6`, `7` |

## Développer

```bash
npm ci
npm start
```

Pour publier une version, pousse un tag `vX.Y.Z` : GitHub Actions compile les installateurs des trois systèmes et les joint à la Release.

## Licences

Le code de ScratchCode Studio est sous licence MIT. Le moteur Scratch (scratch-vm, scratch-render, scratch-storage) appartient à la Scratch Foundation et reste soumis à ses propres licences. La police JetBrains Mono est distribuée sous licence SIL Open Font 1.1 (`renderer/fonts/JetBrainsMono-OFL.txt`).

ScratchCode est un projet indépendant, ni affilié à la Scratch Foundation ni au MIT, ni approuvé par eux.
