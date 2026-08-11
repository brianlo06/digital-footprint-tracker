import { createHmac } from "node:crypto";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

const secretBytes = Buffer.alloc(32, 73);
const signingSecret = `whsec_${secretBytes.toString("base64")}`;
const webhookId = "msg_synthetic_clerk_deletion";
const payload = JSON.stringify({
  type: "user.deleted",
  data: { id: "user_synthetic123", object: "user", deleted: true },
});

function signedRequest(body: string, signedBody = body, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secretBytes)
    .update(`${webhookId}.${timestamp}.${signedBody}`)
    .digest("base64");

  return new NextRequest("https://dft.example.test/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}

describe("installed Clerk webhook verifier", () => {
  it("accepts an authentic current user.deleted payload", async () => {
    const event = await verifyWebhook(signedRequest(payload), { signingSecret });

    expect(event.type).toBe("user.deleted");
    expect(event.data.id).toBe("user_synthetic123");
  });

  it("rejects a payload changed after signing", async () => {
    const changedPayload = payload.replace("user_synthetic123", "user_attacker999");

    await expect(
      verifyWebhook(signedRequest(changedPayload, payload), { signingSecret }),
    ).rejects.toThrow();
  });

  it("rejects a correctly signed event outside the timestamp tolerance", async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;

    await expect(
      verifyWebhook(signedRequest(payload, payload, tenMinutesAgo), { signingSecret }),
    ).rejects.toThrow();
  });
});
