// Pont universel ScratchCode Studio (fonctionne sous Electron preload ET sous le serveur natif C# / macOS / Linux)
(function () {
  if (window.studio) return;

  async function call(method, ...args) {
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Erreur serveur local');
    return data.result;
  }

  const ua = navigator.userAgent;
  const platform = /Windows/i.test(ua) ? 'win32' : /Mac/i.test(ua) ? 'darwin' : 'linux';

  window.studio = {
    platform,
    recent: () => call('recent:list'),
    pickFolder: (title) => call('dialog:pickFolder', title),
    defaultLocation: () => call('app:defaultLocation'),
    createProject: async (opts) => {
      const dir = await call('project:create', opts);
      if (dir) location.href = '/studio/editor.html?dir=' + encodeURIComponent(dir);
      return dir;
    },
    openProject: async (dir) => {
      await call('project:open', dir);
      location.href = '/studio/editor.html?dir=' + encodeURIComponent(dir);
      return true;
    },
    readProject: (dir) => call('project:read', dir),
    readFile: (dir, rel) => call('file:read', dir, rel),
    writeFile: (dir, rel, content) => call('file:write', dir, rel, content),
    writeBinary: (dir, rel, base64) => call('file:writeBinary', dir, rel, base64),
    exportSave: (defaultName, ext, base64) => call('project:exportSave', defaultName, ext, base64),
    deleteFile: (dir, rel) => call('file:delete', dir, rel),
    renameFile: (dir, from, to) => call('file:rename', dir, from, to),
    reveal: (dir) => call('shell:reveal', dir),
    showHub: () => { location.href = '/studio/hub.html'; },
    onChanged: (cb) => {
      const dir = new URLSearchParams(location.search).get('dir');
      if (!dir) return;
      setInterval(async () => {
        try {
          const files = await call('project:pollChanges', dir);
          if (files && files.length) cb(files);
        } catch {}
      }, 600);
    }
  };
})();
