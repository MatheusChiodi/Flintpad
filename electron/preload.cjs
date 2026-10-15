'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  debug: Boolean(process.env.FLINTPAD_SHOT),
  startNote: process.env.FLINTPAD_OPEN || null,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  getVault: () => ipcRenderer.invoke('vault:get'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  openVault: (folder) => ipcRenderer.invoke('vault:open', folder),
  recentVaults: () => ipcRenderer.invoke('vault:recent'),
  forgetVault: (folder) => ipcRenderer.invoke('vault:forget', folder),
  missingVault: () => ipcRenderer.invoke('vault:missing'),
  revealVault: (which) => ipcRenderer.invoke('vault:reveal', which),
  appInfo: () => ipcRenderer.invoke('app:info'),
  // Caminho no disco de um arquivo ou pasta solto na janela (arrastar e soltar).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  readAll: () => ipcRenderer.invoke('vault:readAll'),
  read: (rel) => ipcRenderer.invoke('note:read', rel),
  write: (rel, content) => ipcRenderer.invoke('note:write', rel, content),
  create: (rel) => ipcRenderer.invoke('note:create', rel),
  rename: (from, to) => ipcRenderer.invoke('note:rename', from, to),
  remove: (rel) => ipcRenderer.invoke('note:delete', rel),
  exportPdf: (name) => ipcRenderer.invoke('page:exportPdf', name),
  bruList: () => ipcRenderer.invoke('bru:list'),
  bruRead: (rel) => ipcRenderer.invoke('bru:read', rel),
  bruWrite: (rel, json) => ipcRenderer.invoke('bru:write', rel, json),
  bruCreate: (folder, name) => ipcRenderer.invoke('bru:create', folder, name),
  envWrite: (rel, variables) => ipcRenderer.invoke('env:write', rel, variables),
  httpSend: (request) => ipcRenderer.invoke('http:send', request),
  httpCancel: (id) => ipcRenderer.invoke('http:cancel', id),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyAdd: (entry) => ipcRenderer.invoke('history:add', entry),
  historyRemove: (id) => ipcRenderer.invoke('history:remove', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  filesList: () => ipcRenderer.invoke('files:list'),
  extList: () => ipcRenderer.invoke('ext:list'),
  extTheme: (file) => ipcRenderer.invoke('ext:theme', file),
  extSnippets: (file) => ipcRenderer.invoke('ext:snippets', file),
  extReadText: (file) => ipcRenderer.invoke('ext:readText', file),
  extReadJsonc: (file) => ipcRenderer.invoke('ext:readJsonc', file),
  extReadBinary: (file) => ipcRenderer.invoke('ext:readBinary', file),
  tmWasm: () => ipcRenderer.invoke('tm:wasm'),
  ws: {
    get: () => ipcRenderer.invoke('ws:get'),
    openFolder: () => ipcRenderer.invoke('ws:openFolder'),
    addFolder: () => ipcRenderer.invoke('ws:addFolder'),
    removeFolder: (dir) => ipcRenderer.invoke('ws:removeFolder', dir),
    setRoot: (dir) => ipcRenderer.invoke('ws:setRoot', dir),
    openFile: () => ipcRenderer.invoke('ws:openFile'),
    saveAs: (suggested) => ipcRenderer.invoke('ws:saveAs', suggested),
    readDir: (dir) => ipcRenderer.invoke('ws:readDir', dir),
    listFiles: () => ipcRenderer.invoke('ws:listFiles'),
    read: (file) => ipcRenderer.invoke('ws:read', file),
    write: (file, content) => ipcRenderer.invoke('ws:write', file, content),
    create: (target, isDir) => ipcRenderer.invoke('ws:create', target, isDir),
    rename: (from, to) => ipcRenderer.invoke('ws:rename', from, to),
    remove: (target) => ipcRenderer.invoke('ws:delete', target),
    copy: (from, to) => ipcRenderer.invoke('ws:copy', from, to),
    reveal: (target) => ipcRenderer.invoke('ws:reveal', target),
    realpath: (target) => ipcRenderer.invoke('ws:realpath', target),
    stat: (target) => ipcRenderer.invoke('ws:stat', target),
    search: (options) => ipcRenderer.invoke('ws:search', options),
    replace: (options, replacement, paths) => ipcRenderer.invoke('ws:replace', options, replacement, paths),
    onChanged: (callback) => listen('ws:changed', callback),
  },
  term: {
    create: (size) => ipcRenderer.invoke('term:create', size),
    list: () => ipcRenderer.invoke('term:list'),
    write: (id, data) => ipcRenderer.invoke('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('term:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('term:kill', id),
    onData: (callback) => listen('term:data', callback),
    onExit: (callback) => listen('term:exit', callback),
  },
  lsp: {
    start: (kind, cwd) => ipcRenderer.invoke('lsp:start', kind, cwd),
    send: (kind, body) => ipcRenderer.invoke('lsp:send', kind, body),
    stop: (kind) => ipcRenderer.invoke('lsp:stop', kind),
    fetch: (url) => ipcRenderer.invoke('lsp:fetch', url),
    onMessage: (callback) => listen('lsp:message', callback),
    onExit: (callback) => listen('lsp:exit', callback),
  },
  onMenu: (callback) => listen('menu', callback),
});

// Assina um canal do processo principal; devolve a função que cancela a assinatura.
function listen(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
