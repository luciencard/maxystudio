const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  recent: () => ipcRenderer.invoke('recent:list'),
  removeRecent: (dir) => ipcRenderer.invoke('recent:remove', dir),
  pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', title),
  defaultLocation: () => ipcRenderer.invoke('app:defaultLocation'),
  createProject: (opts) => ipcRenderer.invoke('project:create', opts),
  openProject: (dir) => ipcRenderer.invoke('project:open', dir),
  openAny: () => ipcRenderer.invoke('project:openAny'),
  readProject: (dir) => ipcRenderer.invoke('project:read', dir),
  exportProject: (dir, name) => ipcRenderer.invoke('project:export', dir, name),
  playArchive: (dir, spec) => ipcRenderer.invoke('play:archive', dir, spec),
  importAssets: (dir, folder) => ipcRenderer.invoke('assets:import', dir, folder),
  importPaths: (dir, folder, paths) => ipcRenderer.invoke('assets:importPaths', dir, folder, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  readFile: (dir, rel) => ipcRenderer.invoke('file:read', dir, rel),
  writeFile: (dir, rel, content) => ipcRenderer.invoke('file:write', dir, rel, content),
  writeBinary: (dir, rel, base64) => ipcRenderer.invoke('file:writeBinary', dir, rel, base64),
  mkdir: (dir, rel) => ipcRenderer.invoke('file:mkdir', dir, rel),
  deleteFile: (dir, rel) => ipcRenderer.invoke('file:delete', dir, rel),
  renameFile: (dir, from, to) => ipcRenderer.invoke('file:rename', dir, from, to),
  reveal: (dir, rel) => ipcRenderer.invoke('shell:reveal', dir, rel),
  showHub: () => ipcRenderer.invoke('hub:show'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  editors: {
    list: () => ipcRenderer.invoke('editors:list'),
    open: (id, dir, rel, line) => ipcRenderer.invoke('editors:open', id, dir, rel, line)
  },
  library: {
    index: () => ipcRenderer.invoke('library:index'),
    import: (dir, file) => ipcRenderer.invoke('library:import', dir, file)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    catalog: () => ipcRenderer.invoke('plugins:catalog'),
    installCatalog: (id) => ipcRenderer.invoke('plugins:installCatalog', id),
    installFrom: (kind) => ipcRenderer.invoke('plugins:installFrom', kind),
    remove: (id) => ipcRenderer.invoke('plugins:remove', id),
    setEnabled: (id, on) => ipcRenderer.invoke('plugins:setEnabled', id, on),
    openFolder: () => ipcRenderer.invoke('plugins:openFolder')
  },
  onChanged: (cb) => ipcRenderer.on('project:changed', (_e, files) => cb(files))
});
