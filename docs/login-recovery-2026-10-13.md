# Login and recovery

The production Supabase Auth logs on October 13, 2026 show Google callback failures with `invalid_client` and `The provided client secret is invalid.` The previous callback page described all coach failures as requiring the studio coach account, hiding this provider configuration failure. Existing sessions can continue to work while fresh Google logins fail.

The login changes add:

- Coach email/password login using the existing identity and verified studio access.
- Student email/password login alongside existing portal usernames.
- Show/hide password controls for login and password creation.
- Set/reset password emails that return through the existing authentication callback, then open password creation for either role.
- Clear errors for provider failures, expired links, authorization failures, and temporary service outages.

Email authentication is enabled on production. The existing coach identity has a verified email and a password; no new account or database migration is needed. The account owner can use their existing portal password or request a reset after release.

## Google configuration repair

The source changes do not replace the invalid Google OAuth secret. The account owner must provide a current secret from the Google Cloud OAuth web client used for Supabase login and save it under the Google provider in [Supabase Auth sign-in settings](https://supabase.com/dashboard/project/htwthzshhilrjtqwprlo/auth/sign-in-providers). The provider client ID must match that secret. Its Google authorized redirect URI must include `https://htwthzshhilrjtqwprlo.supabase.co/auth/v1/callback`.

After repair, verify Google login in a fresh Chrome session using the coach account. Retest existing desktop and phone sessions. Do not change the independent Google Calendar/Gmail integration credentials as a substitute for fixing Supabase's Google provider.

## Release verification

Publish through the repository's protected `main` workflow, following [release safety](release-safety.md). Confirm the allowed Supabase redirect URLs cover the deployed `/auth/callback` URL including return and recovery query parameters, and verify password email delivery.

Use a coach recovery link to set a password, then sign in from a fresh Chrome session with email/password. Also verify a student username login, student email login, show/hide controls, expired recovery links, and denied access for an account without a studio role.
