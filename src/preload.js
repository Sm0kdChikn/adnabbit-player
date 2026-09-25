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
  playLog: (event) => ipcRenderer.invoke("player:play-log", event),
});
