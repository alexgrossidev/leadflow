/**
 * Build-time patch for wppconnect-server (run by wa-transport.dockerfile after
 * `npm run build`). Idempotent: re-running it on a patched tree is a no-op.
 *
 * 1. dist/config.js: upstream compiles its config into a static object, so the
 *    container's environment would be ignored. We append a block that reads
 *    SECRET_KEY and WEBHOOK_* from process.env at startup, refuses to start
 *    without SECRET_KEY (the upstream default "THISISMYSECURETOKEN" is public),
 *    and disables startAllSession and autoClose.
 * 2. host.layer.js (@wppconnect-team/wppconnect): make startAutoClose a no-op,
 *    otherwise a session can close itself while the user is still scanning the QR.
 *
 * Webhook authentication: upstream cannot send custom headers, so the whatsapp
 * service's secret travels in the URL path:
 *   WEBHOOK_URL=http://whatsapp:3012/sessions/callback/<WA_WEBHOOK_SECRET>
 * For the same reason the URL is never printed, only its origin.
 */

const fs = require("fs");
const path = require("path");

function fail(message) {
  console.error(`[wa-transport-patch] ERROR: ${message}`);
  process.exit(1);
}

// ─── Patch 1: dist/config.js ─────────────────────────────────────────────────

const distConfigPath = path.join(__dirname, "dist", "config.js");
if (!fs.existsSync(distConfigPath)) fail("dist/config.js not found; run the build first");

const envPatchMarker = "// [wa-transport-patch] env var injection";
let configContent = fs.readFileSync(distConfigPath, "utf8");

if (configContent.includes(envPatchMarker)) {
  console.log("[wa-transport-patch] dist/config.js already patched");
} else {
  configContent += `

${envPatchMarker}
(function applyEnvOverrides() {
  var cfg = exports.default;
  if (!cfg) return;

  // Must match WA_TRANSPORT_SECRET_KEY in the whatsapp service.
  if (!process.env.SECRET_KEY || process.env.SECRET_KEY.length < 16) {
    throw new Error('[wa-transport-patch] SECRET_KEY must be set (at least 16 characters)');
  }
  cfg.secretKey = process.env.SECRET_KEY;

  cfg.webhook = cfg.webhook || {};
  if (process.env.WEBHOOK_URL) {
    cfg.webhook.url = process.env.WEBHOOK_URL;
    // The path carries the webhook secret: log the origin only.
    console.log('[wa-transport-patch] webhook configured for', new URL(process.env.WEBHOOK_URL).origin);
  } else {
    console.warn('[wa-transport-patch] WEBHOOK_URL not set: QR and login events will not be delivered');
  }
  if (process.env.WEBHOOK_AUTO_DOWNLOAD !== undefined) {
    cfg.webhook.autoDownload = process.env.WEBHOOK_AUTO_DOWNLOAD !== 'false';
  }
  if (process.env.WEBHOOK_ALL_UNREAD_ON_START !== undefined) {
    cfg.webhook.allUnreadOnStart = process.env.WEBHOOK_ALL_UNREAD_ON_START === 'true';
  }

  // Sessions are owned by the whatsapp service; the transport must only start
  // one when told to via POST /api/{session}/start-session.
  cfg.startAllSession = false;

  // Belt and braces alongside the host.layer.js patch below.
  cfg.createOptions = cfg.createOptions || {};
  cfg.createOptions.autoClose = 0;
})();
`;
  fs.writeFileSync(distConfigPath, configContent);
  console.log("[wa-transport-patch] dist/config.js patched");
}

// ─── Patch 2: host.layer.js ──────────────────────────────────────────────────

const hostLayerPath = path.join(
  __dirname,
  "node_modules/@wppconnect-team/wppconnect/dist/api/layers/host.layer.js",
);
if (!fs.existsSync(hostLayerPath)) fail(`host.layer.js not found at ${hostLayerPath}`);

const autoClosePatchMarker = "// [wa-transport-patch] autoClose disabled";
let hostContent = fs.readFileSync(hostLayerPath, "utf8");

if (hostContent.includes(autoClosePatchMarker)) {
  console.log("[wa-transport-patch] host.layer.js already patched");
} else {
  // Preferred: early return at the top of HostLayer.prototype.startAutoClose.
  const startAutoClose = /(HostLayer\.prototype\.startAutoClose\s*=\s*function\s*\([^)]*\)\s*\{)/;
  // Fallback for builds that inline the method: neutralise its `time > 0` guard.
  const timeGuard = /if\s*\(time\s*>\s*0\s*&&\s*!this\.autoCloseInterval\)/g;

  if (startAutoClose.test(hostContent)) {
    hostContent = hostContent.replace(startAutoClose, `$1\n        ${autoClosePatchMarker}\n        return;`);
  } else if (timeGuard.test(hostContent)) {
    hostContent = hostContent.replace(timeGuard, `if (false /* ${autoClosePatchMarker} */ && !this.autoCloseInterval)`);
  } else {
    const hints = hostContent
      .split("\n")
      .map((line, i) => (line.includes("autoClose") ? `  line ${i + 1}: ${line.trim()}` : null))
      .filter(Boolean)
      .join("\n");
    fail(`could not find startAutoClose in host.layer.js; update this patch for the new upstream source.\n${hints}`);
  }

  fs.writeFileSync(hostLayerPath, hostContent);
  console.log("[wa-transport-patch] host.layer.js patched");
}

// ─── Verify ──────────────────────────────────────────────────────────────────

if (!fs.readFileSync(distConfigPath, "utf8").includes(envPatchMarker)) fail("dist/config.js patch missing after write");
if (!fs.readFileSync(hostLayerPath, "utf8").includes(autoClosePatchMarker)) fail("host.layer.js patch missing after write");
console.log("[wa-transport-patch] all patches applied and verified");
