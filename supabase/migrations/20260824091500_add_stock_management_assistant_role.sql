-- Keep the assistant role distinct from the stock manager title.
-- Role 16 has the stock manager's operational access level, never a director/admin level.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role >= 1 AND role <= 16);

COMMENT ON COLUMN public.profiles.role IS
  '1=commercial, 2=gestionnaire_stock, 3=comptable, 4=directeur_adjoint, 5=directrice, 6=administrateur, 7=directrice_commerciale, 8=responsable_production, 9=petisseur, 10=commercial, 11=commercial_externe, 12=securite, 13=plongeuse, 14=femme_menage, 16=assistant_gestion_stock';

-- All RLS policies call this helper. Map the assistant to level 2 so numeric
-- privilege comparisons cannot accidentally grant management privileges.
CREATE OR REPLACE FUNCTION private.get_my_role()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN role = 16 THEN 2 ELSE role END
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;
$$;

-- The notification recipients are management roles, not stock assistants.
CREATE OR REPLACE FUNCTION public.notify_responsible_profiles(
  p_title text,
  p_message text,
  p_link_page text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_notifications (user_id, title, message, type, link_page)
  SELECT id, p_title, p_message, 'warning', p_link_page
  FROM public.profiles
  WHERE role >= 4 AND role <> 16 AND is_active = true;
END;
$$;

UPDATE public.profiles
SET role = 16, updated_at = now()
WHERE lower(full_name) = lower('NGOLO Josaphat')
  AND is_active = true;
