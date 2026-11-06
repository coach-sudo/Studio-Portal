-- Protect older booking handlers and all direct table/RPC writers. Existing
-- installment rows retain their settlement and correction paths.
create function workspace_internal.reject_new_installment_booking()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op = 'UPDATE' then
    if old.payment_policy = 'installments' then
      return new;
    end if;
  end if;
  raise exception using errcode='23514',
    message='Installment bookings are unavailable. Choose another payment option.';
end $$;
revoke all on function workspace_internal.reject_new_installment_booking()
from public, anon, authenticated, service_role;

create trigger reject_new_installment_booking
before insert or update on public.bookings
for each row when (new.payment_policy = 'installments')
execute function workspace_internal.reject_new_installment_booking();
alter table public.bookings enable always trigger reject_new_installment_booking;
