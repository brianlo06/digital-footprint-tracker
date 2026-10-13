import { spawn } from "node:child_process";

// A successful build does not prove the Worker serves requests: an adapter and
// framework mismatch can bundle cleanly and still fail every request in
// workerd. This boots the already-built no-data preview Worker on loopback and
// checks the responses the preview boundary depends on.

const port = Number(process.env.SMOKE_PORT ?? 8799);
const origin = `http://127.0.0.1:${port}`;
const startupTimeoutMs = 120_000;

function fail(code) {
  throw new Error(`CLOUDFLARE_WORKER_SMOKE_FAILED:${code}`);
}

async function waitUntilListening(worker) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) fail("worker_exited_before_listening");
    try {
      await fetch(origin, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  fail("worker_did_not_listen");
}

async function expectResponse(path, status, location) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual" });
  if (response.status !== status) fail(`${path}:status_${response.status}`);
  if (!response.headers.get("content-security-policy")?.includes("'nonce-")) {
    fail(`${path}:missing_nonce_csp`);
  }
  if (location !== undefined) {
    const actual = response.headers.get("location");
    if (!actual || new URL(actual, origin).pathname !== location) {
      fail(`${path}:unexpected_redirect`);
    }
  }
}

const worker = spawn(
  "npx",
  ["opennextjs-cloudflare", "preview", "--ip", "127.0.0.1", "--port", String(port)],
  { detached: true, stdio: "ignore" },
);

try {
  await waitUntilListening(worker);
  await expectResponse("/", 200);
  await expectResponse("/preview", 200);
  await expectResponse("/dashboard", 307, "/preview");
  console.log("Cloudflare preview Worker smoke check passed.");
} finally {
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {
    // The worker already exited.
  }
}
