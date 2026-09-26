const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const {
  loadToken,
  clearToken,
  saveToken,
  hasValidToken,
  loadPlaylistCache,
  savePlaylistCache,
  getApiBase,
  saveApiBase,
  loadSavedApiBase,
  DEFAULT_API_BASE,
} = require("./config");
const api = require("./api");

const HEARTBEAT_MS = 60_000;
const PLAYLIST_MS = 30_000;
/** Ticket P.1 — drain remote-control queue. */
const INPUT_POLL_MS = 2_000;

/** ADNNABIT_KIOSK=0 always wins at start → windowed/debug. Anything else → kiosk. */
function wantKioskAtStart() {
  return process.env.ADNNABIT_KIOSK !== "0";
}

let mainWindow = null;
let heartbeatTimer = null;
let playlistTimer = null;
let inputTimer = null;
/** Runtime flag: may drop to false after Ctrl+Shift+Alt+Q (kiosk chrome only). */
let kioskActive = wantKioskAtStart();
/** True while showing first-run setup (never kiosk). */
let setupMode = false;
/** Ticket O — last playlistEpoch seen from API (heartbeat / playlist). */
let lastPlaylistEpoch = 0;

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
  // Tell renderer settings affordance can show
  mainWindow.webContents.send("player:kiosk-changed", { kiosk: false });
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

function stopLoops() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (playlistTimer) {
    clearInterval(playlistTimer);
    playlistTimer = null;
  }
  if (inputTimer) {
    clearInterval(inputTimer);
    inputTimer = null;
  }
}

function attachWindowGuards(win) {
  win.webContents.on("context-menu", (e) => {
    if (kioskActive) e.preventDefault();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (isBlockedShortcut(input)) event.preventDefault();
  });
}

function createWindow({ setup } = {}) {
  setupMode = !!setup;
  const startKiosk = !setupMode && wantKioskAtStart();
  kioskActive = startKiosk;

  mainWindow = new BrowserWindow({
    width: setupMode ? 520 : 1280,
    height: setupMode ? 640 : 720,
    backgroundColor: "#0B0F14",
    // Setup is always windowed/framed; player follows kiosk rules
    frame: setupMode || !startKiosk,
    autoHideMenuBar: true,
    fullscreen: !setupMode && (startKiosk || process.env.ADNNABIT_FULLSCREEN === "1"),
    kiosk: startKiosk,
    alwaysOnTop: startKiosk && process.env.ADNNABIT_ALWAYS_ON_TOP !== "0",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // DevTools off when starting in kiosk; allowed for setup / ADNNABIT_KIOSK=0
      devTools: setupMode || !startKiosk,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  attachWindowGuards(mainWindow);

  const page = setupMode
    ? path.join(__dirname, "renderer", "setup.html")
    : path.join(__dirname, "renderer", "index.html");
  mainWindow.loadFile(page);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (setupMode) {
    console.log("Setup mode — enter API URL + claim code (windowed)");
  } else if (!startKiosk) {
    console.log("ADNNABIT_KIOSK=0 — windowed/debug mode (DevTools allowed)");
  }
}

async function showPlayerAfterClaim() {
  stopLoops();
  setupMode = false;
  const startKiosk = wantKioskAtStart();
  kioskActive = startKiosk;

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ setup: false });
    startLoops();
    return;
  }

  // Cannot toggle `frame` after create — kiosk chrome covers setup's framed window
  applyKioskChrome(mainWindow, startKiosk);
  if (!startKiosk) {
    mainWindow.setSize(1280, 720);
    mainWindow.center();
  }
  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  startLoops();
}

async function showSetupScreen() {
  stopLoops();
  setupMode = true;
  kioskActive = false;

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ setup: true });
    return;
  }

  applyKioskChrome(mainWindow, false);
  mainWindow.setSize(520, 640);
  mainWindow.center();
  await mainWindow.loadFile(path.join(__dirname, "renderer", "setup.html"));
}

async function refreshPlaylist() {
  const creds = loadToken();
  if (!creds?.deviceToken) {
    mainWindow?.webContents.send("player:status", {
      error: "Not claimed — open setup or run npm run claim -- --code XXXXXX",
    });
    return;
  }
  try {
    const playlist = await api.getPlaylist(creds.deviceToken);
    if (typeof playlist.playlistEpoch === "number") {
      lastPlaylistEpoch = Math.max(lastPlaylistEpoch, playlist.playlistEpoch);
    }
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

/** Ticket P.1 — apply admin remote-control events to the kiosk BrowserWindow. */
function scaleRemotePoint(ev) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { x: Math.round(ev.x || 0), y: Math.round(ev.y || 0) };
  }
  const [cw, ch] = mainWindow.getContentSize();
  const capW = ev.captureWidth;
  const capH = ev.captureHeight;
  if (
    typeof capW === "number" &&
    capW > 0 &&
    typeof capH === "number" &&
    capH > 0 &&
    cw > 0 &&
    ch > 0
  ) {
    return {
      x: Math.round((ev.x / capW) * cw),
      y: Math.round((ev.y / capH) * ch),
    };
  }
  return { x: Math.round(ev.x || 0), y: Math.round(ev.y || 0) };
}

function applyRemoteInputEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn("remote input skipped — no BrowserWindow");
    return;
  }
  const wc = mainWindow.webContents;
  for (const ev of events) {
    try {
      if (!ev || typeof ev !== "object") continue;
      if (ev.type === "command") {
        if (ev.name === "exitKiosk") {
          console.log("remote command: exitKiosk");
          exitKioskChromeOnly();
        } else {
          console.log("remote command ignored:", ev.name);
        }
        continue;
      }
      if (
        ev.type === "mouseDown" ||
        ev.type === "mouseUp" ||
        ev.type === "mouseMove" ||
        ev.type === "mouseClick"
      ) {
        const { x, y } = scaleRemotePoint(ev);
        const button = ev.button || "left";
        const clickCount = ev.clickCount || 1;
        if (ev.type === "mouseClick") {
          wc.sendInputEvent({
            type: "mouseDown",
            x,
            y,
            button,
            clickCount,
          });
          wc.sendInputEvent({
            type: "mouseUp",
            x,
            y,
            button,
            clickCount,
          });
        } else {
          wc.sendInputEvent({
            type: ev.type,
            x,
            y,
            button,
            clickCount,
          });
        }
        continue;
      }
      if (ev.type === "keyDown" || ev.type === "keyUp" || ev.type === "char") {
        const payload = {
          type: ev.type,
          keyCode: String(ev.keyCode || ""),
        };
        if (Array.isArray(ev.modifiers) && ev.modifiers.length) {
          payload.modifiers = ev.modifiers;
        }
        wc.sendInputEvent(payload);
        continue;
      }
      console.warn("remote input unknown type", ev.type);
    } catch (e) {
      console.warn("remote input apply failed", e.message);
    }
  }
  console.log(`remote input applied ${events.length} event(s)`);
}

async function pollRemoteInput() {
  const creds = loadToken();
  if (!creds?.deviceToken) return;
  try {
    const res = await api.pollInput(creds.deviceToken);
    const events = res?.events;
    if (Array.isArray(events) && events.length > 0) {
      applyRemoteInputEvents(events);
    }
  } catch (e) {
    console.warn("input poll failed", e.message);
  }
}

/** Ticket P — capture BrowserWindow to JPEG and POST /api/device/screenshot. */
async function captureAndUploadScreenshot(token) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn("screenshot skipped — no BrowserWindow");
    return;
  }
  try {
    const image = await mainWindow.webContents.capturePage();
    const jpeg = image.toJPEG(70);
    if (!jpeg || jpeg.length === 0) {
      console.warn("screenshot skipped — empty capture");
      return;
    }
    const result = await api.postScreenshot(token, jpeg);
    console.log(
      `screenshot uploaded ${result?.bytes || jpeg.length}B epoch=${result?.screenshotCapturedEpoch}`
    );
  } catch (e) {
    console.warn("screenshot capture/upload failed", e.message);
  }
}

async function doHeartbeat() {
  const creds = loadToken();
  if (!creds?.deviceToken) return;
  try {
    const hb = await api.heartbeat(creds.deviceToken);
    // Ticket O — server bumped playlistEpoch → re-fetch immediately (poll interval unchanged)
    const epoch = hb?.playlistEpoch;
    if (typeof epoch === "number" && epoch > lastPlaylistEpoch) {
      console.log(
        `heartbeat playlistEpoch ${lastPlaylistEpoch} → ${epoch}; refreshing playlist`
      );
      await refreshPlaylist();
    }
    // Ticket P — admin remote-view request (epoch-style via commands.captureScreenshot)
    if (hb?.commands?.captureScreenshot) {
      console.log(
        `heartbeat captureScreenshot (screenshotEpoch=${hb.screenshotEpoch}); capturing`
      );
      await captureAndUploadScreenshot(creds.deviceToken);
    }
    // Ticket P.1 — drain input if heartbeat says queue non-empty (poll loop is primary)
    if (hb?.commands?.inputPending) {
      await pollRemoteInput();
    }
  } catch (e) {
    console.warn("heartbeat failed", e.message);
  }
}

function startLoops() {
  refreshPlaylist();
  doHeartbeat();
  void pollRemoteInput();
  playlistTimer = setInterval(refreshPlaylist, PLAYLIST_MS);
  heartbeatTimer = setInterval(doHeartbeat, HEARTBEAT_MS);
  inputTimer = setInterval(() => {
    void pollRemoteInput();
  }, INPUT_POLL_MS);
}

function friendlyClaimError(err) {
  const status = err?.status;
  const msg = (err?.message || "").toLowerCase();
  if (
    err?.cause?.code === "ECONNREFUSED" ||
    err?.code === "ECONNREFUSED" ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("network")
  ) {
    return `Unreachable API at ${getApiBase()}. Check the URL and that AdNabbit web is running.`;
  }
  if (status === 400 || status === 404 || status === 410 || msg.includes("invalid") || msg.includes("expired") || msg.includes("code")) {
    return err.message || "Invalid or expired claim code.";
  }
  if (status === 401 || status === 403) {
    return err.message || "Claim rejected by API.";
  }
  return err?.message || "Claim failed";
}

app.whenReady().then(() => {
  if (hasValidToken()) {
    createWindow({ setup: false });
    startLoops();
  } else {
    createWindow({ setup: true });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (hasValidToken()) {
        createWindow({ setup: false });
        startLoops();
      } else {
        createWindow({ setup: true });
      }
    }
  });
});

app.on("window-all-closed", () => {
  stopLoops();
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
    canClearPairing: !kioskActive || process.env.ADNNABIT_KIOSK === "0",
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

ipcMain.handle("setup:get-state", () => {
  const creds = loadToken();
  return {
    paired: hasValidToken(),
    apiBase: getApiBase(),
    savedApiBase: loadSavedApiBase(),
    defaultApiBase: DEFAULT_API_BASE,
    screenName: creds?.screenName || null,
    hostName: creds?.hostName || null,
    kiosk: kioskActive,
  };
});

ipcMain.handle("setup:save-api-base", (_e, url) => {
  try {
    const saved = saveApiBase(url);
    return { ok: true, apiBase: saved };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("setup:claim", async (_e, payload = {}) => {
  const codeRaw = String(payload.code || "").trim();
  const apiBaseRaw = payload.apiBase != null ? String(payload.apiBase).trim() : null;

  if (!codeRaw) {
    return { error: "Enter the claim code." };
  }

  try {
    if (apiBaseRaw) {
      saveApiBase(apiBaseRaw);
    }
  } catch (err) {
    return { error: err.message };
  }

  try {
    console.log(`Claiming against ${getApiBase()} …`);
    const result = await api.claim(codeRaw.toUpperCase());
    const tokenPayload = {
      deviceToken: result.deviceToken,
      screenId: result.screenId,
      screenName: result.screenName,
      hostName: result.hostName,
      timezone: result.timezone,
      claimedAt: new Date().toISOString(),
      apiBase: getApiBase(),
    };
    saveToken(tokenPayload);
    // Transition after a short beat so setup UI can show success
    setTimeout(() => {
      showPlayerAfterClaim().catch((e) =>
        console.error("transition to player failed", e)
      );
    }, 600);
    return {
      ok: true,
      screenName: result.screenName,
      hostName: result.hostName,
      screenId: result.screenId,
    };
  } catch (err) {
    console.warn("claim failed", err.message);
    return { error: friendlyClaimError(err) };
  }
});

ipcMain.handle("setup:get-status", () => {
  const creds = loadToken();
  return {
    paired: hasValidToken(),
    apiBase: getApiBase(),
    screenName: creds?.screenName || null,
    hostName: creds?.hostName || null,
    kiosk: kioskActive,
    setupMode,
  };
});

ipcMain.handle("setup:clear-pairing", async () => {
  // Allow clear when not in kiosk, or when explicitly windowed via env
  if (kioskActive && process.env.ADNNABIT_KIOSK !== "0") {
    return {
      error:
        "Exit kiosk first (Ctrl+Shift+Alt+Q) or start with ADNNABIT_KIOSK=0 to clear pairing.",
    };
  }
  clearToken();
  lastPlaylistEpoch = 0;
  await showSetupScreen();
  return { ok: true };
});
