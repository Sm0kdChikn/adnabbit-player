/**
 * Ticket Y — apply volume / brightness on the mini-PC player.
 * Volume → media element (renderer) via IPC.
 * Brightness → Linux backlight sysfs, then xrandr; soft-fail if missing.
 * Out: CEC TV, sensors, per-creative gain, OptiSigns.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const DEFAULT_VOLUME = 80;
const DEFAULT_BRIGHTNESS = 100;

/** @type {{ volume: number, brightness: number }} */
let lastApplied = {
  volume: DEFAULT_VOLUME,
  brightness: DEFAULT_BRIGHTNESS,
};

function clampLevel(n, fallback) {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function getLastApplied() {
  return { ...lastApplied };
}

/**
 * Try sysfs backlight brightness under /sys/class/backlight (common on mini-PCs).
 * Soft-fails when path missing or unwritable (no root).
 */
async function applyBacklightSysfs(level0to100) {
  const root = "/sys/class/backlight";
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return { ok: false, reason: "no /sys/class/backlight" };
  }
  if (!entries.length) {
    return { ok: false, reason: "empty backlight class" };
  }
  // Prefer first intel/amd/acpi entry
  const preferred =
    entries.find((e) => /intel|amd|acpi|nvidia|ddcci/i.test(e)) || entries[0];
  const base = path.join(root, preferred);
  const maxPath = path.join(base, "max_brightness");
  const briPath = path.join(base, "brightness");
  let max = 100;
  try {
    max = parseInt(fs.readFileSync(maxPath, "utf8").trim(), 10) || 100;
  } catch {
    /* keep 100 */
  }
  const value = Math.round((level0to100 / 100) * max);
  try {
    fs.writeFileSync(briPath, String(value), "utf8");
    return { ok: true, method: "sysfs", device: preferred, value, max };
  } catch (e) {
    return {
      ok: false,
      reason: `sysfs write failed (${e.message})`,
      device: preferred,
    };
  }
}

/**
 * Fallback: xrandr --output <connected> --brightness 0.N
 * Soft-fails when xrandr missing or no connected outputs.
 */
async function applyXrandrBrightness(level0to100) {
  const fraction = Math.max(0.1, Math.min(1, level0to100 / 100));
  let stdout = "";
  try {
    const r = await execFileAsync("xrandr", ["--query"], {
      timeout: 5000,
      env: process.env,
    });
    stdout = r.stdout || "";
  } catch (e) {
    return { ok: false, reason: `xrandr unavailable (${e.message})` };
  }
  const connected = [];
  for (const line of stdout.split("\n")) {
    const m = /^(\S+)\s+connected\b/.exec(line);
    if (m) connected.push(m[1]);
  }
  if (!connected.length) {
    return { ok: false, reason: "no xrandr connected outputs" };
  }
  const errors = [];
  for (const out of connected) {
    try {
      await execFileAsync(
        "xrandr",
        ["--output", out, "--brightness", String(fraction)],
        { timeout: 5000, env: process.env }
      );
    } catch (e) {
      errors.push(`${out}: ${e.message}`);
    }
  }
  if (errors.length === connected.length) {
    return { ok: false, reason: errors.join("; ") };
  }
  return {
    ok: true,
    method: "xrandr",
    outputs: connected,
    brightness: fraction,
  };
}

/**
 * Apply brightness with soft-fail. Returns { applied, method, softFail? }.
 */
async function applyBrightness(level0to100) {
  const level = clampLevel(level0to100, lastApplied.brightness);
  const sysfs = await applyBacklightSysfs(level);
  if (sysfs.ok) {
    lastApplied.brightness = level;
    return { applied: level, ...sysfs };
  }
  const xrandr = await applyXrandrBrightness(level);
  if (xrandr.ok) {
    lastApplied.brightness = level;
    return { applied: level, ...xrandr, softFailNote: sysfs.reason };
  }
  // Soft fail — still record intended level so heartbeat reports intent
  lastApplied.brightness = level;
  console.warn(
    `[Ticket Y] brightness soft-fail (sysfs: ${sysfs.reason}; xrandr: ${xrandr.reason}). ` +
      `Intended level ${level}% recorded; hardware backlight not changed.`
  );
  return {
    applied: level,
    ok: false,
    softFail: true,
    reason: `sysfs: ${sysfs.reason}; xrandr: ${xrandr.reason}`,
  };
}

function applyVolumeState(level0to100) {
  const level = clampLevel(level0to100, lastApplied.volume);
  lastApplied.volume = level;
  return { applied: level };
}

/**
 * Apply partial setOutput { volume?, brightness? }.
 * Volume is stateful here; renderer applies via IPC from caller.
 */
async function applySetOutput(partial, { sendToRenderer } = {}) {
  const result = { volume: null, brightness: null };
  if (partial && typeof partial.volume === "number") {
    result.volume = applyVolumeState(partial.volume);
    if (typeof sendToRenderer === "function") {
      sendToRenderer({ volume: lastApplied.volume });
    }
  }
  if (partial && typeof partial.brightness === "number") {
    result.brightness = await applyBrightness(partial.brightness);
    if (typeof sendToRenderer === "function") {
      // Software CSS brightness as UX fallback when hardware soft-fails
      sendToRenderer({
        brightness: lastApplied.brightness,
        softFail: !!(result.brightness && result.brightness.softFail),
      });
    }
  }
  return { lastApplied: getLastApplied(), result };
}

module.exports = {
  DEFAULT_VOLUME,
  DEFAULT_BRIGHTNESS,
  getLastApplied,
  applyVolumeState,
  applyBrightness,
  applySetOutput,
  clampLevel,
};
