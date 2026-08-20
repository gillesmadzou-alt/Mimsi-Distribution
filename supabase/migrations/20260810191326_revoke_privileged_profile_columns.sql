-- F1 + F9: users may edit their own profile row, but must not control the
-- privilege column (role) or the account-enabled column (is_active).
-- Role changes go through the admin edge function (service role); is_active
-- changes go through public.toggle_user_active, which requires role 6.

REVOKE UPDATE (role) ON public.profiles FROM authenticated;
REVOKE UPDATE (role) ON public.profiles FROM anon;
REVOKE UPDATE (is_active) ON public.profiles FROM authenticated;
REVOKE UPDATE (is_active) ON public.profiles FROM anon;

REVOKE INSERT (role) ON public.profiles FROM anon;
REVOKE INSERT (is_active) ON public.profiles FROM anon;
