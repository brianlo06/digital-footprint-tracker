import type { DeliveryKeyring, EncryptedEnvelope } from "@/security/crypto";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/security/crypto";

export interface DeliveryCommandPayload {
  readonly destination: string;
  readonly code: string;
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
  return encryptSensitiveValue(JSON.stringify(payload), context, keyring);
}

export function decryptDeliveryCommand(
  envelope: EncryptedEnvelope,
  context: string,
  keyring: DeliveryKeyring,
): DeliveryCommandPayload {
  return JSON.parse(decryptSensitiveValue(envelope, context, keyring)) as DeliveryCommandPayload;
}
