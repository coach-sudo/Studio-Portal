create or replace function public.studio_route_snapshot(requested_domains text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'membership', (
      select jsonb_build_object(
        'studio_id', m.studio_id,
        'role', m.role,
        'display_name', m.display_name,
        'profile_photo_asset_id', m.profile_photo_asset_id,
        'profile_photo_position', m.profile_photo_position
      )
      from public.memberships m
      limit 1
    ),
    'studio', (
      select jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'slug', s.slug,
        'timezone', s.timezone,
        'settings', s.settings
      )
      from public.studios s
      limit 1
    ),
    'students', case when requested_domains && array['identity','students','lessons','booking','work','finance','messaging','actorProfiles','households','referrals'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.students t where t.deleted_at is null), '[]'::jsonb) else '[]'::jsonb end,
    'lessons', case when requested_domains && array['lessons','booking'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.lessons t), '[]'::jsonb) else '[]'::jsonb end,
    'notes', case when requested_domains && array['work'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.notes t), '[]'::jsonb) else '[]'::jsonb end,
    'assignments', case when requested_domains && array['work'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.assignments t), '[]'::jsonb) else '[]'::jsonb end,
    'materials', case when requested_domains && array['work','actorProfiles'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.materials t), '[]'::jsonb) else '[]'::jsonb end,
    'links', case when requested_domains && array['work','actorProfiles'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.material_links t), '[]'::jsonb) else '[]'::jsonb end,
    'packages', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.packages t), '[]'::jsonb) else '[]'::jsonb end,
    'packageDefinitions', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.package_definitions t), '[]'::jsonb) else '[]'::jsonb end,
    'packageBillingOptions', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.package_billing_options t), '[]'::jsonb) else '[]'::jsonb end,
    'packageSubscriptions', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.package_subscriptions t), '[]'::jsonb) else '[]'::jsonb end,
    'packageGifts', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.package_gifts t), '[]'::jsonb) else '[]'::jsonb end,
    'linkedContacts', case when requested_domains && array['identity','households','messaging'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.linked_contacts t), '[]'::jsonb) else '[]'::jsonb end,
    'profileAssets', case when requested_domains && array['identity','work','actorProfiles'] then
      coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'storage_path',t.storage_path,'mime_type',t.mime_type)) from public.file_assets t), '[]'::jsonb) else '[]'::jsonb end,
    'pricingRules', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.student_pricing_rules t), '[]'::jsonb) else '[]'::jsonb end,
    'credits', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.package_credit_entries t), '[]'::jsonb) else '[]'::jsonb end,
    'payments', case when requested_domains && array['finance'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.payment_entries t), '[]'::jsonb) else '[]'::jsonb end,
    'profiles', case when requested_domains && array['actorProfiles'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.actor_profiles t), '[]'::jsonb) else '[]'::jsonb end,
    'outbox', case when requested_domains && array['messaging'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.outbox_messages t), '[]'::jsonb) else '[]'::jsonb end,
    'recommendations', case when requested_domains && array['administration'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.recommendations t where t.status = 'open'), '[]'::jsonb) else '[]'::jsonb end,
    'bookingServices', case when requested_domains && array['booking','lessons'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.booking_services t), '[]'::jsonb) else '[]'::jsonb end,
    'availabilityRules', case when requested_domains && array['booking'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.availability_rules t), '[]'::jsonb) else '[]'::jsonb end,
    'availabilityExceptions', case when requested_domains && array['booking'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.availability_exceptions t), '[]'::jsonb) else '[]'::jsonb end,
    'serviceOfferings', case when requested_domains && array['booking','lessons','messaging'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.service_offerings t), '[]'::jsonb) else '[]'::jsonb end,
    'conversations', case when requested_domains && array['messaging'] then
      coalesce((select jsonb_agg(to_jsonb(t) order by t.last_message_at desc) from public.conversations t), '[]'::jsonb) else '[]'::jsonb end,
    'conversationMessages', case when requested_domains && array['messaging'] then
      coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.conversation_messages t where t.deleted_at is null), '[]'::jsonb) else '[]'::jsonb end,
    'conversationStates', case when requested_domains && array['messaging'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.conversation_states t), '[]'::jsonb) else '[]'::jsonb end,
    'recurringSeries', case when requested_domains && array['booking','lessons'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.recurring_series t), '[]'::jsonb) else '[]'::jsonb end,
    'bookings', case when requested_domains && array['booking','lessons'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.bookings t), '[]'::jsonb) else '[]'::jsonb end,
    'lessonParticipants', case when requested_domains && array['booking','lessons'] then
      coalesce((select jsonb_agg(to_jsonb(t)) from public.lesson_participants t), '[]'::jsonb) else '[]'::jsonb end,
    'integrationImports', case when requested_domains && array['administration'] then
      coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public.integration_imports t), '[]'::jsonb) else '[]'::jsonb end,
    'discountCodes', case when requested_domains && array['administration','booking'] then
      coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public.discount_codes t), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

revoke all on function public.studio_route_snapshot(text[]) from public;
grant execute on function public.studio_route_snapshot(text[]) to authenticated;
