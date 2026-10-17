# Wave 1 candidate exact-host staging Auth update

October 17, 2026 (Eastern). **Authorized staging Auth update completed. Production remains NO-GO.**

## Target and dependency

This documentation-only checkpoint is directly based on draft PR #51, `codex/wave-one-candidate-deployment`, at **`91c47042f1c5a3da2e83c58f6321c708aa546baf`**. Its source is [the reviewed candidate procedure](wave-one-staging-release-candidate.md), [PR #51's deployment evidence](wave-one-candidate-deployment.md), and the user's explicit authorization to change only the staging Site URL and redirect allowlist.

| Target                       | Verified identity                                        |
| ---------------------------- | -------------------------------------------------------- |
| Supabase                     | `lrxrivfqjpkvygozphoz`, `coachd-staging`, active/healthy |
| Netlify staging site         | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`                   |
| Protected deployment         | `6ad39275e099502cb54a8f64`                               |
| Application                  | `830c762bdaf085f5e20a91f4e6a7afbef4afa627`               |
| Deployment status            | Ready, `deploy-preview`, `published_at=null`             |
| Existing staging publication | `6ace53e7f850061d7c49b711`, unchanged                    |

The supported Netlify project connector confirmed team-login protection still applies to all staging deployments. An anonymous health request returned 401. A fresh health read using the existing normal Netlify team session returned `ok`, commit `830c762bdaf0`, context `deploy-preview`, at `2026-10-17T15:58:54.937Z`. No Coach'D role login or browser acceptance journey was performed. The 23 immutable function digests still matched PR #51's artifact evidence.

## Before and after

Before Site URL:

```text
https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app
```

Before redirect allowlist:

```text
https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app/auth/callback
https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app/auth/callback\?**
```

Final Site URL:

```text
https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app
```

Final redirect allowlist, exactly two entries:

```text
https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app/auth/callback
https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app/auth/callback\?**
```

There are no old-host, localhost, production, arbitrary-preview or additional callback entries. The host and callback path are exact. Only the query suffix uses the approved `**` pattern.

## Reviewed minimal configuration and execution

The existing `scripts/staging/prepare-auth-config.mjs` helper generated the external minimal config from a sanitized, freshly verified deployment receipt and the explicit full candidate SHA. The helper's historical default pin was not used. Its three local tests passed.

```toml
project_id = "studio-portal-staging-auth"

[auth]
site_url = "https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app"
additional_redirect_urls = ["https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app/auth/callback", "https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app/auth/callback\\?**"]
```

`project_id` is local CLI metadata. The only declared remote properties are `auth.site_url` and `auth.additional_redirect_urls`. TOML's `\\` decodes to one literal backslash; the installed CLI parsed the second entry as `callback\?**`. Supabase's [current redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls) defines backslash escaping for a literal glob character, so `\?` represents the query delimiter rather than a single-character wildcard. No hosted sign-in, redirect, OTP or email flow was invoked to test the pattern.

The existing Supabase CLI **2.117.0** was used without upgrading. Its current `config push --help` explicitly states that undeclared properties are preserved and recommends `config diff` before a noninteractive push. The [current CLI reference](https://supabase.com/docs/reference/cli/supabase-config-push), redirect guide and changelog were checked. The installed CLI's diff/help supplies the more specific partial-config behavior. The recent TLS cipher notice does not change this Management API workflow.

The CLI rejected the legacy `--output json` option for `config diff` before any change; the supported option is **`--output-format json`**. After correcting that local command invocation, live diff review passed. No remote mutation was attempted by the rejected read-only invocation.

The old-value probe had zero updates. The desired config diff had **exactly two updates**, zero local-only properties, nine unchanged undeclared remote-only properties and unchanged unmanaged settings. Both updates were declared and matched the approved before/after values. A fresh Management API read still matched the complete saved preflight configuration immediately before the push, and the CLI diff was checked again.

Executed once, using the existing authorized management credential without printing or storing it in Git:

```text
supabase config push --project-ref lrxrivfqjpkvygozphoz --workdir PRIVATE_MINIMAL_CONFIG_DIRECTORY --yes --output-format json
```

The explicit 20-letter project reference targeted the staging project directly; no repository link or branch alias was used. The repository's full development config was never pushed. A private exclusive attempt marker, config digest, reviewed diff, CLI output and full before/after Auth responses remain outside Git under Owner/SYSTEM access restrictions. There was no second push, direct database setting update, credential rotation or permission expansion.

## Independent verification and preserved data

[Sanitized evidence](wave-one-candidate-auth.json) records the exact values, scope and preservation checks.

- Independent Management API GET read-back found **exactly** `site_url` and `uri_allow_list` changed. These correspond to the two authorized CLI properties. All **241 unrelated Auth properties** are deeply equal before and after, including existing OAuth, SMTP, hooks, templates, JWT and security settings.
- CLI diff against the desired config reports **zero updates and zero local-only properties**. The old-value probe reports exactly the two expected differences. Undeclared remote-only and unmanaged values remain equal to the preflight snapshot.
- All four existing manual accounts—coach, student, guardian and unrelated—remain confirmed and intact. Full `auth.users` row digests match their before snapshots; no passwords or sessions were displayed, reset or created.
- All **57 migration history rows**, including their stored contents, have the same before/after digest and match repository version/name identities.
- Before/after verified-TLS, read-only repeatable-read business checks preserve the accepted schema seal and every original/retained record: **215 rows across 76 tables**, including all **37 original rows**. The completed H01–H16 journal remains unchanged; no executor or worker was invoked.
- Netlify's existing staging publication and protected deployment remain unchanged. Builds remain stopped, with no new deployment or application publication.

The only hosted change was this authorized Auth URL configuration update. No production configuration was accessed or modified. No application role sign-in, hosted business mutation, fixture, H01–H16 rerun, provider request, invitation, OTP, reset, email, scheduled-worker invocation, merge or Wave 2 work occurred.

**Final result: PASS.** Browser acceptance and application logins remain a separate authorization boundary. No claim of completed hosted browser acceptance is made by this configuration checkpoint.
