import "server-only";
import { z } from "zod";

/**
 * SERVER-ONLY environment variables (secrets).
 * `server-only` makes the build fail if a Client Component imports this file.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

let cached: z.infer<typeof serverSchema> | undefined;

/** Validated lazily so pages that never need secrets don't require them. */
export function serverEnv() {
  cached ??= serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return cached;
}
