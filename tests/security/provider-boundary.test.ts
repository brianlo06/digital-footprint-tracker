import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const providersRoot = join(process.cwd(), "src", "providers");

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

describe("closed provider boundary", () => {
  it("contains no network client, live endpoint, or provider credential access", () => {
    const forbiddenPatterns = [
      /\bfetch\s*\(/,
      /https?\.request\s*\(/,
      /from\s+["'](?:axios|got|undici)["']/,
      /from\s+["']node:https?["']/,
      /hibp-api-key/i,
      /haveibeenpwned\.com\/api/i,
      /BREACH_API_KEY/,
      /process\.env/,
    ];

    for (const path of sourceFiles(providersRoot)) {
      const source = readFileSync(path, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(source, `${relative(process.cwd(), path)} matched ${String(pattern)}`).not.toMatch(
          pattern,
        );
      }
    }
  });
});
