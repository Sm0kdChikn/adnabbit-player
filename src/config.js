const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME_DIR = path.join(os.homedir(), ".adnabbit-player");
const LOCAL_DIR = path.join(__dirname, "..", "data");

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
const playlistCachePath = path.join(dataDir, "playlist-cache.json");
const assetCacheDir = ensureDir(path.join(dataDir, "assets"));

function getApiBase() {
  return (
    process.env.ADNNABIT_API_BASE ||
    process.env.ADNABBIT_API_BASE ||
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
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

module.exports = {
  dataDir,
  tokenPath,
  playlistCachePath,
  assetCacheDir,
  getApiBase,
  loadToken,
  saveToken,
  loadPlaylistCache,
  savePlaylistCache,
};
