import { supabase } from "../lib/supabase";

/** Local review ownership only; never included in command payloads or hashes. */
export async function captureReviewActor(): Promise<string> {
  if (!supabase)
    throw Error("Sign in as the coach before reviewing this change.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user.id)
    throw Error("Sign in as the coach before reviewing this change.");
  return data.session.user.id;
}
