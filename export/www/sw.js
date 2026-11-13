// MaxyGame : sert les fichiers des jeux ouverts (modèles 3D, images, sons) depuis le cache du navigateur.
// Le lecteur dépose chaque fichier du jeu sous /jeux-cache/<id>/<chemin> ; le moteur les demande à ces adresses.
// Le moteur de ScratchCode enregistre aussi /sw.js : ce même fichier lui sert.
const CACHE = 'maxygame-jeux';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/jeux-cache/')) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(url.pathname);
    return hit || new Response('Fichier du jeu introuvable', { status: 404 });
  }));
});
