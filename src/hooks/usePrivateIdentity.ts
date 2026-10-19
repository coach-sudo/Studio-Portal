import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/** Private reads and local forms must change ownership when the account changes. */
export function usePrivateIdentity() {
  const [identity, setIdentity] = useState<string | null>(null);
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((_event, session) =>
      setIdentity(session?.user.id ?? null),
    );
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  return identity;
}
