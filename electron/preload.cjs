'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  debug: Boolean(process.env.OBNOTION_SHOT),
  startNote: process.env.OBNOTION_OPEN || null,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  getVault: () => ipcRenderer.invoke('vault:get'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
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
  filesList: () => ipcRenderer.invoke('files:list'),
  extList: () => ipcRenderer.invoke('ext:list'),
  extTheme: (file) => ipcRenderer.invoke('ext:theme', file),
  extSnippets: (file) => ipcRenderer.invoke('ext:snippets', file),
  onMenu: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
});
