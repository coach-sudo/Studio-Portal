# Exact-host staging Auth configuration and private test credentials

October 16, 2026 (Eastern). **PASS: the authorized staging Auth URL update is installed and read back.** Existing synthetic credentials are available in a restricted local handoff file. No application sign-in was performed. Production remains NO-GO.

This follows the [one authorized protected draft](wave-one-staging-draft-deployment.md). The user's subsequent authorization permitted only its exact-host Supabase Auth URL properties, read-only account verification, a private credentials handoff and this checkpoint update. It did not permit another deployment, publication, Auth-provider/SMTP changes, messages, fixtures or acceptance mutations.

## Verified target and final live values

Supabase: **`lrxrivfqjpkvygozphoz`** / coachd-staging, active and healthy. Netlify site **`d83ff6cb-f57b-4741-8c3c-3eaae7adab19`**, deployment **`6ad23d4f8b10c10447224155`**, independently reverified ready, deploy-preview, unpublished and protected by team login for all deployments. All 23 deployed function identities still match the evidence for application **`0b18a5a2238daa49bec1290f5884d5792f4aefc9`**. No browser or application authentication request was needed for this verification.

Final **Site URL**:

```text
https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app
```

Final **redirect allowlist**, exactly two entries:

```text
https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app/auth/callback
https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app/auth/callback\?**
```

The second live string contains **one** backslash before `?`. Supabase documents `\c` as matching the literal character and `**` as matching a suffix; this permits query parameters on the exact callback. The hostname/path are not wildcarded. The TOML double-quoted representation uses two backslashes so the parsed live value contains one. No localhost, production, base staging host, arbitrary preview host or broad host/path wildcard is allowed. [Supported Supabase wildcard syntax](https://supabase.com/docs/guides/auth/redirect-urls).

## Change and readback evidence

Pinned CLI **2.117.0** help explicitly states that config push applies only properties declared by the local file and preserves undeclared properties. No CLI upgrade was performed. The reviewed `scripts/staging/prepare-auth-config.mjs` accepted an external copy of the verified real deploy receipt and generated a minimal external `supabase/config.toml`: local project label plus only `auth.site_url` and `auth.additional_redirect_urls`.

The task directory is outside Git under `C:/Users/dariu/.codex/private/studio-portal-staging/auth-20261016`, inheriting the protected user/SYSTEM directory ACL. The repository's complete local-development configuration was never pushed.

Before mutation, live CLI diff against the old-value probe confirmed Site URL `http://localhost:3000` and empty redirects. The proposed minimal config produced **exactly two updates**, zero local-only properties and nine existing remote-only properties. Typed assertions verified the exact approved URLs, parsed escape character, target ref and config hash before push.

The authorized command was:

```text
supabase config push --project-ref lrxrivfqjpkvygozphoz --workdir PRIVATE_MINIMAL_CONFIG_DIRECTORY --output-format json
```

One push completed with exit 0. The result reports **only Auth updated**, with exactly the two URL-property changes; all other services were unchanged or skipped. Unsupported, forced and unencodable change lists are empty. No invitation, reset, OTP, sign-in or provider operation was invoked.

Two subsequent **live** read-only diffs established the result:

- Against desired config: **0 updates, 0 local-only**, nine remote-only properties left undeclared.
- Against the old-value probe: exactly the two URL properties differ; their **remote** values exactly match the approved Site URL and two redirect strings above. This proves readback rather than merely echoing the submitted file.
- All nine unrelated remote-only paths and values compare equal before/after: email confirmation/frequency/OTP settings, TOTP enrollment/verification, SMS Twilio enablement, pooler sizes and vector-storage enablement. Their comparison hash is recorded without exposing their values. Undeclared SMTP/OAuth/provider settings were not submitted for change.

Readback completed at **11:42:54 a.m. Eastern** (`2026-10-16T15:42:54.618Z`). **Unexpected changes: none found.** The [sanitized verification evidence](wave-one-staging-auth-configuration.json) contains approved URLs, result counts, preservation evidence and account/ACL status. Private raw CLI responses and credential material remain outside the repository.

## Existing accounts and credential handoff

Read-only SQL against staging Auth and the existing application relationships confirmed:

| Account   | Verification                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach     | Existing confirmed, not deleted/banned; coach membership in the intended synthetic studio                                                                                                    |
| Student   | Existing confirmed, not deleted/banned; student membership and portal-enabled synthetic student in that studio                                                                               |
| Guardian  | Existing confirmed, not deleted/banned; guardian membership and portal-enabled contact linked to the same student; schedule/work/finance permissions present, contact notifications disabled |
| Unrelated | Existing confirmed, not deleted/banned; **no memberships, students or guardian relationships**; retained solely for access-denial testing                                                    |

The source is the existing PR #45 restricted `synthetic-credentials.json`, not a new account or reset. Account IDs/emails in that source were checked against the live rows. Passwords were copied in memory directly to the private handoff and checked locally without printing them. Password validity was not tested by sign-in; no password hash or session token was requested. No account, role, relationship or permission was changed.

Handoff file:

```text
C:\Users\dariu\.codex\private\studio-portal-staging\staging-test-logins.txt
```

It contains role-specific login URLs, email addresses and **existing** passwords for all four accounts, with unrelated clearly marked for denial testing. Its protected NTFS ACL grants access only to **DJHOMEOFFICE\dariu** and **NT AUTHORITY\SYSTEM**, with inheritance disabled; the parent directory is restricted too. The original source file retains its owner/SYSTEM ACL. The handoff file is outside Git and was not opened in a Codex preview, committed, uploaded or printed.

To open it locally, press **Win+R** and enter:

```text
notepad "C:\Users\dariu\.codex\private\studio-portal-staging\staging-test-logins.txt"
```

Complete the ordinary Netlify team-login gate using the existing Netlify account first. The synthetic emails/passwords belong in the subsequent Coach’D form, not the Netlify team login. The file uses `/coach/login` for the coach and `/login` for the other accounts; it includes safe account-switching instructions. Synthetic example.test addresses do not receive email links or resets.

## Readiness and stop

The URL configuration and four verified existing identities are ready for the user's manual sign-in. Agent-run protected coach/student/guardian first-login checks are **ready for separate authorization**, subject to establishing the normal Netlify perimeter session in that specific test browser. The in-app browser session from deployment verification does not prove a Playwright session. No new deployment is required for these URL settings.

First-login behavior, password acceptance and role journeys remain untested in this run. Full hosted fixture/financial/bulk acceptance, provider testing, accessibility/responsive journeys and any alternate query-mode deployment retain their separate gates. No hosted application/browser test was run.

Formatting, credential scanning and whitespace checks passed. An additional in-memory comparison confirmed that none of the four existing passwords appears in any changed/untracked repository checkpoint file; no credential value was printed by that check.

No deployed application code, migrations, SMTP/OAuth/providers, passwords, existing portal roles or record permissions changed; Netlify protection remains intact. No deployment/publication, worker invocation/activation, fixture, payment, booking, bulk mutation, real message, merge, production access or Wave 2 work occurred. Documentation-only updates remain on draft PR #46's dependent branch with `[skip netlify]`. **Stop after this checkpoint; production remains NO-GO.**
