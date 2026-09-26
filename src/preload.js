const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adnabbit", {
  getBootstrap: () => ipcRenderer.invoke("player:get-bootstrap"),
  onPlaylist: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("player:playlist", handler);
    return () => ipcRenderer.removeListener("player:playlist", handler);
  },
  onStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("player:status", handler);
    return () => ipcRenderer.removeListener("player:status", handler);
  },
  onKioskChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("player:kiosk-changed", handler);
    return () => ipcRenderer.removeListener("player:kiosk-changed", handler);
  },
  playLog: (event) => ipcRenderer.invoke("player:play-log", event),

  // Setup / pairing IPC (Ticket N)
  getSetupState: () => ipcRenderer.invoke("setup:get-state"),
  saveApiBase: (url) => ipcRenderer.invoke("setup:save-api-base", url),
  claimWithCode: (payload) => ipcRenderer.invoke("setup:claim", payload),
  getStatus: () => ipcRenderer.invoke("setup:get-status"),
  clearPairing: () => ipcRenderer.invoke("setup:clear-pairing"),
});
