"""Construit la bibliothèque d'assets de MaxyStudio (studio-app/library) à partir des packs Kenney (CC0) téléchargés.
Usage : python -I tools/build-library.py <dossier des téléchargements kenney-dl> <studio-app/library> [<dossier des GLB convertis>]
Les packs sans GLB (Espace, Meubles) sont convertis à part depuis leurs OBJ + MTL (video/convert_obj.py) ; leurs GLB remplacent les FBX.
Chaque pack est lu dans son archive (rien n'est exécuté). On garde : modèles 3D (GLB, sinon glTF ou FBX) et leurs textures,
un aperçu par modèle (réduit), les sons (OGG), les textures et images d'interface, et la licence de chaque pack.
"""
import io, json, re, sys, zipfile
from pathlib import Path, PurePosixPath

from PIL import Image  # noqa: E402  (Pillow, déjà utilisé par les outils vidéo)

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
CONV = Path(sys.argv[3]) if len(sys.argv) > 3 else None
NAMES = {
    'nature-kit': 'Nature', 'city-kit-commercial': 'Ville : commerces', 'city-kit-suburban': 'Ville : maisons', 'city-kit-roads': 'Ville : routes',
    'car-kit': 'Voitures', 'blaster-kit': 'Blasters', 'space-kit': 'Espace', 'platformer-kit': 'Plateformes', 'survival-kit': 'Survie',
    'furniture-kit': 'Meubles', 'food-kit': 'Nourriture', 'castle-kit': 'Château', 'mini-characters': 'Mini personnages',
    'blocky-characters': 'Personnages cubiques', 'tower-defense-kit': 'Tower defense', 'fantasy-town-kit': 'Village fantastique',
    'pirate-kit': 'Pirates', 'graveyard-kit': 'Cimetière', 'racing-kit': 'Course', 'interface-sounds': 'Sons d\'interface',
    'sci-fi-sounds': 'Sons de science-fiction', 'prototype-textures': 'Textures de prototype', 'ui-pack': 'Interface (boutons, panneaux)'
}
SAFE = re.compile(r'^[A-Za-z0-9 _().,+-]+$')
THUMB = 160


def pretty(stem):
    """raceCarRed -> race car red ; tree_oak -> tree oak"""
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', stem).replace('_', ' ').replace('-', ' ').lower().strip()


def safe(p):
    parts = PurePosixPath(p).parts
    return parts and not any(x in ('..', '') or not SAFE.match(x) for x in parts)


def write(rel, data):
    f = OUT / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(data)


def thumb(data, rel):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    im.thumbnail((THUMB, THUMB))
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    write(rel, b.getvalue())


def model_dir(names):
    """Dossier des modèles à garder : GLB d'abord, puis glTF, puis FBX."""
    for ext, hints in (('.glb', ('GLB format', 'GLTF format', 'glTF format', 'Models')), ('.gltf', ('glTF format', 'GLTF format')), ('.fbx', ('FBX format', 'Models'))):
        for h in hints:
            files = [n for n in names if n.lower().endswith(ext) and f'/{h}/' in f'/{n}' and n.count('/') == n.split(h)[0].count('/') + 1]
            if files:
                return ext, files
    return None, []


entries = []
for pack_dir in sorted(SRC.iterdir()):
    pack = pack_dir.name
    z = zipfile.ZipFile(pack_dir / f'{pack}.zip')
    names = [n for n in z.namelist() if not n.endswith('/') and safe(n)]
    lic = next((n for n in names if n.endswith('License.txt')), None)
    if lic:
        write(f'licences/{pack}.txt', z.read(lic))
    title = NAMES.get(pack, pack)
    ext, models = model_dir(names)
    conv = CONV / pack if CONV and (CONV / pack).is_dir() else None
    if conv:
        # GLB convertis (textures incluses) à la place des FBX
        for g in sorted(conv.glob('*.glb')):
            write(f'modeles/{pack}/{g.name}', g.read_bytes())
            stem = g.stem
            prev = next((n for n in names if n.startswith('Previews/') and PurePosixPath(n).stem == stem), None)                 or next((n for n in names if n.startswith('Isometric/') and PurePosixPath(n).stem.startswith(stem + '_')), None)
            tr = f'apercus/{pack}/{stem}.png' if prev else None
            if prev:
                try:
                    thumb(z.read(prev), tr)
                except Exception:
                    tr = None
            entries.append({'type': 'modele', 'pack': pack, 'packName': title, 'name': pretty(stem), 'file': f'modeles/{pack}/{g.name}', 'thumb': tr})
        models = []
    if models:
        folder = str(PurePosixPath(models[0]).parent)
        # Textures du dossier des modèles (référencées par les GLB, glTF et FBX) et fichiers .bin des glTF
        for n in names:
            p = PurePosixPath(n)
            if str(p.parent).startswith(folder) and (p.suffix.lower() in ('.png', '.jpg', '.bin') and ('Textures' in p.parts or p.suffix.lower() == '.bin' or str(p.parent) == folder)):
                write(f'modeles/{pack}/{PurePosixPath(n).relative_to(folder)}', z.read(n))
        for m in models:
            stem = PurePosixPath(m).stem
            write(f'modeles/{pack}/{stem}{ext}', z.read(m))
            # Aperçu : Previews/<nom>.png, sinon une vue isométrique
            prev = next((n for n in names if n.startswith('Previews/') and PurePosixPath(n).stem == stem), None) \
                or next((n for n in names if n.startswith('Isometric/') and PurePosixPath(n).stem.startswith(stem + '_')), None)
            tr = None
            if prev:
                tr = f'apercus/{pack}/{stem}.png'
                try:
                    thumb(z.read(prev), tr)
                except Exception:
                    tr = None
            entries.append({'type': 'modele', 'pack': pack, 'packName': title, 'name': pretty(stem),
                            'file': f'modeles/{pack}/{stem}{ext}', 'thumb': tr})
    for n in names:
        p = PurePosixPath(n)
        if p.suffix.lower() == '.ogg':
            write(f'sons/{pack}/{p.name}', z.read(n))
            entries.append({'type': 'son', 'pack': pack, 'packName': title, 'name': pretty(p.stem), 'file': f'sons/{pack}/{p.name}'})
    if pack in ('prototype-textures', 'ui-pack'):
        kind = 'texture' if pack == 'prototype-textures' else 'image'
        for n in names:
            p = PurePosixPath(n)
            if p.suffix.lower() == '.png' and p.parts[0] == 'PNG' and 'Preview' not in p.name:
                sub = '/'.join(p.parts[1:-1])
                rel = f'images/{pack}/{sub + "/" if sub else ""}{p.name}'
                write(rel, z.read(n))
                entries.append({'type': kind, 'pack': pack, 'packName': title, 'name': pretty(sub.replace('/', ' ') + ' ' + p.stem), 'file': rel, 'thumb': rel})
        for n in names:
            if n.lower().endswith('.ttf'):
                write(f'polices/{PurePosixPath(n).name}', z.read(n))

packs = sorted({(e['pack'], e['packName']) for e in entries})
(OUT / 'library.json').write_text(json.dumps({
    'version': 1, 'source': 'Kenney (www.kenney.nl), licence CC0 1.0 : utilisables librement, même dans des jeux publiés.',
    'packs': [{'id': p, 'name': n, 'count': sum(1 for e in entries if e['pack'] == p)} for p, n in packs],
    'items': entries}, ensure_ascii=False), encoding='utf-8')
size = sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file())
by = {}
for e in entries:
    by[e['type']] = by.get(e['type'], 0) + 1
print('éléments :', by, '| packs :', len(packs), '| taille :', round(size / 1048576, 1), 'Mo')
print('sans aperçu :', sum(1 for e in entries if e['type'] == 'modele' and not e.get('thumb')))
