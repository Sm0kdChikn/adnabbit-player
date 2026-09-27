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
  /** Ticket Q — open-hours payload pushed from heartbeat */
  onHours: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("player:hours", handler);
    return () => ipcRenderer.removeListener("player:hours", handler);
  },
  /** Ticket X — maintenance soft blackout (beats force-live) */
  onMaintenance: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("player:maintenance", handler);
    return () => ipcRenderer.removeListener("player:maintenance", handler);
  },
  playLog: (event) => ipcRenderer.invoke("player:play-log", event),
  /** Ticket Q/X — report LIVE | BLACKOUT | MAINTENANCE | IDLE | EMPTY */
  setPlaybackState: (state) =>
    ipcRenderer.invoke("player:set-playback-state", state),

  // Setup / pairing IPC (Ticket N)
  getSetupState: () => ipcRenderer.invoke("setup:get-state"),
  saveApiBase: (url) => ipcRenderer.invoke("setup:save-api-base", url),
  claimWithCode: (payload) => ipcRenderer.invoke("setup:claim", payload),
  getStatus: () => ipcRenderer.invoke("setup:get-status"),
  clearPairing: () => ipcRenderer.invoke("setup:clear-pairing"),
});
