import { z } from "zod";

/**
 * PUBLIC environment variables: safe for the browser.
 * Each variable is referenced literally (process.env.NEXT_PUBLIC_…) so Next.js
 * can inline it into client bundles. Never add secrets here; see env.server.ts.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
