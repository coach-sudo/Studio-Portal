# Google OAuth on Netlify

This portal now includes two Netlify functions for the Google OAuth handshake:

- `/api/google-oauth-start`
- `/api/google-oauth-callback`

## Required Netlify environment variables

- `GOOGLE_ACCOUNT_EMAIL`
  - `coach@d-a-j.com`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
  - `https://studio-portal.netlify.app/api/google-oauth-callback`

Optional later:

- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_LIVE_READY`
- `GOOGLE_GMAIL_LIVE_READY`

## First-time connection flow

1. Save the OAuth client env vars in Netlify.
2. Redeploy the site.
3. In the portal, open `Settings`.
4. In `Google Connections`, click `Connect Google Account`.
5. Sign in as `coach@d-a-j.com`.
6. Google will redirect back to the Netlify callback page.
7. Copy the refresh token shown there.
8. Add it to Netlify as `GOOGLE_REFRESH_TOKEN`.
9. Redeploy again.
10. Back in the portal, click `Refresh Google Status`.

## What statuses mean

- `Backend Incomplete`
  - Netlify is missing OAuth client env vars.
- `Auth Needed`
  - Netlify has OAuth client env vars, but still needs `GOOGLE_REFRESH_TOKEN`.
- `Connected`
  - Netlify can refresh a Google access token successfully.
- `Live Ready`
  - Netlify can refresh a token and the service has been marked ready for real server-side sync work.

## Important note

`Connected` means the OAuth/backend auth layer is working.
It does **not** mean the server-side Calendar event pull or Gmail message pull is finished yet.
Those live sync implementations are the next step after OAuth is confirmed.
