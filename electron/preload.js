'use strict';

/**
 * Preload bridge — exposes a curated, minimal `window.api` to the renderer.
 * The page has no Node access (contextIsolation + sandbox); it can only call
 * these channels. webUtils.getPathForFile (Electron ≥ 32) recovers a dropped
 * file's real path so the engine loads it directly (relative assets resolve).
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Main passes engine errors back as a tagged RESOLVED value (IPC mangles rejected
// plain objects into "[object Object]"). Re-throw it here, in the renderer, so the
// UI's catch sees a real Error with the original message/code/candidates.
const unwrapError = (r) => {
  if (r && r.__error) {
    const e = new Error(r.message);
    if (r.code) e.code = r.code;
    if (r.candidates) e.candidates = r.candidates;
    throw e;
  }
  return r;
};

contextBridge.exposeInMainWorld('api', {
  chooseFile: () => ipcRenderer.invoke('h2p:choose-file'),
  detect: (req) => ipcRenderer.invoke('h2p:detect', req).then(unwrapError),
  convert: (req) => ipcRenderer.invoke('h2p:convert', req).then(unwrapError),
  open: (path) => ipcRenderer.invoke('h2p:open', { path }),
  reveal: (path) => ipcRenderer.invoke('h2p:reveal', { path }),
  discard: (path) => ipcRenderer.invoke('h2p:discard', { path }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    close: () => ipcRenderer.invoke('win:close'),
  },
});
