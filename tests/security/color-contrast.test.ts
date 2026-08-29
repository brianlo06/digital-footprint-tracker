import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA contrast is a product requirement in `docs/PRODUCT.md`, and a
 * palette edit is exactly the kind of change that silently breaks it. These
 * ratios are computed from the committed stylesheet rather than hardcoded, so
 * changing a custom property fails here instead of in a user's browser.
 */
const stylesheet = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function customProperty(name: string): string {
  const match = stylesheet.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`custom property --${name} is missing from globals.css`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const surface = () => customProperty("surface");
const panel = () => customProperty("panel");

describe("WCAG 2.2 AA colour contrast", () => {
  it.each([
    ["ink", "surface"],
    ["ink", "panel"],
    ["muted", "surface"],
    ["muted", "panel"],
  ])("keeps %s text on %s at 4.5:1 or better", (foreground, background) => {
    expect(
      contrastRatio(customProperty(foreground), customProperty(background)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps brand button text readable in both directions", () => {
    expect(contrastRatio("#ffffff", customProperty("brand"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(customProperty("brand"), panel())).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["warning", "warning-soft"],
    ["danger", "danger-soft"],
    ["brand-dark", "brand-soft"],
  ])("keeps %s notice text on %s at 4.5:1 or better", (foreground, background) => {
    expect(
      contrastRatio(customProperty(foreground), customProperty(background)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // SC 1.4.11 Non-text Contrast: the focus indicator and a field's own border
  // must stay distinguishable from every surface they sit on.
  it.each([
    ["focus", surface],
    ["focus", panel],
    ["field-border", surface],
    ["field-border", panel],
  ])("keeps the %s indicator at 3:1 against its background", (foreground, background) => {
    expect(contrastRatio(customProperty(foreground), background())).toBeGreaterThanOrEqual(3);
  });

  it("keeps the focus ring visible on the inverted skip link", () => {
    expect(contrastRatio(customProperty("focus"), customProperty("ink"))).toBeGreaterThanOrEqual(3);
  });
});
