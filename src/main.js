const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
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
  loadKioskPreference,
  saveKioskPreference,
} = require("./config");
const api = require("./api");
const { evaluateHours } = require("./open-hours");

/** Ticket R — report package version on heartbeat. */
function getPlayerVersion() {
  try {
    return require("../package.json").version || null;
  } catch {
    try {
      return app.getVersion?.() || null;
    } catch {
      return null;
    }
  }
}
const PLAYER_VERSION = getPlayerVersion();

const HEARTBEAT_MS = 60_000;
const PLAYLIST_MS = 30_000;
/** Ticket P.1 — drain remote-control queue. */
const INPUT_POLL_MS = 2_000;

/**
 * Start-up kiosk decision:
 * - ADNNABIT_KIOSK=0 always wins → windowed/debug
 * - else ~/.adnabbit-player/preferences.json kiosk flag if set (Ticket P.1.1)
 * - else default locked (kiosk on)
 */
function wantKioskAtStart() {
  if (process.env.ADNNABIT_KIOSK === "0") return false;
  const pref = loadKioskPreference();
  if (pref !== null) return pref;
  return true;
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
/** Ticket Q — last renderer-reported playback state for heartbeat body. */
let lastPlaybackState = "IDLE";
/** Ticket Q — cached open-hours from playlist/heartbeat (PoP mute guard). */
let lastHours = null;
/** Ticket P.1.3 — branded splash until setup/playback window is ready. */
let splashWindow = null;
/** Ticket P.1.2 — prevent double-scheduling reboot/restart. */
let powerActionScheduled = false;

const REBOOT_HELPER_CANDIDATES = [
  process.env.ADNNABIT_REBOOT_HELPER,
  "/usr/local/sbin/adnabbit-reboot",
  "/usr/local/bin/adnabbit-reboot",
  path.join(__dirname, "..", "packaging", "adnabbit-reboot"),
].filter(Boolean);

function resolveRebootHelper() {
  for (const candidate of REBOOT_HELPER_CANDIDATES) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function showSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#0B0F14",
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.loadFile(path.join(__dirname, "renderer", "splash.html"));
  splashWindow.center();
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try {
      splashWindow.close();
    } catch {
      /* ignore */
    }
  }
  splashWindow = null;
}

/**
 * Ticket P.1.2 — clean quit, then OS reboot via adnabbit-reboot helper.
 * Set ADNNABIT_REBOOT_DRY_RUN=1 to log + quit without rebooting (smoke-safe).
 */
function scheduleDeviceReboot() {
  if (powerActionScheduled) {
    console.log("reboot already scheduled — ignoring duplicate");
    return;
  }
  powerActionScheduled = true;
  const dry = process.env.ADNNABIT_REBOOT_DRY_RUN === "1";
  console.log(
    `remote command: reboot — scheduling clean quit then OS reboot` +
      (dry ? " (ADNNABIT_REBOOT_DRY_RUN=1)" : "")
  );
  stopLoops();
  setTimeout(() => {
    if (dry) {
      console.log(
        "[dry-run] would invoke adnabbit-reboot helper; quitting without reboot"
      );
      app.quit();
      return;
    }
    const helper = resolveRebootHelper();
    if (!helper) {
      console.error(
        "reboot aborted — adnabbit-reboot helper not found. " +
          "Install via scripts/install-autostart.sh (sudoers/polkit required)."
      );
      powerActionScheduled = false;
      return;
    }
    console.log(`invoking reboot helper: ${helper}`);
    const useSudo = !helper.includes("packaging") && process.getuid?.() !== 0;
    const cmd = useSudo ? "sudo" : helper;
    const args = useSudo ? ["-n", helper] : [];
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
    } catch (e) {
      console.error("failed to spawn reboot helper:", e.message);
      powerActionScheduled = false;
      return;
    }
    // Give the helper a moment to start, then quit Electron
    setTimeout(() => app.quit(), 400);
  }, 600);
}

/** Ticket P.1.2 secondary — relaunch Electron process only (no OS reboot). */
function scheduleAppRestart() {
  if (powerActionScheduled) {
    console.log("power action already scheduled — ignoring restartApp");
    return;
  }
  powerActionScheduled = true;
  console.log("remote command: restartApp — relaunching Electron process");
  stopLoops();
  setTimeout(() => {
    app.relaunch();
    app.quit();
  }, 400);
}

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

/**
 * Ticket P.1.1 — enable/disable Electron kiosk chrome at runtime.
 * When unlocked: windowed, not always-on-top, Escape/shortcuts allowed.
 * When locked: restore kiosk + fullscreen. Persists to preferences.json.
 */
function setKioskMode(enabled, { persist = true, reason = "" } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn("setKioskMode skipped — no BrowserWindow");
    return;
  }
  if (setupMode) {
    console.log("setKioskMode ignored during setup");
    return;
  }
  const next = !!enabled;
  if (kioskActive === next) {
    if (persist) saveKioskPreference(next);
    console.log(
      `Kiosk already ${next ? "locked" : "unlocked"}${reason ? ` (${reason})` : ""}`
    );
    return;
  }
  kioskActive = next;
  applyKioskChrome(mainWindow, next);
  if (!next) {
    // Ensure a usable windowed size when leaving fullscreen/kiosk
    try {
      mainWindow.setSize(1280, 720);
      mainWindow.center();
    } catch {
      /* ignore */
    }
  }
  if (persist) saveKioskPreference(next);
  mainWindow.webContents.send("player:kiosk-changed", { kiosk: next });
  console.log(
    `Kiosk ${next ? "locked" : "unlocked"}${reason ? ` (${reason})` : ""}. ` +
      (next
        ? "Fullscreen lockdown restored."
        : "Windowed — use desktop around the player; app still running.")
  );
}

function exitKioskChromeOnly() {
  setKioskMode(false, { reason: "Ctrl+Shift+Alt+Q / exitKiosk" });
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
    // Hold until ready-to-show so splash covers cold start (P.1.3)
    show: false,
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

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    closeSplash();
  });

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
    if (playlist.hours) {
      lastHours = playlist.hours;
      mainWindow?.webContents.send("player:hours", playlist.hours);
    }
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
        if (ev.name === "exitKiosk" || ev.name === "disableKiosk") {
          console.log(`remote command: ${ev.name}`);
          setKioskMode(false, { reason: ev.name });
        } else if (ev.name === "enableKiosk") {
          console.log("remote command: enableKiosk");
          setKioskMode(true, { reason: "enableKiosk" });
        } else if (ev.name === "setKiosk") {
          const on = !!ev.enabled;
          console.log(`remote command: setKiosk enabled=${on}`);
          setKioskMode(on, { reason: "setKiosk" });
        } else if (ev.name === "reboot") {
          scheduleDeviceReboot();
        } else if (ev.name === "restartApp") {
          scheduleAppRestart();
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
    const hb = await api.heartbeat(creds.deviceToken, {
      playbackState: lastPlaybackState,
      // Ticket R — surface version on fleet board (disk stats soft-miss / TODO)
      ...(PLAYER_VERSION ? { playerVersion: PLAYER_VERSION } : {}),
    });
    // Ticket Q — refresh local hours cache from heartbeat
    if (hb?.hours) {
      lastHours = hb.hours;
      mainWindow?.webContents.send("player:hours", hb.hours);
    }
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
  showSplash();
  if (hasValidToken()) {
    createWindow({ setup: false });
    startLoops();
  } else {
    // Unpaired → setup/claim GUI (P.1.3)
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
  if (cached?.hours) lastHours = cached.hours;
  return {
    claimed: !!creds?.deviceToken,
    screenName: creds?.screenName || cached?.screenName || null,
    hostName: creds?.hostName || cached?.hostName || null,
    apiBase: getApiBase(),
    playlist: cached,
    hours: lastHours || cached?.hours || null,
    kiosk: kioskActive,
    canClearPairing: !kioskActive || process.env.ADNNABIT_KIOSK === "0",
  };
});

ipcMain.handle("player:set-playback-state", (_e, state) => {
  const s = String(state || "").toUpperCase();
  if (["LIVE", "BLACKOUT", "IDLE", "EMPTY"].includes(s)) {
    lastPlaybackState = s;
  }
  return { ok: true, playbackState: lastPlaybackState };
});

ipcMain.handle("player:play-log", async (_e, event) => {
  const creds = loadToken();
  if (!creds?.deviceToken) return { skipped: true };
  // Ticket Q — never emit PoP while outside open hours (soft blackout)
  const open = evaluateHours(lastHours);
  if (!open.isOpen || lastPlaybackState === "BLACKOUT") {
    console.log("play-log muted — closed hours / blackout");
    return { skipped: true, reason: "blackout" };
  }
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
