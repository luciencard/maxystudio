const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  recent: () => ipcRenderer.invoke('recent:list'),
  pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', title),
  defaultLocation: () => ipcRenderer.invoke('app:defaultLocation'),
  createProject: (opts) => ipcRenderer.invoke('project:create', opts),
  openProject: (dir) => ipcRenderer.invoke('project:open', dir),
  readProject: (dir) => ipcRenderer.invoke('project:read', dir),
  readFile: (dir, rel) => ipcRenderer.invoke('file:read', dir, rel),
  writeFile: (dir, rel, content) => ipcRenderer.invoke('file:write', dir, rel, content),
  writeBinary: (dir, rel, base64) => ipcRenderer.invoke('file:writeBinary', dir, rel, base64),
  exportSave: (defaultName, ext, base64) => ipcRenderer.invoke('project:exportSave', defaultName, ext, base64),
  deleteFile: (dir, rel) => ipcRenderer.invoke('file:delete', dir, rel),
  renameFile: (dir, from, to) => ipcRenderer.invoke('file:rename', dir, from, to),
  reveal: (dir) => ipcRenderer.invoke('shell:reveal', dir),
  showHub: () => ipcRenderer.invoke('hub:show'),
  onChanged: (cb) => ipcRenderer.on('project:changed', (_e, files) => cb(files))
});
