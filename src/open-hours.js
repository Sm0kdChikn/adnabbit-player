/**
 * Ticket Q — evaluate venue open hours locally (player-side).
 * Ticket X — maintenance soft blackout beats force-live.
 * Ticket Q.1 / BH — overnight wrap when close < open (mirrors web).
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

function prevIsoWeekday(d) {
  return d === 1 ? 7 : d - 1;
}

/**
 * @param {object|null|undefined} hours — payload from playlist/heartbeat/claim
 * @param {Date} [now]
 * @param {object|null|undefined} [maintenance] — { active, endsAt? }
 * @returns {{ isOpen: boolean, reason: string, forceLiveActive: boolean, maintenanceActive: boolean }}
 */
function evaluateHours(hours, now = new Date(), maintenance = null) {
  // Ticket X — maintenance beats force-live / open hours
  if (maintenance && maintenance.active) {
    if (maintenance.endsAt) {
      const end = Date.parse(maintenance.endsAt);
      if (Number.isFinite(end) && now.getTime() >= end) {
        // Window expired locally (cached payload) — fall through
      } else {
        return {
          isOpen: false,
          reason: "maintenance",
          forceLiveActive: false,
          maintenanceActive: true,
        };
      }
    } else {
      return {
        isOpen: false,
        reason: "maintenance",
        forceLiveActive: false,
        maintenanceActive: true,
      };
    }
  }
  if (!hours || hours.alwaysOpen) {
    return {
      isOpen: true,
      reason: "always_open",
      forceLiveActive: false,
      maintenanceActive: false,
    };
  }
  const forceUntil = hours.forceLiveUntil
    ? Date.parse(hours.forceLiveUntil)
    : NaN;
  if (Number.isFinite(forceUntil) && forceUntil > now.getTime()) {
    return {
      isOpen: true,
      reason: "force_live",
      forceLiveActive: true,
      maintenanceActive: false,
    };
  }
  // Prefer server-computed isOpenNow when fresh, but re-check weekly for offline drift
  const tz = hours.timezone || "America/Denver";
  const weekly = Array.isArray(hours.weekly) ? hours.weekly : [];
  if (weekly.length === 0) {
    return {
      isOpen: true,
      reason: "always_open",
      forceLiveActive: false,
      maintenanceActive: false,
    };
  }
  const parts = zonedParts(now, tz);
  const row = weekly.find((r) => r.weekday === parts.isoWeekday);
  const prevRow = weekly.find(
    (r) => r.weekday === prevIsoWeekday(parts.isoWeekday)
  );

  // Overnight spill from previous weekday into this calendar morning.
  if (prevRow && prevRow.openTime && prevRow.closeTime) {
    const prevOpen = parseHHMM(prevRow.openTime);
    const prevClose = parseHHMM(prevRow.closeTime);
    if (
      prevOpen !== null &&
      prevClose !== null &&
      prevClose < prevOpen &&
      parts.minutes < prevClose
    ) {
      return {
        isOpen: true,
        reason: "within_hours",
        forceLiveActive: false,
        maintenanceActive: false,
      };
    }
  }

  if (!row || !row.openTime || !row.closeTime) {
    return {
      isOpen: false,
      reason: "closed_day",
      forceLiveActive: false,
      maintenanceActive: false,
    };
  }
  const openMin = parseHHMM(row.openTime);
  const closeMin = parseHHMM(row.closeTime);
  if (openMin === null || closeMin === null || closeMin === openMin) {
    return {
      isOpen: false,
      reason: "closed_day",
      forceLiveActive: false,
      maintenanceActive: false,
    };
  }
  const overnight = closeMin < openMin;
  if (overnight) {
    if (parts.minutes >= openMin) {
      return {
        isOpen: true,
        reason: "within_hours",
        forceLiveActive: false,
        maintenanceActive: false,
      };
    }
  } else if (parts.minutes >= openMin && parts.minutes < closeMin) {
    return {
      isOpen: true,
      reason: "within_hours",
      forceLiveActive: false,
      maintenanceActive: false,
    };
  }
  return {
    isOpen: false,
    reason: "outside_hours",
    forceLiveActive: false,
    maintenanceActive: false,
  };
}

module.exports = { evaluateHours, zonedParts, parseHHMM };
