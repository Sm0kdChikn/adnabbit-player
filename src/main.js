const { app, BrowserWindow, ipcMain, Menu } = require("electron");
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

/** ADNNABIT_KIOSK=0 always wins at start → windowed/debug. Anything else → kiosk. */
function wantKioskAtStart() {
  return process.env.ADNNABIT_KIOSK !== "0";
}

let mainWindow = null;
let heartbeatTimer = null;
let playlistTimer = null;
/** Runtime flag: may drop to false after Ctrl+Shift+Alt+Q (kiosk chrome only). */
let kioskActive = wantKioskAtStart();

function applyKioskChrome(win, enabled) {
  if (!win || win.isDestroyed()) return;
  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);
  if (enabled) {
    win.setAlwaysOnTop(process.env.ADNNABIT_ALWAYS_ON_TOP !== "0");
    win.setKiosk(true);
    win.setFullScreen(true);
  } else {
    win.setAlwaysOnTop(false);
    win.setKiosk(false);
    win.setFullScreen(false);
    win.setSize(1280, 720);
    win.center();
  }
}

function exitKioskChromeOnly() {
  if (!kioskActive || !mainWindow || mainWindow.isDestroyed()) return;
  kioskActive = false;
  applyKioskChrome(mainWindow, false);
  console.log(
    "Kiosk chrome exited (Ctrl+Shift+Alt+Q). Windowed/debug mode — app still running (not an OS logout)."
  );
}

function isBlockedShortcut(input) {
  if (input.type !== "keyDown") return false;
  const key = (input.key || "").toLowerCase();
  const code = input.code || "";

  // Escape hatch: leave Electron kiosk chrome only (does not quit app or touch OS)
  if (
    input.control &&
    input.shift &&
    input.alt &&
    (key === "q" || code === "KeyQ")
  ) {
    exitKioskChromeOnly();
    return true;
  }

  if (!kioskActive) return false;

  // Close / quit style (Electron-level; OS may still honor Alt+F4 outside our control)
  if (input.control && !input.alt && (key === "w" || code === "KeyW")) return true;
  if (input.control && !input.alt && (key === "q" || code === "KeyQ")) return true;
  if (input.alt && (key === "f4" || code === "F4")) return true;

  // DevTools
  if (key === "f12" || code === "F12") return true;
  if (
    input.control &&
    input.shift &&
    (key === "i" ||
      key === "j" ||
      key === "c" ||
      code === "KeyI" ||
      code === "KeyJ" ||
      code === "KeyC")
  ) {
    return true;
  }
  if (input.control && (key === "u" || code === "KeyU")) return true;

  // Reload
  if (key === "f5" || code === "F5") return true;
  if (input.control && (key === "r" || code === "KeyR")) return true;

  return false;
}

function createWindow() {
  const startKiosk = wantKioskAtStart();
  kioskActive = startKiosk;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0B0F14",
    frame: !startKiosk,
    autoHideMenuBar: true,
    fullscreen: startKiosk || process.env.ADNNABIT_FULLSCREEN === "1",
    kiosk: startKiosk,
    alwaysOnTop: startKiosk && process.env.ADNNABIT_ALWAYS_ON_TOP !== "0",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // DevTools off when starting in kiosk; allowed when ADNNABIT_KIOSK=0
      devTools: !startKiosk,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on("context-menu", (e) => {
    if (kioskActive) e.preventDefault();
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (isBlockedShortcut(input)) event.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!startKiosk) {
    console.log("ADNNABIT_KIOSK=0 — windowed/debug mode (DevTools allowed)");
  }
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
    kiosk: kioskActive,
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
