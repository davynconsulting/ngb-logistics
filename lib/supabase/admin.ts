import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "./database.types";

/**
 * SERVICE-ROLE client: BYPASSES Row Level Security.
 *
 * Only for tightly scoped server tasks (inviting users, background jobs,
 * provider webhooks) after the caller's permission has been checked.
 * Never use it to read data on behalf of a user, and never import it
 * from client code (`server-only` enforces this at build time).
 */
export function createAdminClient() {
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
