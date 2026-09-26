#!/usr/bin/env node
/**
 * Headless smoke agent — claim/heartbeat/playlist/cache without Electron GUI.
 */
const fs = require("fs");
const path = require("path");
const {
  loadToken,
  savePlaylistCache,
  getApiBase,
  dataDir,
} = require("./config");
const api = require("./api");

async function main() {
  const creds = loadToken();
  if (!creds?.deviceToken) {
    console.error("No device token. Run: npm run claim -- --code XXXXXX");
    process.exit(1);
  }
  console.log(`API ${getApiBase()}`);
  console.log(`Screen ${creds.screenName} (${creds.screenId})`);

  const hb = await api.heartbeat(creds.deviceToken);
  console.log("heartbeat", hb);
  if (typeof hb?.playlistEpoch === "number") {
    console.log(`playlistEpoch: ${hb.playlistEpoch}`);
  }
  if (hb?.commands?.captureScreenshot) {
    // Soft miss / headless: no BrowserWindow — skip capture gracefully
    console.log(
      `captureScreenshot requested (screenshotEpoch=${hb.screenshotEpoch}) — skipped in headless (no BrowserWindow)`
    );
  }
  if (hb?.commands?.inputPending) {
    console.log("inputPending signaled on heartbeat");
  }

  // Ticket P.1 — drain remote-control queue (log only; no BrowserWindow to apply)
  try {
    const input = await api.pollInput(creds.deviceToken);
    const n = input?.events?.length || 0;
    console.log(`input poll: ${n} event(s)`, n ? input.events : "");
  } catch (e) {
    console.warn("input poll failed", e.message);
  }

  const playlist = await api.getPlaylist(creds.deviceToken);
  console.log(`playlist items: ${playlist.items?.length || 0}`);
  if (typeof playlist.playlistEpoch === "number") {
    console.log(`playlistEpoch: ${playlist.playlistEpoch}`);
  }

  const samplePath = path.join(dataDir, "playlist-sample.json");
  fs.writeFileSync(samplePath, JSON.stringify(playlist, null, 2));
  console.log("wrote", samplePath);

  for (const item of playlist.items || []) {
    try {
      const local = await api.cacheAsset(creds.deviceToken, item);
      console.log(`cached ${item.creativeName} → ${local}`);
    } catch (e) {
      console.warn(`cache fail ${item.creativeId}: ${e.message}`);
    }
  }

  savePlaylistCache({ ...playlist, cachedAt: new Date().toISOString() });

  const logs = await api.postPlayLogs(creds.deviceToken, [
    {
      creativeId: playlist.items?.[0]?.creativeId,
      playedAt: new Date().toISOString(),
      stub: true,
    },
  ]);
  console.log("play-logs", logs);
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
