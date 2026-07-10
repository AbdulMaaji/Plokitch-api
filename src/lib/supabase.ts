import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
// Prefer a service role key for server-side uploads; fall back to anon if not provided.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
}

export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
