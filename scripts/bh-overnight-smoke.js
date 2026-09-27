/** Ticket BH / Q.1 — player overnight evaluateHours smoke */
const { evaluateHours } = require("../src/open-hours");
// Minimal wall-clock probe without date-fns-tz: construct UTC that maps to Denver parts via Intl
function denverParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hm: `${get("hour")}:${get("minute")}`,
    wd: get("weekday"),
  };
}

function assert(c, m) {
  if (!c) throw new Error("FAIL: " + m);
  console.log("PASS:", m);
}

// Find a Date whose Denver wall is Fri 23:00 / Sat 01:00 / etc by scanning
function findDenver(targetYmd, targetHm, targetWd) {
  // Approximate: parse as if Denver were UTC then adjust — brute force hour offsets
  const [y, m, d] = targetYmd.split("-").map(Number);
  const [hh, mi] = targetHm.split(":").map(Number);
  for (let offsetH = 0; offsetH <= 12; offsetH++) {
    for (const sign of [1, -1]) {
      const dt = new Date(Date.UTC(y, m - 1, d, hh - sign * offsetH, mi));
      const p = denverParts(dt);
      if (p.ymd === targetYmd && p.hm === targetHm && (!targetWd || p.wd === targetWd)) {
        return dt;
      }
    }
  }
  // wider search
  for (let min = -14 * 60; min <= 14 * 60; min++) {
    const dt = new Date(Date.UTC(y, m - 1, d, hh, mi + min));
    const p = denverParts(dt);
    if (p.ymd === targetYmd && p.hm === targetHm) return dt;
  }
  throw new Error(`Could not find instant for ${targetYmd} ${targetHm} Denver`);
}

const weekly = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
  weekday === 5
    ? { weekday, openTime: "22:00", closeTime: "02:00" }
    : { weekday, openTime: null, closeTime: null }
);
const hours = {
  timezone: "America/Denver",
  alwaysOpen: false,
  weekly,
  forceLiveUntil: null,
};

const fri23 = findDenver("2026-09-25", "23:00", "Fri");
const sat01 = findDenver("2026-09-26", "01:00", "Sat");
const sat03 = findDenver("2026-09-26", "03:00", "Sat");
const fri21 = findDenver("2026-09-25", "21:00", "Fri");

assert(evaluateHours(hours, fri23).isOpen, "Fri 23 open");
assert(evaluateHours(hours, sat01).isOpen, "Sat 01 open");
assert(!evaluateHours(hours, sat03).isOpen, "Sat 03 closed");
assert(!evaluateHours(hours, fri21).isOpen, "Fri 21 closed");
assert(
  !evaluateHours(hours, fri23, { active: true }).isOpen,
  "maintenance beats"
);
console.log("OK player overnight");
