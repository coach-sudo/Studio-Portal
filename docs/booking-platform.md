# Booking platform operations

The booking database is authoritative. Google Calendar, Meet, Gmail, and Stripe are projections or payment providers; provider responses never replace the internal booking state.

## Runtime modes

- With no Supabase browser variables, the application runs an explicitly labelled interactive demo. Every visible booking, coach, student, and guardian action updates the shared in-memory session and resets on refresh. It never claims to charge a card or send a message.
- Live mode requires both browser-safe Supabase variables and the server-only provider variables below. Public catalog reads and all mutations then use authenticated Netlify Functions and Supabase RLS.
- `/api/v2/health` performs read-only provider checks and reports booleans plus safe remediation messages, never secret values.

## Release order

1. Apply every migration in `supabase/migrations` to the connected Supabase project.
2. Add the values listed in `.env.example` to the Netlify site. Keep service-role, Stripe, and Google secrets server-only.
3. Point the Stripe webhook at `/api/v2/stripe-webhook` and subscribe to the Checkout Session, invoice, subscription, charge, and refund events handled by `stripe-webhook-v2.ts`.
4. Create real services, weekly hours, blackouts, and class/course offerings from the coach booking center. A published service without weekly hours intentionally exposes no times.
5. Run sandbox bookings for pay-now, deposit, pay-later, installment, subscription, and verified-credit paths before publishing services.

Required Netlify variables are `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STUDIO_SLUG` (or immutable `STUDIO_ID`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_REFRESH_TOKEN`, and either the `GOOGLE_CLIENT_*` or `GOOGLE_OAUTH_CLIENT_*` pair. Configure `GOOGLE_CALENDAR_ID` and `GOOGLE_ACCOUNT_EMAIL` for the connected coach account.

The Google refresh token must include Calendar read/write and Gmail send access. The Google OAuth client must also list `https://htwthzshhilrjtqwprlo.supabase.co/auth/v1/callback` as an authorized redirect URI for coach Google sign-in. Settings → Connections shows either provider as disconnected when these requirements are not met.

## Recovery

- Calendar and Meet failures remain in `calendar_projections` and are retried by `calendar-worker`.
- Confirmation and reminder failures remain in `outbox_messages` with delivery attempts and retry times.
- `booking-maintenance` expires abandoned holds, preserves a rolling 12-week subscription schedule, and cancels future occurrences after the seven-day delinquency grace period.
- Stripe and command handlers are idempotent; duplicate delivery must not create duplicate lessons, payments, credits, or participants.
