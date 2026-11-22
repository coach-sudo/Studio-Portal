-- Keep the public credit-history RPC scoped to signed-in users. Older
-- installations can inherit service_role EXECUTE from public-schema defaults.
revoke execute on function public.student_credit_history(uuid, integer)
  from service_role;
