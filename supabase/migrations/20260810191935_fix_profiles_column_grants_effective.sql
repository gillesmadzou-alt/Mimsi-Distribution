-- Table-level UPDATE grants make earlier column-level REVOKEs a no-op.
-- Remove the table-level grant, then re-grant only the non-privileged columns.
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE INSERT ON public.profiles FROM authenticated;
REVOKE INSERT ON public.profiles FROM anon;

GRANT UPDATE (full_name, phone, avatar_url, updated_at) ON public.profiles TO authenticated;
