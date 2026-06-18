'use strict';

/**
 * Preload bridge — exposes a curated, minimal `window.api` to the renderer.
 * The page has no Node access (contextIsolation + sandbox); it can only call
 * these channels. webUtils.getPathForFile (Electron ≥ 32) recovers a dropped
 * file's real path so the engine loads it directly (relative assets resolve).
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseFile: () => ipcRenderer.invoke('h2p:choose-file'),
  detect: (req) => ipcRenderer.invoke('h2p:detect', req),
  convert: (req) => ipcRenderer.invoke('h2p:convert', req),
  open: (path) => ipcRenderer.invoke('h2p:open', { path }),
  reveal: (path) => ipcRenderer.invoke('h2p:reveal', { path }),
  discard: (path) => ipcRenderer.invoke('h2p:discard', { path }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    close: () => ipcRenderer.invoke('win:close'),
  },
});
