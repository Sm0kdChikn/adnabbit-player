/**
 * Ticket V — offline play policy (mirrors web lib/offline-policy).
 * PLAY_CACHE (default): loop last good playlist while cache age ≤ TTL.
 * BLACKOUT: soft blackout when offline.
 * ttlHours 0 → blackout immediately even under PLAY_CACHE.
 */

const DEFAULT_POLICY = "PLAY_CACHE";
const DEFAULT_TTL_HOURS = 24;
/** Match web PLAYER_ONLINE_GRACE_MS — no successful API within this → offline. */
const OFFLINE_GRACE_MS = 5 * 60 * 1000;

function normalizePolicy(raw) {
  if (raw === "BLACKOUT" || raw === "PLAY_CACHE") return raw;
  return DEFAULT_POLICY;
}

function normalizeTtlHours(raw) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.min(8760, Math.floor(raw));
  }
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    const n = parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n >= 0) return Math.min(8760, n);
  }
  return DEFAULT_TTL_HOURS;
}

/**
 * @returns {"online"|"play_cache"|"blackout"}
 */
function decideOfflinePlayback(opts) {
  const offline = !!opts.offline;
  if (!offline) return "online";
  const policy = normalizePolicy(opts.policy);
  const ttlHours = normalizeTtlHours(opts.ttlHours);
  if (policy === "BLACKOUT") return "blackout";
  if (ttlHours <= 0) return "blackout";
  if (opts.cacheAgeHours == null || !Number.isFinite(opts.cacheAgeHours)) {
    return "blackout";
  }
  if (opts.cacheAgeHours > ttlHours) return "blackout";
  return "play_cache";
}

function cacheAgeHours(cachedAt, now = new Date()) {
  if (!cachedAt) return null;
  const t = Date.parse(cachedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now.getTime() - t) / (60 * 60 * 1000));
}

/**
 * True when last successful API contact is older than grace (or never).
 */
function isApiStale(lastApiOkAt, now = new Date(), graceMs = OFFLINE_GRACE_MS) {
  if (!lastApiOkAt) return true;
  const t =
    typeof lastApiOkAt === "number" ? lastApiOkAt : Date.parse(lastApiOkAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > graceMs;
}

module.exports = {
  DEFAULT_POLICY,
  DEFAULT_TTL_HOURS,
  OFFLINE_GRACE_MS,
  normalizePolicy,
  normalizeTtlHours,
  decideOfflinePlayback,
  cacheAgeHours,
  isApiStale,
};
