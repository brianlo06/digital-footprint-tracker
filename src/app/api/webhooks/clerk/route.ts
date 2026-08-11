import type { WebhookEvent } from "@clerk/nextjs/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";

import { getServerEnv } from "@/config/server-env";
import { resumeAccountDeletionAfterAuthRevoked } from "@/privacy/deletion-service";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const CLERK_USER_ID = /^user_[A-Za-z0-9_-]+$/;

export const runtime = "nodejs";

function deletedUserSubject(event: WebhookEvent): string | null {
  if (event.type !== "user.deleted") return null;

  const subject = event.data.id;
  if (typeof subject !== "string" || subject.length > 128 || !CLERK_USER_ID.test(subject)) {
    throw new Error("INVALID_CLERK_DELETED_USER_EVENT");
  }

  return subject;
}

async function payloadExceedsLimit(request: NextRequest): Promise<boolean> {
  const reader = request.clone().body?.getReader();
  if (!reader) return false;

  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return false;
    bytes += value.byteLength;
    if (bytes > MAX_WEBHOOK_BYTES) {
      // Do not await cancellation of a cloned/teed body: the platform can wait
      // for the unread verification branch and deadlock this early rejection.
      void reader.cancel();
      return true;
    }
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.AUTH_MODE !== "clerk") {
    return new Response("Not found", { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  if (await payloadExceedsLimit(request)) {
    return new Response("Payload too large", { status: 413 });
  }

  let signingSecret: string;
  try {
    const configuredSecret = getServerEnv().CLERK_WEBHOOK_SIGNING_SECRET;
    if (!configuredSecret) throw new Error("CLERK_WEBHOOK_SIGNING_SECRET_REQUIRED");
    signingSecret = configuredSecret;
  } catch {
    return new Response("Webhook processing unavailable", { status: 503 });
  }

  let event: WebhookEvent;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return new Response("Invalid webhook", { status: 400 });
  }

  let subject: string | null;
  try {
    subject = deletedUserSubject(event);
  } catch {
    return new Response("Invalid webhook event", { status: 400 });
  }

  if (!subject) return new Response(null, { status: 204 });

  try {
    await resumeAccountDeletionAfterAuthRevoked(subject);
    return new Response(null, { status: 204 });
  } catch {
    // A retryable status lets Clerk redeliver after transient database errors.
    return new Response("Webhook processing unavailable", { status: 503 });
  }
}
