# Phase 5A Proxy Next Step

The portal frontend is ready for persistence, but direct browser calls to Google Apps Script are not reliable because of CORS.

## What to build next

A lightweight backend/proxy endpoint that the portal can call.

That backend should:

- accept `ping`
- accept `snapshot`
- accept `push_snapshot`
- read/write Google Sheets
- later hold Google Calendar and Gmail credentials safely

## Why this is the right move

- keeps the frontend unchanged
- keeps Google credentials off the client
- avoids browser CORS issues
- sets up Phase 5B and live integrations cleanly

## Minimum backend behavior

### `GET /api/studio-sync?action=ping`

Return:

```json
{ "ok": true, "service": "studio-portal-backend" }
```

### `GET /api/studio-sync?action=snapshot`

Return:

```json
{ "ok": true, "snapshot": { ... } }
```

### `POST /api/studio-sync`

Accept:

```json
{
  "action": "push_snapshot",
  "token": "optional-token",
  "snapshot": { ... },
  "shapes": { ... }
}
```

Return:

```json
{ "ok": true, "updatedAt": "..." }
```

## Good hosting options for the proxy

- Vercel serverless function
- Netlify function
- Firebase function
- small Node server

## Practical recommendation

Use a small serverless backend first, then let that backend talk to Google Sheets.
