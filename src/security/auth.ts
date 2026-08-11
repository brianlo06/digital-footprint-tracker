import { getServerEnv } from "@/config/server-env";

export interface AuthenticatedPrincipal {
  readonly subject: string;
  readonly mode: "local" | "clerk";
}

export interface AuthGateway {
  currentPrincipal(): Promise<AuthenticatedPrincipal | null>;
  deletePrincipal(subject: string): Promise<void>;
}

export class LocalDevelopmentAuthGateway implements AuthGateway {
  constructor(
    private readonly subject: string,
    private readonly nodeEnv: string,
  ) {
    if (nodeEnv === "production") {
      throw new Error("Local development authentication is forbidden in production");
    }
  }

  async currentPrincipal(): Promise<AuthenticatedPrincipal> {
    return { subject: this.subject, mode: "local" };
  }

  async deletePrincipal(): Promise<void> {
    // Local mode has no external account to delete.
  }
}

export class ClerkAuthGateway implements AuthGateway {
  async currentPrincipal(): Promise<AuthenticatedPrincipal | null> {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    return userId ? { subject: userId, mode: "clerk" } : null;
  }

  async deletePrincipal(subject: string): Promise<void> {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    await client.users.deleteUser(subject);
  }
}

export function getAuthGateway(): AuthGateway {
  const env = getServerEnv();
  if (env.AUTH_MODE === "clerk") return new ClerkAuthGateway();
  return new LocalDevelopmentAuthGateway(env.LOCAL_AUTH_SUBJECT, env.NODE_ENV);
}

export async function requirePrincipal(): Promise<AuthenticatedPrincipal> {
  const principal = await getAuthGateway().currentPrincipal();
  if (!principal) throw new Error("AUTHENTICATION_REQUIRED");
  return principal;
}
