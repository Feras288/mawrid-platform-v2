"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        const locale = window.location.pathname.split("/")[1] === "en" ? "en" : "ar";
        window.location.href = `/${locale}/two-factor`;
      },
    }),
  ],
});
