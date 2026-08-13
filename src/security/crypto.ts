import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const NONCE_BYTES = 12;
const DATA_KEY_BYTES = 32;

export interface EncryptionKeyring {
  readonly keyId: string;
  readonly encryptionKey: Buffer;
  readonly lookupKey: Buffer;
}

export interface DeliveryKeyring {
  readonly keyId: string;
  readonly encryptionKey: Buffer;
}

export interface EncryptedEnvelope {
  readonly version: 1;
  readonly algorithm: "A256GCM_ENVELOPE";
  readonly keyId: string;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly authTag: string;
  readonly wrappedDataKey: string;
  readonly wrapNonce: string;
  readonly wrapAuthTag: string;
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function assertKeyLength(key: Buffer, label: string): void {
  if (key.length !== DATA_KEY_BYTES) {
    throw new Error(`${label} must be exactly 32 bytes`);
  }
}

export function createKeyring(input: {
  keyId: string;
  encryptionKeyBase64: string;
  lookupKeyBase64: string;
}): EncryptionKeyring {
  const encryptionKey = Buffer.from(input.encryptionKeyBase64, "base64");
  const lookupKey = Buffer.from(input.lookupKeyBase64, "base64");
  assertKeyLength(encryptionKey, "encryptionKey");
  assertKeyLength(lookupKey, "lookupKey");

  return { keyId: input.keyId, encryptionKey, lookupKey };
}

export function createDeliveryKeyring(input: {
  keyId: string;
  encryptionKeyBase64: string;
}): DeliveryKeyring {
  const encryptionKey = Buffer.from(input.encryptionKeyBase64, "base64");
  assertKeyLength(encryptionKey, "encryptionKey");

  return { keyId: input.keyId, encryptionKey };
}

export function encryptSensitiveValue(
  plaintext: string,
  context: string,
  keyring: Pick<EncryptionKeyring, "keyId" | "encryptionKey">,
): EncryptedEnvelope {
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  const wrapNonce = randomBytes(NONCE_BYTES);
  const wrappingCipher = createCipheriv("aes-256-gcm", keyring.encryptionKey, wrapNonce);
  wrappingCipher.setAAD(Buffer.from(`keywrap:${keyring.keyId}`, "utf8"));
  const wrappedDataKey = Buffer.concat([wrappingCipher.update(dataKey), wrappingCipher.final()]);

  dataKey.fill(0);

  return {
    version: 1,
    algorithm: "A256GCM_ENVELOPE",
    keyId: keyring.keyId,
    ciphertext: encode(ciphertext),
    nonce: encode(nonce),
    authTag: encode(cipher.getAuthTag()),
    wrappedDataKey: encode(wrappedDataKey),
    wrapNonce: encode(wrapNonce),
    wrapAuthTag: encode(wrappingCipher.getAuthTag()),
  };
}

export function decryptSensitiveValue(
  envelope: EncryptedEnvelope,
  context: string,
  keyring: Pick<EncryptionKeyring, "keyId" | "encryptionKey">,
): string {
  if (envelope.version !== 1 || envelope.algorithm !== "A256GCM_ENVELOPE") {
    throw new Error("Unsupported encrypted envelope");
  }
  if (envelope.keyId !== keyring.keyId) {
    throw new Error("Required encryption key is not available");
  }

  const unwrappingCipher = createDecipheriv(
    "aes-256-gcm",
    keyring.encryptionKey,
    decode(envelope.wrapNonce),
  );
  unwrappingCipher.setAAD(Buffer.from(`keywrap:${envelope.keyId}`, "utf8"));
  unwrappingCipher.setAuthTag(decode(envelope.wrapAuthTag));
  const dataKey = Buffer.concat([
    unwrappingCipher.update(decode(envelope.wrappedDataKey)),
    unwrappingCipher.final(),
  ]);

  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, decode(envelope.nonce));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(decode(envelope.authTag));
    return Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]).toString(
      "utf8",
    );
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Rotates only the key-encryption key. The plaintext and data ciphertext are
 * never materialized during this operation; lookup-key rotation is a separate,
 * explicitly planned migration because it changes deterministic tokens.
 */
export function rewrapEncryptedEnvelope(
  envelope: EncryptedEnvelope,
  currentKeyring: EncryptionKeyring,
  nextKeyring: EncryptionKeyring,
): EncryptedEnvelope {
  if (envelope.version !== 1 || envelope.algorithm !== "A256GCM_ENVELOPE") {
    throw new Error("Unsupported encrypted envelope");
  }
  if (envelope.keyId !== currentKeyring.keyId) {
    throw new Error("Required encryption key is not available");
  }

  const unwrappingCipher = createDecipheriv(
    "aes-256-gcm",
    currentKeyring.encryptionKey,
    decode(envelope.wrapNonce),
  );
  unwrappingCipher.setAAD(Buffer.from(`keywrap:${envelope.keyId}`, "utf8"));
  unwrappingCipher.setAuthTag(decode(envelope.wrapAuthTag));
  const dataKey = Buffer.concat([
    unwrappingCipher.update(decode(envelope.wrappedDataKey)),
    unwrappingCipher.final(),
  ]);

  try {
    const wrapNonce = randomBytes(NONCE_BYTES);
    const wrappingCipher = createCipheriv("aes-256-gcm", nextKeyring.encryptionKey, wrapNonce);
    wrappingCipher.setAAD(Buffer.from(`keywrap:${nextKeyring.keyId}`, "utf8"));
    const wrappedDataKey = Buffer.concat([wrappingCipher.update(dataKey), wrappingCipher.final()]);

    return {
      ...envelope,
      keyId: nextKeyring.keyId,
      wrappedDataKey: encode(wrappedDataKey),
      wrapNonce: encode(wrapNonce),
      wrapAuthTag: encode(wrappingCipher.getAuthTag()),
    };
  } finally {
    dataKey.fill(0);
  }
}

export function createLookupToken(
  normalizedValue: string,
  namespace: string,
  keyring: Pick<EncryptionKeyring, "lookupKey">,
): string {
  return createHmac("sha256", keyring.lookupKey)
    .update(`${namespace}\u0000${normalizedValue}`, "utf8")
    .digest("base64url");
}

export function createChallengeHash(
  challenge: string,
  challengeId: string,
  keyring: Pick<EncryptionKeyring, "lookupKey">,
): string {
  return createHmac("sha256", keyring.lookupKey)
    .update(`verification\u0000${challengeId}\u0000${challenge}`, "utf8")
    .digest("base64url");
}

export function challengeMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
