import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import { getServerEnv } from "@/config/server-env";
import {
  createChallengeHash,
  type DeliveryKeyring,
  type EncryptedEnvelope,
  type EncryptionKeyring,
} from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { deliveryEncryptionContext, encryptDeliveryCommand } from "./delivery-envelope";

export interface EmailVerificationChallenge {
  readonly method: string;
  readonly challengeHash: string;
  readonly expiresAt: Date;
  readonly delivery?: {
    readonly deliveryId: string;
    readonly channel: "EMAIL";
    readonly template: string;
    readonly encryptedPayload: EncryptedEnvelope;
  };
}

export interface EmailVerificationGateway {
  issueEmailChallenge(input: {
    readonly verificationId: string;
    readonly destination: string;
  }): Promise<EmailVerificationChallenge>;
}

export class LocalFakeEmailVerificationGateway implements EmailVerificationGateway {
  constructor(
    private readonly configuration: {
      readonly appEnv: "local" | "preview" | "production";
      readonly authMode: "disabled" | "local" | "clerk";
      readonly code: string;
    },
    private readonly keyring: Pick<EncryptionKeyring, "lookupKey">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueEmailChallenge(input: {
    readonly verificationId: string;
    readonly destination: string;
  }): Promise<EmailVerificationChallenge> {
    if (this.configuration.appEnv !== "local" || this.configuration.authMode !== "local") {
      throw new Error("EMAIL_VERIFICATION_PROVIDER_NOT_CONFIGURED");
    }

    // Local evaluation deliberately sends nothing and does not retain the
    // destination. A future delivery implementation must preserve this DTO.
    void input.destination;
    return {
      method: "LOCAL_FAKE_CODE",
      challengeHash: createChallengeHash(
        this.configuration.code,
        input.verificationId,
        this.keyring,
      ),
      expiresAt: new Date(this.now().getTime() + 15 * 60 * 1_000),
    };
  }
}

/**
 * Demonstrates the ADR 0017 outbox path against a synthetic no-op provider.
 * Not wired into getEmailVerificationGateway() - constructed directly only
 * by tests exercising the outbox until a real provider is approved.
 */
export class OutboxEmailVerificationGateway implements EmailVerificationGateway {
  constructor(
    private readonly configuration: {
      readonly appEnv: "local" | "preview" | "production";
      readonly authMode: "disabled" | "local" | "clerk";
    },
    private readonly keyring: Pick<EncryptionKeyring, "lookupKey">,
    private readonly deliveryKeyring: DeliveryKeyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueEmailChallenge(input: {
    readonly verificationId: string;
    readonly destination: string;
  }): Promise<EmailVerificationChallenge> {
    if (this.configuration.appEnv !== "local" || this.configuration.authMode !== "local") {
      throw new Error("EMAIL_VERIFICATION_PROVIDER_NOT_CONFIGURED");
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const deliveryId = randomUUID();
    const channel = "EMAIL" as const;
    const template = "EMAIL_VERIFICATION_CODE_V1";
    const context = deliveryEncryptionContext({
      deliveryId,
      verificationId: input.verificationId,
      channel,
      template,
    });
    const encryptedPayload = encryptDeliveryCommand(
      { destination: input.destination, code },
      context,
      this.deliveryKeyring,
    );

    return {
      method: "EMAIL_OUTBOX_CODE",
      challengeHash: createChallengeHash(code, input.verificationId, this.keyring),
      expiresAt: new Date(this.now().getTime() + 15 * 60 * 1_000),
      delivery: { deliveryId, channel, template, encryptedPayload },
    };
  }
}

export function getEmailVerificationGateway(): EmailVerificationGateway {
  const env = getServerEnv();
  return new LocalFakeEmailVerificationGateway(
    {
      appEnv: env.APP_ENV,
      authMode: env.AUTH_MODE,
      code: env.LOCAL_VERIFICATION_CODE,
    },
    getApplicationKeyring(),
  );
}
