(() => {
  const video = document.getElementById("video");
  const image = document.getElementById("image");
  const idle = document.getElementById("idle");
  const idleDetail = document.getElementById("idle-detail");
  const idleTitle = document.querySelector("#idle .idle-title");
  const statusEl = document.getElementById("status");
  const screenLabel = document.getElementById("screen-label");
  const clearBtn = document.getElementById("clear-pairing");
  const blackoutEl = document.getElementById("blackout");
  const blackoutDetail = document.getElementById("blackout-detail");

  let queue = [];
  let index = 0;
  let imageTimer = null;
  let playing = false;
  /** Ticket Q — cached hours from playlist/heartbeat */
  let hours = null;
  /** Ticket X — maintenance soft blackout (beats force-live) */
  let maintenance = null;
  let blackout = false;
  let hoursTimer = null;
  /** LIVE | BLACKOUT | IDLE | EMPTY */
  let playbackState = "IDLE";

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setClearVisible(show) {
    if (!clearBtn) return;
    clearBtn.hidden = !show;
  }

  function reportPlaybackState(state) {
    playbackState = state;
    window.adnabbit?.setPlaybackState?.(state);
  }

  function activeNow(items) {
    const now = Date.now();
    return (items || []).filter((it) => {
      const s = Date.parse(it.startAt);
      const e = Date.parse(it.endAt);
      return Number.isFinite(s) && Number.isFinite(e) && s <= now && now < e;
    });
  }

  function parseHHMM(value) {
    if (!value || typeof value !== "string") return null;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function zonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    const parts = fmt.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
      minutes: Number(get("hour")) * 60 + Number(get("minute")),
      isoWeekday: map[get("weekday")] || 1,
    };
  }

  function maintenanceActiveNow() {
    if (!maintenance || !maintenance.active) return false;
    if (maintenance.endsAt) {
      const end = Date.parse(maintenance.endsAt);
      if (Number.isFinite(end) && Date.now() >= end) return false;
    }
    return true;
  }

  /** Ticket Q/X — open-hours + maintenance (works offline with cached payload). */
  function isOpenNow() {
    // Ticket X — maintenance beats force-live
    if (maintenanceActiveNow()) return false;
    if (!hours || hours.alwaysOpen) return true;
    const forceUntil = hours.forceLiveUntil
      ? Date.parse(hours.forceLiveUntil)
      : NaN;
    if (Number.isFinite(forceUntil) && forceUntil > Date.now()) return true;
    const tz = hours.timezone || "America/Denver";
    const weekly = Array.isArray(hours.weekly) ? hours.weekly : [];
    if (!weekly.length) return true;
    const parts = zonedParts(new Date(), tz);
    const row = weekly.find((r) => r.weekday === parts.isoWeekday);
    if (!row || !row.openTime || !row.closeTime) return false;
    const openMin = parseHHMM(row.openTime);
    const closeMin = parseHHMM(row.closeTime);
    if (openMin === null || closeMin === null || closeMin <= openMin) return false;
    return parts.minutes >= openMin && parts.minutes < closeMin;
  }

  function stopMedia() {
    playing = false;
    if (imageTimer) {
      clearTimeout(imageTimer);
      imageTimer = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.classList.remove("playing");
    image.classList.remove("playing");
    image.removeAttribute("src");
  }

  function showBlackout(detail, opts = {}) {
    blackout = true;
    stopMedia();
    idle.style.display = "none";
    if (blackoutEl) {
      blackoutEl.hidden = false;
      blackoutEl.style.display = "flex";
      const title = blackoutEl.querySelector(".blackout-title");
      if (title) {
        title.textContent = opts.maintenance
          ? "Maintenance"
          : opts.offline
            ? "Offline"
            : "Closed";
      }
    }
    if (blackoutDetail && detail) blackoutDetail.textContent = detail;
    document.body.classList.add("blackout");
    if (opts.maintenance) {
      setStatus("Maintenance · soft blackout");
      reportPlaybackState("MAINTENANCE");
    } else {
      setStatus("Closed hours · soft blackout");
      reportPlaybackState("BLACKOUT");
    }
  }

  function hideBlackout() {
    blackout = false;
    if (blackoutEl) {
      blackoutEl.hidden = true;
      blackoutEl.style.display = "none";
    }
    document.body.classList.remove("blackout");
  }

  function showIdle(msg) {
    playing = false;
    stopMedia();
    hideBlackout();
    idle.style.display = "block";
    if (idleTitle) idleTitle.textContent = "Waiting for playlist";
    if (msg) idleDetail.textContent = msg;
  }

  function formatNextWindow() {
    if (maintenanceActiveNow()) {
      if (maintenance.endsAt) {
        try {
          return `Maintenance until ${new Date(maintenance.endsAt).toLocaleString()}`;
        } catch {
          return "Maintenance in progress";
        }
      }
      return maintenance.note || "Maintenance in progress";
    }
    if (!hours) return "";
    if (hours.nextOpenAt) {
      try {
        return `Next open ${new Date(hours.nextOpenAt).toLocaleString()}`;
      } catch {
        return "";
      }
    }
    return hours.reason === "closed_day" ? "Closed today" : "Outside open hours";
  }

  function checkHoursAndPlay() {
    if (!isOpenNow()) {
      showBlackout(formatNextWindow(), {
        maintenance: maintenanceActiveNow(),
      });
      return;
    }
    if (blackout) hideBlackout();
    playNext();
  }

  function playNext() {
    if (!isOpenNow()) {
      showBlackout(formatNextWindow(), {
        maintenance: maintenanceActiveNow(),
      });
      return;
    }
    hideBlackout();
    if (imageTimer) {
      clearTimeout(imageTimer);
      imageTimer = null;
    }
    const active = activeNow(queue);
    if (!active.length) {
      showIdle("No creatives in the current window — waiting for next daypart.");
      setStatus("Idle · empty window");
      reportPlaybackState("EMPTY");
      setTimeout(checkHoursAndPlay, 5000);
      return;
    }
    idle.style.display = "none";
    if (index >= active.length) index = 0;
    const item = active[index % active.length];
    index += 1;
    const src = item.localUrl || item.assetUrl;
    if (!src) {
      setTimeout(checkHoursAndPlay, 500);
      return;
    }
    playing = true;
    const isVideo = (item.mimeType || "").startsWith("video/");
    if (isVideo) {
      image.classList.remove("playing");
      video.classList.add("playing");
      video.src = src;
      video.muted = true;
      video.play().catch(() => setTimeout(checkHoursAndPlay, 1000));
      setStatus(`Playing ${item.creativeName}`);
      reportPlaybackState("LIVE");
      // Ticket Q — mute PoP outside hours (guard again at emit time)
      if (isOpenNow()) {
        window.adnabbit?.playLog?.({
          creativeId: item.creativeId,
          scheduleId: item.scheduleId,
          playedAt: new Date().toISOString(),
          mimeType: item.mimeType,
        });
      }
    } else {
      video.classList.remove("playing");
      video.pause();
      image.classList.add("playing");
      image.src = src;
      const dwell = (item.durationHintSec || 10) * 1000;
      setStatus(`Showing ${item.creativeName} (${dwell / 1000}s)`);
      reportPlaybackState("LIVE");
      if (isOpenNow()) {
        window.adnabbit?.playLog?.({
          creativeId: item.creativeId,
          scheduleId: item.scheduleId,
          playedAt: new Date().toISOString(),
          mimeType: item.mimeType,
        });
      }
      imageTimer = setTimeout(checkHoursAndPlay, dwell);
    }
  }

  video.addEventListener("ended", () => checkHoursAndPlay());
  video.addEventListener("error", () => setTimeout(checkHoursAndPlay, 1000));

  function applyHours(h) {
    if (h && typeof h === "object") hours = h;
  }

  function applyMaintenance(m) {
    if (m && typeof m === "object") maintenance = m;
  }

  function applyPlaylist(pl) {
    // Ticket V — offline policy blackout (distinct from closed hours)
    if (pl?.offlineMode === "blackout") {
      queue = [];
      const label = [pl?.hostName, pl?.screenName].filter(Boolean).join(" · ");
      if (label) screenLabel.textContent = label + " (offline)";
      showBlackout(
        pl.offlinePolicy === "BLACKOUT"
          ? "Offline · host policy BLACKOUT"
          : "Offline · cache TTL expired / no cache",
        { offline: true }
      );
      setStatus("Offline · soft blackout");
      return;
    }
    queue = pl?.items || [];
    if (pl?.hours) applyHours(pl.hours);
    if (pl?.maintenance) applyMaintenance(pl.maintenance);
    const label = [pl?.hostName, pl?.screenName].filter(Boolean).join(" · ");
    if (label) {
      screenLabel.textContent =
        label +
        (pl.offline
          ? pl.offlineMode === "play_cache"
            ? " (offline · cache)"
            : " (offline)"
          : "");
    }
    index = 0;
    checkHoursAndPlay();
  }

  clearBtn?.addEventListener("click", async () => {
    if (!window.adnabbit?.clearPairing) return;
    const ok = window.confirm(
      "Clear pairing? You will need a new claim code. Token file ~/.adnabbit-player/device-token.json will be removed."
    );
    if (!ok) return;
    const result = await window.adnabbit.clearPairing();
    if (result?.error) {
      setStatus(`Error: ${result.error}`);
    }
  });

  async function boot() {
    if (!window.adnabbit) {
      setStatus("Bridge missing");
      return;
    }
    const boot = await window.adnabbit.getBootstrap();
    setClearVisible(!!boot.canClearPairing);
    if (!boot.claimed) {
      showIdle("Not claimed. Use the setup screen or: npm run claim -- --code XXXXXX");
      setStatus("Unclaimed");
      reportPlaybackState("IDLE");
    } else {
      screenLabel.textContent = [boot.hostName, boot.screenName]
        .filter(Boolean)
        .join(" · ");
      if (boot.playlist?.hours) applyHours(boot.playlist.hours);
      if (boot.hours) applyHours(boot.hours);
      if (boot.playlist?.maintenance) applyMaintenance(boot.playlist.maintenance);
      if (boot.maintenance) applyMaintenance(boot.maintenance);
      if (boot.playlist) applyPlaylist(boot.playlist);
      else showIdle("Fetching playlist…");
    }
    window.adnabbit.onPlaylist(applyPlaylist);
    window.adnabbit.onHours?.((h) => {
      applyHours(h);
      checkHoursAndPlay();
    });
    window.adnabbit.onMaintenance?.((m) => {
      applyMaintenance(m);
      checkHoursAndPlay();
    });
    window.adnabbit.onStatus((s) => {
      if (s.error) setStatus(`Error: ${s.error}`);
      else if (blackout && maintenanceActiveNow())
        setStatus("Maintenance · soft blackout");
      else if (blackout) setStatus("Closed hours · soft blackout");
      else if (s.offlineMode === "blackout")
        setStatus("Offline · soft blackout");
      else if (s.offline)
        setStatus(
          s.offlineMode === "play_cache"
            ? `Offline · playing cache · ${s.itemCount || 0} items`
            : `Offline · ${s.itemCount || 0} cached`
        );
      else if (s.downloadAllowed === false) {
        const def =
          typeof s.downloadDeferredCount === "number" && s.downloadDeferredCount > 0
            ? ` · deferred ${s.downloadDeferredCount}`
            : "";
        setStatus(`Online · quiet hours (cache only)${def} · ${s.itemCount || 0} items`);
      } else setStatus(`Online · ${s.itemCount || 0} items`);
    });
    window.adnabbit.onKioskChanged?.((s) => {
      setClearVisible(!s.kiosk);
    });
    // Ticket Q — re-check schedule every minute
    if (hoursTimer) clearInterval(hoursTimer);
    hoursTimer = setInterval(() => {
      checkHoursAndPlay();
    }, 60_000);
  }

  // Expose for main-process queries via preload if needed
  window.__adnabbitPlaybackState = () => playbackState;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
