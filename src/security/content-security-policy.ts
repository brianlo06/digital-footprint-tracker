const directive = (name: string, values: string[]) => `${name} ${values.join(" ")}`;

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function createContentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  const directives = [
    directive("default-src", ["'self'"]),
    directive("script-src", [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ]),
    // The Next.js development font/runtime injects an unnonced style element.
    directive(
      "style-src",
      isDevelopment ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    ),
    // Next.js' accessibility route announcer positions itself with a style attribute.
    directive("style-src-attr", ["'unsafe-inline'"]),
    directive("img-src", ["'self'", "blob:", "data:"]),
    directive("font-src", ["'self'"]),
    directive("connect-src", ["'self'", ...(isDevelopment ? ["ws:"] : [])]),
    directive("object-src", ["'none'"]),
    directive("base-uri", ["'self'"]),
    directive("form-action", ["'self'"]),
    directive("frame-ancestors", ["'none'"]),
  ];

  if (!isDevelopment) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
