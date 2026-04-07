# Google Sheets Backend Plan

The portal should not call Google Apps Script directly from the browser in production.

Why:

- browser `fetch()` requests to Apps Script often run into CORS restrictions
- the same backend will later need to talk to Google Calendar and Gmail securely
- admin tokens and Google auth belong on the server side, not in frontend requests

## Recommended architecture

1. Portal frontend
- calls your backend/proxy endpoint

2. Backend/proxy
- accepts `ping`, `snapshot`, and `push_snapshot` requests from the portal
- talks to Google Sheets securely
- later talks to Google Calendar and Gmail

3. Google Sheets
- remains the underlying database for this phase

## Portal endpoint contract

Your backend/proxy should support:

### `GET ?action=ping`

Response:

```json
{ "ok": true, "service": "studio-portal-backend" }
```

### `GET ?action=snapshot`

Response:

```json
{
  "ok": true,
  "snapshot": {
    "students": [],
    "lessons": [],
    "notes": [],
    "homework": [],
    "packages": [],
    "payments": [],
    "actorProfiles": [],
    "files": []
  }
}
```

### `POST`

Body:

```json
{
  "action": "push_snapshot",
  "token": "optional-token",
  "snapshot": {},
  "shapes": {}
}
```

Response:

```json
{ "ok": true, "updatedAt": "2026-04-07T12:00:00.000Z" }
```

## Recommended Google Sheets tabs

- `Students`
- `Lessons`
- `Notes`
- `Homework`
- `Packages`
- `Payments`
- `ActorProfiles`
- `Materials`

The exact column order should match the blueprint shown on the portal `Settings` page.

## Current practical use of Apps Script

Apps Script is still useful, but it should ideally sit behind the backend plan rather than be called straight from the browser.

You can use Apps Script to:

- own the spreadsheet
- read/write tabs
- expose a server-side endpoint that another backend can call
- or become the backend if you later host the portal in a way that avoids browser CORS issues

## Notes

- the current frontend pushes and pulls full snapshots, not row-by-row diffs
- that is intentional for the first live persistence phase
- live Calendar and Gmail integrations can build on this same backend contract in Phase 5B
