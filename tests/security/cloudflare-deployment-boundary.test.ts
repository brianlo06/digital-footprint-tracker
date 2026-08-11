import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDeploymentBoundaries } from "../../scripts/verify-cloudflare-deployment-boundaries.mjs";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

function configurationFixtures(): { preview: string; retention: string } {
  const directory = mkdtempSync(join(tmpdir(), "dft-cloudflare-boundary-"));
  temporaryDirectories.push(directory);
  const preview = join(directory, "wrangler.jsonc");
  const retention = join(directory, "wrangler.retention.example.jsonc");
  copyFileSync("wrangler.jsonc", preview);
  copyFileSync("wrangler.retention.example.jsonc", retention);
  return { preview, retention };
}

function verify(preview: string, retention: string): void {
  verifyDeploymentBoundaries({
    previewConfigurationPath: preview,
    retentionConfigurationPath: retention,
  });
}

describe("Cloudflare deployment boundary verifier", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts the committed no-data web and placeholder retention boundaries", () => {
    const { preview, retention } = configurationFixtures();
    expect(() => verify(preview, retention)).not.toThrow();
  });

  it("rejects enabling authentication in the no-data preview", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace('"AUTH_MODE": "disabled"', '"AUTH_MODE": "clerk"'),
    );

    expect(() => verify(preview, retention)).toThrow("PREVIEW:AUTH_MODE");
  });

  it("rejects a web Hyperdrive binding", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace(
        '"vars": {',
        '"hyperdrive": [{"binding":"RUNTIME_DATABASE","id":"synthetic"}], "vars": {',
      ),
    );

    expect(() => verify(preview, retention)).toThrow("FORBIDDEN_BINDING_hyperdrive");
  });

  it("rejects an unknown future root binding until it is reviewed", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace('"vars": {', '"future_binding": {}, "vars": {'),
    );

    expect(() => verify(preview, retention)).toThrow("PREVIEW:ROOT:KEYS");
  });

  it("rejects secret-like values placed in public vars", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace(
        '"APP_ENV": "preview",',
        '"APP_ENV": "preview", "CLERK_SECRET_KEY": "synthetic",',
      ),
    );

    expect(() => verify(preview, retention)).toThrow("SECRET_LIKE_VAR_CLERK_SECRET_KEY");
  });

  it("rejects comments that could hide unparsed configuration", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(preview, `// synthetic hidden change\n${readFileSync(preview, "utf8")}`);

    expect(() => verify(preview, retention)).toThrow("COMMENTS_FORBIDDEN");
  });

  it("rejects automatic invocation logging", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace('"invocation_logs": false', '"invocation_logs": true'),
    );

    expect(() => verify(preview, retention)).toThrow("INVOCATION_LOGS");
  });

  it("rejects replacing the retention placeholder in the committed template", () => {
    const { preview, retention } = configurationFixtures();
    writeFileSync(
      retention,
      readFileSync(retention, "utf8").replace(
        "00000000000000000000000000000000",
        "11111111111111111111111111111111",
      ),
    );

    expect(() => verify(preview, retention)).toThrow("MAINTENANCE_BINDING_TEMPLATE");
  });
});
