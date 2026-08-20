alter table public.booking_services
  add column if not exists location_price_adjustments jsonb not null default '{"google_meet":0,"in_person":0}';
alter table public.booking_services drop constraint if exists booking_services_location_price_adjustments;
alter table public.booking_services add constraint booking_services_location_price_adjustments check(
  jsonb_typeof(location_price_adjustments)='object'
  and coalesce((location_price_adjustments->>'google_meet')::bigint,0)>=0
  and coalesce((location_price_adjustments->>'in_person')::bigint,0)>=0
);

update public.studios set settings=settings||'{
  "branding":{"primaryColor":"#173F35","secondaryColor":"#C99A45","accentColor":"#E46F61","surfaceColor":"#F7F3EA","logoUrl":"","logoStoragePath":""},
  "bookingPage":{"footerWebsiteUrl":"https://d-a-j.com","footerWebsiteLabel":"Visit d-a-j.com","showCoachName":true,"showTrustRow":true,"showPolicies":true},
  "bookingDefaults":{"minimumNoticeHours":72,"bookingHorizonDays":90,"cancellationWindowHours":24,"bufferBeforeMinutes":0,"bufferAfterMinutes":0,"recurringHorizonWeeks":12,"inPersonUpchargeMinor":0}
}'::jsonb where slug='stage-story';
