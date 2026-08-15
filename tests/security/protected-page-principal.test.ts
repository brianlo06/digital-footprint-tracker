import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentPrincipal: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/security/auth", () => ({
  getAuthGateway: () => ({ currentPrincipal: mocks.currentPrincipal }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requireProtectedPagePrincipal } from "@/app/(protected)/principal";

describe("protected page principal", () => {
  beforeEach(() => {
    mocks.currentPrincipal.mockReset();
    mocks.redirect.mockClear();
  });

  it("redirects a signed-out page render without an authentication exception", async () => {
    mocks.currentPrincipal.mockResolvedValue(null);

    await expect(requireProtectedPagePrincipal()).rejects.toThrow("REDIRECT:/");
  });

  it("returns the authenticated principal", async () => {
    const principal = { subject: "user_synthetic", mode: "clerk" as const };
    mocks.currentPrincipal.mockResolvedValue(principal);

    await expect(requireProtectedPagePrincipal()).resolves.toBe(principal);
  });
});
