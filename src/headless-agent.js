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

  const hb = await api.heartbeat(creds.deviceToken, {
    playerVersion: (() => {
      try { return require("../package.json").version; } catch { return undefined; }
    })(),
  });
  console.log("heartbeat", hb);
  if (typeof hb.downloadAllowed === "boolean") {
    console.log(`Ticket U heartbeat downloadAllowed=${hb.downloadAllowed}`);
  }
  if (hb?.hours) {
    console.log(
      `Ticket Q hours: isOpenNow=${hb.hours.isOpenNow} reason=${hb.hours.reason} tz=${hb.hours.timezone}`
    );
  }
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

  // Ticket P.1 / P.1.2 — drain remote-control queue (log only; no BrowserWindow)
  try {
    const input = await api.pollInput(creds.deviceToken);
    const events = input?.events || [];
    const n = events.length;
    console.log(`input poll: ${n} event(s)`, n ? events : "");
    for (const ev of events) {
      if (ev?.type === "command" && ev.name === "reboot") {
        console.log(
          "[dry-run] reboot command received — would schedule clean quit + adnabbit-reboot helper (skipped in headless)"
        );
      } else if (ev?.type === "command" && ev.name === "restartApp") {
        console.log(
          "[dry-run] restartApp command received — would app.relaunch() (skipped in headless)"
        );
      }
    }
  } catch (e) {
    console.warn("input poll failed", e.message);
  }

  const playlist = await api.getPlaylist(creds.deviceToken);
  console.log(`playlist items: ${playlist.items?.length || 0}`);
  if (playlist.hours) {
    console.log(
      `Ticket Q playlist hours: isOpenNow=${playlist.hours.isOpenNow} alwaysOpen=${playlist.hours.alwaysOpen}`
    );
  }
  if (typeof playlist.playlistEpoch === "number") {
    console.log(`playlistEpoch: ${playlist.playlistEpoch}`);
  }

  const samplePath = path.join(dataDir, "playlist-sample.json");
  fs.writeFileSync(samplePath, JSON.stringify(playlist, null, 2));
  console.log("wrote", samplePath);

  const downloadAllowed =
    playlist.downloadAllowed !== false &&
    playlist.downloadHours?.downloadAllowed !== false;
  console.log(
    `Ticket U downloadAllowed=${downloadAllowed} reason=${playlist.downloadHours?.reason || "n/a"}`
  );
  let deferred = 0;
  for (const item of playlist.items || []) {
    try {
      const existing = api.resolveCachedAsset(item);
      if (existing) {
        console.log(`cache hit ${item.creativeName} → ${existing}`);
        continue;
      }
      if (!downloadAllowed) {
        deferred += 1;
        console.log(
          `download quiet hours — deferring ${item.creativeId} (${item.creativeName})`
        );
        continue;
      }
      const local = await api.cacheAsset(creds.deviceToken, item);
      console.log(`cached ${item.creativeName} → ${local}`);
    } catch (e) {
      console.warn(`cache fail ${item.creativeId}: ${e.message}`);
    }
  }
  if (deferred > 0) {
    console.log(`Ticket U deferred ${deferred} new download(s)`);
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
