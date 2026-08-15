import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import ProtectedLayout from "@/app/(protected)/layout";

describe("protected layout authentication", () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    mocks.currentPrincipal.mockReset();
    mocks.redirect.mockClear();
  });

  afterEach(() => {
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("keeps the hosted no-data preview behind its public boundary", async () => {
    process.env.AUTH_MODE = "disabled";

    await expect(ProtectedLayout({ children: "protected" })).rejects.toThrow("REDIRECT:/preview");
    expect(mocks.currentPrincipal).not.toHaveBeenCalled();
  });

  it("redirects an ordinary signed-out request without throwing an auth error", async () => {
    process.env.AUTH_MODE = "clerk";
    mocks.currentPrincipal.mockResolvedValue(null);

    await expect(ProtectedLayout({ children: "protected" })).rejects.toThrow("REDIRECT:/");
    expect(mocks.currentPrincipal).toHaveBeenCalledOnce();
  });

  it("renders protected content for the authenticated principal", async () => {
    process.env.AUTH_MODE = "clerk";
    mocks.currentPrincipal.mockResolvedValue({ subject: "user_synthetic", mode: "clerk" });

    await expect(ProtectedLayout({ children: "protected" })).resolves.toBe("protected");
  });
});
