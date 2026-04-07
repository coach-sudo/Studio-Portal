# Netlify Deploy Setup

Yes, you can host the full portal on Netlify, including the static frontend and the proxy function.

## What Netlify handles here

- static site hosting for the portal UI
- serverless proxy function at `/api/studio-sync`
- environment variables for the Apps Script URL and token

## Files already added

- [netlify.toml](/C:/Users/dariu/Desktop/studio-portal/netlify.toml)
- [studio-sync.js](/C:/Users/dariu/Desktop/studio-portal/netlify/functions/studio-sync.js)

## Netlify environment variables to add

- `GOOGLE_APPS_SCRIPT_URL`
  - your deployed Apps Script URL
- `GOOGLE_APPS_SCRIPT_TOKEN`
  - only if you configured a token in Apps Script

## What to put in the portal Settings page after deployment

Use:

```text
/api/studio-sync
```

or the full deployed site URL version:

```text
https://your-site.netlify.app/api/studio-sync
```

Do not use the raw Apps Script URL in the portal frontend.

## Deploy flow

1. Push this repo to GitHub
2. Import the repo into Netlify
3. Let Netlify use the included `netlify.toml`
4. Add the environment variables above
5. Deploy
6. In the portal `Settings` page:
   - set persistence mode to `Google Sheets via Backend`
   - set backend URL to `/api/studio-sync`
   - save
   - test connection
   - push snapshot

## Why this works better

- browser talks to same-origin Netlify function
- Netlify function talks to Apps Script server-side
- avoids direct browser-to-Apps-Script CORS issues
- keeps the frontend unchanged
