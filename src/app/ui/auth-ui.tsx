"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";

export function AuthStatus({ mode }: { mode: "local" | "clerk" }) {
  if (mode === "local") return <span className="auth-note">Local developer</span>;

  return <ClerkAuthStatus />;
}

function ClerkAuthStatus() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <span className="auth-note">Checking session</span>;

  return isSignedIn ? (
    <UserButton />
  ) : (
    <SignInButton mode="modal">
      <button type="button">Sign in</button>
    </SignInButton>
  );
}
