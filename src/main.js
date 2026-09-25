const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const {
  loadToken,
  loadPlaylistCache,
  savePlaylistCache,
  getApiBase,
} = require("./config");
const api = require("./api");

const HEARTBEAT_MS = 60_000;
const PLAYLIST_MS = 30_000;

let mainWindow = null;
let heartbeatTimer = null;
let playlistTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0B0F14",
    autoHideMenuBar: true,
    fullscreen: process.env.ADNNABIT_FULLSCREEN === "1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function refreshPlaylist() {
  const creds = loadToken();
  if (!creds?.deviceToken) {
    mainWindow?.webContents.send("player:status", {
      error: "Not claimed — run npm run claim -- --code XXXXXX",
    });
    return;
  }
  try {
    const playlist = await api.getPlaylist(creds.deviceToken);
    // Cache assets locally and rewrite URLs to file://
    const items = [];
    for (const item of playlist.items || []) {
      try {
        const localPath = await api.cacheAsset(creds.deviceToken, item);
        items.push({
          ...item,
          localUrl: `file://${localPath}`,
        });
      } catch (e) {
        console.warn("asset cache failed", item.creativeId, e.message);
        items.push({ ...item, localUrl: null });
      }
    }
    const enriched = { ...playlist, items, cachedAt: new Date().toISOString() };
    savePlaylistCache(enriched);
    mainWindow?.webContents.send("player:playlist", enriched);
    mainWindow?.webContents.send("player:status", {
      ok: true,
      screenName: playlist.screenName,
      hostName: playlist.hostName,
      itemCount: items.length,
      apiBase: getApiBase(),
    });
  } catch (e) {
    console.warn("playlist poll failed, using cache", e.message);
    const cached = loadPlaylistCache();
    if (cached) {
      mainWindow?.webContents.send("player:playlist", {
        ...cached,
        offline: true,
      });
      mainWindow?.webContents.send("player:status", {
        ok: true,
        offline: true,
        screenName: cached.screenName,
        itemCount: (cached.items || []).length,
        warning: e.message,
      });
    } else {
      mainWindow?.webContents.send("player:status", { error: e.message });
    }
  }
}

async function doHeartbeat() {
  const creds = loadToken();
  if (!creds?.deviceToken) return;
  try {
    await api.heartbeat(creds.deviceToken);
  } catch (e) {
    console.warn("heartbeat failed", e.message);
  }
}

function startLoops() {
  refreshPlaylist();
  doHeartbeat();
  playlistTimer = setInterval(refreshPlaylist, PLAYLIST_MS);
  heartbeatTimer = setInterval(doHeartbeat, HEARTBEAT_MS);
}

app.whenReady().then(() => {
  createWindow();
  startLoops();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (playlistTimer) clearInterval(playlistTimer);
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("player:get-bootstrap", () => {
  const creds = loadToken();
  const cached = loadPlaylistCache();
  return {
    claimed: !!creds?.deviceToken,
    screenName: creds?.screenName || cached?.screenName || null,
    hostName: creds?.hostName || cached?.hostName || null,
    apiBase: getApiBase(),
    playlist: cached,
  };
});

ipcMain.handle("player:play-log", async (_e, event) => {
  const creds = loadToken();
  if (!creds?.deviceToken) return { skipped: true };
  try {
    return await api.postPlayLogs(creds.deviceToken, [event]);
  } catch (err) {
    return { error: err.message };
  }
});
