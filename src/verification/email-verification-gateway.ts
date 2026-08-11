import "server-only";

import { getServerEnv } from "@/config/server-env";
import { createChallengeHash, type EncryptionKeyring } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";

export interface EmailVerificationChallenge {
  readonly method: string;
  readonly challengeHash: string;
  readonly expiresAt: Date;
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
      readonly authMode: "local" | "clerk";
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
