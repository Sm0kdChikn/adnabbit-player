/**
 * Ticket Q — evaluate venue open hours locally (player-side).
 * Mirrors web lib/open-hours evaluateOpenState (SOFT blackout).
 */

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
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    isoWeekday: map[get("weekday")] || 1,
  };
}

/**
 * @param {object|null|undefined} hours — payload from playlist/heartbeat/claim
 * @param {Date} [now]
 * @returns {{ isOpen: boolean, reason: string, forceLiveActive: boolean }}
 */
function evaluateHours(hours, now = new Date()) {
  if (!hours || hours.alwaysOpen) {
    return { isOpen: true, reason: "always_open", forceLiveActive: false };
  }
  const forceUntil = hours.forceLiveUntil
    ? Date.parse(hours.forceLiveUntil)
    : NaN;
  if (Number.isFinite(forceUntil) && forceUntil > now.getTime()) {
    return { isOpen: true, reason: "force_live", forceLiveActive: true };
  }
  // Prefer server-computed isOpenNow when fresh, but re-check weekly for offline drift
  const tz = hours.timezone || "America/Denver";
  const weekly = Array.isArray(hours.weekly) ? hours.weekly : [];
  if (weekly.length === 0) {
    return { isOpen: true, reason: "always_open", forceLiveActive: false };
  }
  const parts = zonedParts(now, tz);
  const row = weekly.find((r) => r.weekday === parts.isoWeekday);
  if (!row || !row.openTime || !row.closeTime) {
    return { isOpen: false, reason: "closed_day", forceLiveActive: false };
  }
  const openMin = parseHHMM(row.openTime);
  const closeMin = parseHHMM(row.closeTime);
  if (openMin === null || closeMin === null || closeMin <= openMin) {
    return { isOpen: false, reason: "closed_day", forceLiveActive: false };
  }
  if (parts.minutes >= openMin && parts.minutes < closeMin) {
    return { isOpen: true, reason: "within_hours", forceLiveActive: false };
  }
  return { isOpen: false, reason: "outside_hours", forceLiveActive: false };
}

module.exports = { evaluateHours, zonedParts, parseHHMM };
