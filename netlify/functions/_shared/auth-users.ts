import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function findAuthUserByEmail(
  db: SupabaseClient,
  email: string,
): Promise<User | undefined> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === target,
    );
    if (match) return match;
    if (data.users.length < perPage) return undefined;
  }
  throw new Error("AUTH_DIRECTORY_LIMIT: User lookup exceeded 20,000 accounts.");
}
