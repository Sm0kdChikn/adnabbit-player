(() => {
  const video = document.getElementById("video");
  const image = document.getElementById("image");
  const idle = document.getElementById("idle");
  const idleDetail = document.getElementById("idle-detail");
  const statusEl = document.getElementById("status");
  const screenLabel = document.getElementById("screen-label");

  let queue = [];
  let index = 0;
  let imageTimer = null;
  let playing = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function activeNow(items) {
    const now = Date.now();
    return (items || []).filter((it) => {
      const s = Date.parse(it.startAt);
      const e = Date.parse(it.endAt);
      return Number.isFinite(s) && Number.isFinite(e) && s <= now && now < e;
    });
  }

  function showIdle(msg) {
    playing = false;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.classList.remove("playing");
    image.classList.remove("playing");
    image.removeAttribute("src");
    idle.style.display = "block";
    if (msg) idleDetail.textContent = msg;
  }

  function playNext() {
    if (imageTimer) {
      clearTimeout(imageTimer);
      imageTimer = null;
    }
    const active = activeNow(queue);
    if (!active.length) {
      showIdle("No creatives in the current window — waiting for next daypart.");
      setStatus("Idle");
      // Retry soon in case window rolls forward
      setTimeout(playNext, 5000);
      return;
    }
    // Loop within active set
    if (index >= active.length) index = 0;
    const item = active[index % active.length];
    index += 1;
    const src = item.localUrl || item.assetUrl;
    if (!src) {
      setTimeout(playNext, 500);
      return;
    }
    idle.style.display = "none";
    playing = true;
    const isVideo = (item.mimeType || "").startsWith("video/");
    if (isVideo) {
      image.classList.remove("playing");
      video.classList.add("playing");
      video.src = src;
      video.muted = true;
      video.play().catch(() => setTimeout(playNext, 1000));
      setStatus(`Playing ${item.creativeName}`);
      window.adnabbit?.playLog?.({
        creativeId: item.creativeId,
        scheduleId: item.scheduleId,
        playedAt: new Date().toISOString(),
        mimeType: item.mimeType,
      });
    } else {
      video.classList.remove("playing");
      video.pause();
      image.classList.add("playing");
      image.src = src;
      const dwell = (item.durationHintSec || 10) * 1000;
      setStatus(`Showing ${item.creativeName} (${dwell / 1000}s)`);
      window.adnabbit?.playLog?.({
        creativeId: item.creativeId,
        scheduleId: item.scheduleId,
        playedAt: new Date().toISOString(),
        mimeType: item.mimeType,
      });
      imageTimer = setTimeout(playNext, dwell);
    }
  }

  video.addEventListener("ended", playNext);
  video.addEventListener("error", () => setTimeout(playNext, 1000));

  function applyPlaylist(pl) {
    queue = pl?.items || [];
    const label = [pl?.hostName, pl?.screenName].filter(Boolean).join(" · ");
    if (label) screenLabel.textContent = label + (pl.offline ? " (offline)" : "");
    index = 0;
    playNext();
  }

  async function boot() {
    if (!window.adnabbit) {
      setStatus("Bridge missing");
      return;
    }
    const boot = await window.adnabbit.getBootstrap();
    if (!boot.claimed) {
      showIdle("Not claimed. Run: npm run claim -- --code XXXXXX");
      setStatus("Unclaimed");
    } else {
      screenLabel.textContent = [boot.hostName, boot.screenName]
        .filter(Boolean)
        .join(" · ");
      if (boot.playlist) applyPlaylist(boot.playlist);
      else showIdle("Fetching playlist…");
    }
    window.adnabbit.onPlaylist(applyPlaylist);
    window.adnabbit.onStatus((s) => {
      if (s.error) setStatus(`Error: ${s.error}`);
      else if (s.offline) setStatus(`Offline · ${s.itemCount || 0} cached`);
      else setStatus(`Online · ${s.itemCount || 0} items`);
    });
  }

  boot();
})();
