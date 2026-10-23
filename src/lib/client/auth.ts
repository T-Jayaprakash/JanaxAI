"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";

/** Browser side of accounts: email codes, Google, sessions and workspaces. */
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), organizationClient()],
});
