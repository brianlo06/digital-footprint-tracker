import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const loggerPath = join(sourceRoot, "security", "logger.ts");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts") || path.endsWith(".tsx")
        ? [path]
        : [];
  });
}

describe("closed telemetry boundary", () => {
  it("routes application logging through the centralized sanitizer", () => {
    const forbiddenPatterns = [
      /\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/,
      /\bprocess\.(?:stderr|stdout)\./,
      /from\s+["'](?:@sentry\/|@opentelemetry\/|dd-trace|newrelic)/,
    ];

    for (const path of sourceFiles(sourceRoot)) {
      if (path === loggerPath) continue;

      const source = readFileSync(path, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(source, `${relative(process.cwd(), path)} matched ${String(pattern)}`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it("keeps automatic invocation logs and application traces disabled", () => {
    const config = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");

    expect(config).toMatch(/"invocation_logs"\s*:\s*false/);
    expect(config).toMatch(/"traces"\s*:\s*\{\s*"enabled"\s*:\s*false/);
  });
});
