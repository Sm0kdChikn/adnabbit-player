const fs = require("fs");
const path = require("path");
const { getApiBase, assetCacheDir } = require("./config");

async function apiFetch(pathname, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${getApiBase()}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function claim(code) {
  return apiFetch("/api/device/claim", {
    method: "POST",
    body: { code },
  });
}

async function heartbeat(token, body) {
  return apiFetch("/api/device/heartbeat", {
    method: "POST",
    token,
    body: body || {},
  });
}

async function getPlaylist(token) {
  return apiFetch("/api/device/playlist", { token });
}

async function postPlayLogs(token, events) {
  const list = Array.isArray(events) ? events : [];
  return apiFetch("/api/device/play-logs", {
    method: "POST",
    token,
    body: { events: list },
  });
}


function assetDestPath(item) {
  const ext =
    item.mimeType === "video/mp4"
      ? ".mp4"
      : item.mimeType === "video/webm"
        ? ".webm"
        : item.mimeType === "image/png"
          ? ".png"
          : item.mimeType === "image/jpeg"
            ? ".jpg"
            : item.mimeType === "image/webp"
              ? ".webp"
              : ".bin";
  return path.join(assetCacheDir, `${item.creativeId}${ext}`);
}

/** Return local path if already cached; null otherwise (no network). */
function resolveCachedAsset(item) {
  const dest = assetDestPath(item);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return dest;
  }
  return null;
}

async function cacheAsset(token, item) {
  const dest = assetDestPath(item);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return dest;
  }
  const res = await fetch(item.assetUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Asset download failed ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}


async function pollInput(token) {
  return apiFetch("/api/device/input", { method: "POST", token });
}

async function postScreenshot(token, jpegBuffer) {
  const res = await fetch(`${getApiBase()}/api/device/screenshot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
    },
    body: jpegBuffer,
  });
  const textBody = await res.text();
  let data = null;
  try {
    data = textBody ? JSON.parse(textBody) : null;
  } catch {
    data = { raw: textBody };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

module.exports = {
  claim,
  heartbeat,
  getPlaylist,
  postPlayLogs,
  postScreenshot,
  pollInput,
  cacheAsset,
  resolveCachedAsset,
  apiFetch,
};
