import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  getServerEnv: vi.fn(() => ({ CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test" })),
  resumeAccountDeletionAfterAuthRevoked: vi.fn(),
}));

vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: mocks.verifyWebhook }));
vi.mock("@/config/server-env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/privacy/deletion-service", () => ({
  resumeAccountDeletionAfterAuthRevoked: mocks.resumeAccountDeletionAfterAuthRevoked,
}));

import { POST } from "@/app/api/webhooks/clerk/route";

function request(headers?: HeadersInit, body = "{}"): NextRequest {
  return new NextRequest("https://dft.example.test/api/webhooks/clerk", {
    method: "POST",
    headers,
    body,
  });
}

describe("Clerk deletion webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    mocks.getServerEnv.mockReturnValue({ CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test" });
  });

  it("is unavailable unless Clerk authentication is enabled", async () => {
    vi.stubEnv("AUTH_MODE", "disabled");

    expect((await POST(request())).status).toBe(404);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without processing data", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    mocks.verifyWebhook.mockRejectedValue(new Error("bad signature"));

    expect((await POST(request())).status).toBe(400);
    expect(mocks.verifyWebhook).toHaveBeenCalledWith(expect.any(NextRequest), {
      signingSecret: "whsec_test",
    });
    expect(mocks.resumeAccountDeletionAfterAuthRevoked).not.toHaveBeenCalled();
  });

  it("requests retry when its signing configuration is unavailable", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    mocks.getServerEnv.mockImplementation(() => {
      throw new Error("missing secret");
    });

    expect((await POST(request())).status).toBe(503);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
  });

  it("acknowledges unrelated signed events without changing deletion state", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: { id: "user_abc123" } });

    expect((await POST(request())).status).toBe(204);
    expect(mocks.resumeAccountDeletionAfterAuthRevoked).not.toHaveBeenCalled();
  });

  it("finishes local deletion for a signed user.deleted event", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    mocks.verifyWebhook.mockResolvedValue({ type: "user.deleted", data: { id: "user_abc123" } });
    mocks.resumeAccountDeletionAfterAuthRevoked.mockResolvedValue({ receiptId: "receipt" });

    expect((await POST(request())).status).toBe(204);
    expect(mocks.resumeAccountDeletionAfterAuthRevoked).toHaveBeenCalledWith("user_abc123");
  });

  it("rejects malformed deleted-user events", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    mocks.verifyWebhook.mockResolvedValue({ type: "user.deleted", data: { id: null } });

    expect((await POST(request())).status).toBe(400);
    expect(mocks.resumeAccountDeletionAfterAuthRevoked).not.toHaveBeenCalled();
  });

  it("requests retry when local deletion is temporarily unavailable", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    mocks.verifyWebhook.mockResolvedValue({ type: "user.deleted", data: { id: "user_abc123" } });
    mocks.resumeAccountDeletionAfterAuthRevoked.mockRejectedValue(new Error("database outage"));

    expect((await POST(request())).status).toBe(503);
  });

  it("rejects an oversized declared payload before signature verification", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");

    const response = await POST(request({ "content-length": String(64 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed payload without a declared length", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");

    const response = await POST(request(undefined, "x".repeat(64 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
  });
});
