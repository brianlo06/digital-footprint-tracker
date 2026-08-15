import type { DeliveryKeyring, EncryptedEnvelope } from "@/security/crypto";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/security/crypto";
import { z } from "zod";

export interface DeliveryCommandPayload {
  readonly destination: string;
  readonly code: string;
}

const deliveryCommandSchema = z
  .object({
    destination: z
      .string()
      .email()
      .max(254)
      .refine((value) => value === value.trim() && value === value.toLowerCase()),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

function parseDeliveryCommand(payload: unknown): DeliveryCommandPayload {
  const parsed = deliveryCommandSchema.safeParse(payload);
  if (!parsed.success) throw new Error("DELIVERY_COMMAND_INVALID");
  return parsed.data;
}

export function deliveryEncryptionContext(input: {
  readonly deliveryId: string;
  readonly verificationId: string;
  readonly channel: string;
  readonly template: string;
}): string {
  return `delivery:${input.deliveryId}:${input.verificationId}:${input.channel}:${input.template}:v1`;
}

export function encryptDeliveryCommand(
  payload: DeliveryCommandPayload,
  context: string,
  keyring: DeliveryKeyring,
): EncryptedEnvelope {
  return encryptSensitiveValue(JSON.stringify(parseDeliveryCommand(payload)), context, keyring);
}

export function decryptDeliveryCommand(
  envelope: EncryptedEnvelope,
  context: string,
  keyring: DeliveryKeyring,
): DeliveryCommandPayload {
  let plaintext: string;
  try {
    plaintext = decryptSensitiveValue(envelope, context, keyring);
  } catch {
    throw new Error("DELIVERY_COMMAND_DECRYPT_FAILED");
  }

  try {
    return parseDeliveryCommand(JSON.parse(plaintext));
  } catch {
    throw new Error("DELIVERY_COMMAND_INVALID");
  }
}
