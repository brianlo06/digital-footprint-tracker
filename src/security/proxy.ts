import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createContentSecurityPolicy,
  createNonce,
  PRIVATE_DYNAMIC_CACHE_CONTROL,
} from "@/security/content-security-policy";

function responseWithContentSecurityPolicy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const contentSecurityPolicy = createContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("Cache-Control", PRIVATE_DYNAMIC_CACHE_CONTROL);
  return response;
}

export async function authenticationProxy(request: NextRequest, event: NextFetchEvent) {
  const authMode = process.env.AUTH_MODE ?? "local";
  if (authMode === "disabled") {
    return responseWithContentSecurityPolicy(request);
  }
  if (authMode === "local") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Local authentication is forbidden in production");
    }
    return responseWithContentSecurityPolicy(request);
  }

  if (authMode !== "clerk") throw new Error("Unsupported authentication mode");

  const { clerkMiddleware } = await import("@clerk/nextjs/server");
  const response = await clerkMiddleware({
    contentSecurityPolicy: {
      strict: true,
      directives: {
        "base-uri": ["'self'"],
        "font-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
      },
    },
  })(request, event);
  const protectedResponse = response ?? NextResponse.next();
  protectedResponse.headers.set("Cache-Control", PRIVATE_DYNAMIC_CACHE_CONTROL);
  return protectedResponse;
}
