-- F1 (continued): the client never creates profile rows — accounts are created
-- by the admin edge function using the service role. Leaving INSERT available to
-- the browser lets an auth user with no profile yet self-insert one with role 6.

REVOKE INSERT ON public.profiles FROM authenticated;
REVOKE INSERT ON public.profiles FROM anon;
