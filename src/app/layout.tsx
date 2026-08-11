import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { AuthProvider } from "./ui/auth-provider";
import { AuthStatus } from "./ui/auth-ui";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Digital Footprint Tracker",
    template: "%s · Digital Footprint Tracker",
  },
  description: "A privacy-first dashboard for understanding your own public digital footprint.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Nonce-based CSP requires request-time rendering so Next.js can nonce framework scripts.
  await connection();
  const authMode =
    process.env.AUTH_MODE === "clerk"
      ? "clerk"
      : process.env.AUTH_MODE === "disabled"
        ? "disabled"
        : "local";

  return (
    <html lang="en">
      <body>
        <AuthProvider mode={authMode}>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          <header className="site-header">
            <div className="header-inner">
              <Link className="brand" href="/">
                <span aria-hidden="true" className="brand-mark">
                  ◉
                </span>
                <span>Digital Footprint Tracker</span>
              </Link>
              <nav aria-label="Primary" className="nav-links">
                <Link href="/dashboard">Overview</Link>
                <Link href="/identities">My identifiers</Link>
                <Link href="/settings/privacy">Privacy</Link>
                <AuthStatus mode={authMode} />
              </nav>
            </div>
          </header>
          <main className="page-shell" id="main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="footer">
            <div className="footer-inner">
              Foundation milestone · No scanning or external data providers are enabled.
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
