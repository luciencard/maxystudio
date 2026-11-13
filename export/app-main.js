// Programme principal d'un jeu exporté par MaxyStudio (Windows, macOS, Linux).
// Sert les fichiers du jeu sur 127.0.0.1 (le moteur a besoin d'un vrai serveur web) et ouvre une fenêtre.
'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, 'www');
const GAME = JSON.parse(fs.readFileSync(path.join(WWW, 'game.json'), 'utf8'));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json'
};
app.setName(GAME.name || 'Jeu');
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400); return res.end(); }
    if (p === '/') p = '/jouer.html';
    const file = path.normalize(path.join(WWW, p));
    if (!file.startsWith(WWW + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Fichier introuvable'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const win = new BrowserWindow({
      width: 1280, height: 900, minWidth: 480, minHeight: 360, title: GAME.name || 'Jeu', backgroundColor: '#0d0f14',
      autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true }
    });
    win.loadURL(`http://127.0.0.1:${server.address().port}/jouer.html`);
    win.on('page-title-updated', e => e.preventDefault());
    // F11 : plein écran ; Échap : en sortir
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
      else if (input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
    });
    // Liens externes : dans le navigateur
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://127.0.0.1:')) e.preventDefault(); });
    if (GAME.fullscreen) win.setFullScreen(true);
  });
});
app.on('window-all-closed', () => app.quit());
