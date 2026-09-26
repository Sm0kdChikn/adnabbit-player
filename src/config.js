const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME_DIR = path.join(os.homedir(), ".adnabbit-player");
const LOCAL_DIR = path.join(__dirname, "..", "data");
const DEFAULT_API_BASE = "http://127.0.0.1:3000";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveDataDir() {
  // Prefer ~/.adnabbit-player; fall back to ./data for portable/dev
  try {
    return ensureDir(HOME_DIR);
  } catch {
    return ensureDir(LOCAL_DIR);
  }
}

const dataDir = resolveDataDir();
const tokenPath = path.join(dataDir, "device-token.json");
const apiBasePath = path.join(dataDir, "api-base.json");
const playlistCachePath = path.join(dataDir, "playlist-cache.json");
const prefsPath = path.join(dataDir, "preferences.json");
const assetCacheDir = ensureDir(path.join(dataDir, "assets"));

function loadSavedApiBase() {
  if (!fs.existsSync(apiBasePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(apiBasePath, "utf8"));
    const raw = data?.apiBase ?? data?.url;
    if (typeof raw !== "string" || !raw.trim()) return null;
    return raw.trim().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function saveApiBase(url) {
  ensureDir(dataDir);
  const cleaned = String(url || "")
    .trim()
    .replace(/\/$/, "");
  if (!cleaned) {
    throw new Error("API base URL is required");
  }
  fs.writeFileSync(
    apiBasePath,
    JSON.stringify({ apiBase: cleaned, savedAt: new Date().toISOString() }, null, 2)
  );
  return cleaned;
}

/**
 * Resolve API origin: env → saved api-base.json → default localhost.
 */
function getApiBase() {
  const fromEnv =
    process.env.ADNNABIT_API_BASE || process.env.ADNABBIT_API_BASE || null;
  const raw = fromEnv || loadSavedApiBase() || DEFAULT_API_BASE;
  return String(raw).replace(/\/$/, "");
}

function loadToken() {
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  } catch {
    return null;
  }
}

function saveToken(payload) {
  ensureDir(dataDir);
  fs.writeFileSync(tokenPath, JSON.stringify(payload, null, 2));
}

function clearToken() {
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}

function hasValidToken() {
  const creds = loadToken();
  return !!(creds && typeof creds.deviceToken === "string" && creds.deviceToken);
}

function loadPlaylistCache() {
  if (!fs.existsSync(playlistCachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(playlistCachePath, "utf8"));
  } catch {
    return null;
  }
}

function savePlaylistCache(playlist) {
  fs.writeFileSync(playlistCachePath, JSON.stringify(playlist, null, 2));
}

/**
 * Ticket P.1.1 — persisted kiosk preference (null = no preference / default on).
 * ADNNABIT_KIOSK=0 at process start still wins over this file.
 */
function loadKioskPreference() {
  if (!fs.existsSync(prefsPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    if (typeof data?.kiosk === "boolean") return data.kiosk;
    return null;
  } catch {
    return null;
  }
}

function saveKioskPreference(kiosk) {
  ensureDir(dataDir);
  let existing = {};
  if (fs.existsSync(prefsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(prefsPath, "utf8")) || {};
    } catch {
      existing = {};
    }
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    existing = {};
  }
  existing.kiosk = !!kiosk;
  existing.updatedAt = new Date().toISOString();
  fs.writeFileSync(prefsPath, JSON.stringify(existing, null, 2));
  return existing.kiosk;
}

module.exports = {
  dataDir,
  tokenPath,
  apiBasePath,
  playlistCachePath,
  assetCacheDir,
  DEFAULT_API_BASE,
  getApiBase,
  loadSavedApiBase,
  saveApiBase,
  loadToken,
  saveToken,
  clearToken,
  hasValidToken,
  loadPlaylistCache,
  savePlaylistCache,
  prefsPath,
  loadKioskPreference,
  saveKioskPreference,
};
