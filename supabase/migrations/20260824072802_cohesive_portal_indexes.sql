create index if not exists bookings_discount_code_id_idx on public.bookings(discount_code_id) where discount_code_id is not null;
create index if not exists discount_redemptions_code_idx on public.discount_redemptions(discount_code_id);
create index if not exists integration_imports_verified_by_idx on public.integration_imports(verified_by) where verified_by is not null;
