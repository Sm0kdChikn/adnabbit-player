#!/usr/bin/env node
const { claim } = require("./api");
const { saveToken, getApiBase, tokenPath } = require("./config");

function parseArgs(argv) {
  const out = { code: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--code" && argv[i + 1]) {
      out.code = argv[++i];
    } else if (argv[i].startsWith("--code=")) {
      out.code = argv[i].slice(7);
    }
  }
  return out;
}

async function main() {
  const { code } = parseArgs(process.argv.slice(2));
  if (!code) {
    console.error("Usage: npm run claim -- --code XXXXXX");
    process.exit(1);
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
  };
  saveToken(payload);
  console.log("Paired OK");
  console.log(`  screen: ${payload.screenName} (${payload.screenId})`);
  console.log(`  host:   ${payload.hostName}`);
  console.log(`  tz:     ${payload.timezone}`);
  console.log(`  token:  ${tokenPath}`);
  console.log("Run: npm start");
}

main().catch((e) => {
  console.error("Claim failed:", e.message);
  process.exit(1);
});
