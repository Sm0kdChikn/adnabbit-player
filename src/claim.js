#!/usr/bin/env node
const { claim } = require("./api");
const {
  saveToken,
  saveApiBase,
  getApiBase,
  tokenPath,
} = require("./config");

function parseArgs(argv) {
  const out = { code: null, apiBase: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--code" && argv[i + 1]) {
      out.code = argv[++i];
    } else if (argv[i].startsWith("--code=")) {
      out.code = argv[i].slice(7);
    } else if (argv[i] === "--api-base" && argv[i + 1]) {
      out.apiBase = argv[++i];
    } else if (argv[i].startsWith("--api-base=")) {
      out.apiBase = argv[i].slice(11);
    }
  }
  return out;
}

async function main() {
  const { code, apiBase } = parseArgs(process.argv.slice(2));
  if (!code) {
    console.error("Usage: npm run claim -- --code XXXXXX [--api-base URL]");
    process.exit(1);
  }
  if (apiBase) {
    saveApiBase(apiBase);
  }
  console.log(`Claiming against ${getApiBase()} …`);
  const result = await claim(code.trim().toUpperCase());
  const payload = {
    deviceToken: result.deviceToken,
    screenId: result.screenId,
    screenName: result.screenName,
    hostName: result.hostName,
    timezone: result.timezone,
    claimedAt: new Date().toISOString(),
    apiBase: getApiBase(),
    offlinePolicy: result.offlinePolicy || "PLAY_CACHE",
    offlineCacheTtlHours:
      typeof result.offlineCacheTtlHours === "number"
        ? result.offlineCacheTtlHours
        : 24,
  };
  saveToken(payload);
  console.log("Paired OK");
  console.log(`  screen: ${payload.screenName} (${payload.screenId})`);
  console.log(`  host:   ${payload.hostName}`);
  console.log(`  tz:     ${payload.timezone}`);
  console.log(`  api:    ${payload.apiBase}`);
  console.log(
    `  offline: ${payload.offlinePolicy} ttl=${payload.offlineCacheTtlHours}h`
  );
  console.log(`  token:  ${tokenPath}`);
  console.log("Run: npm start  (or open the AppImage)");
}

main().catch((e) => {
  console.error("Claim failed:", e.message);
  process.exit(1);
});
