-- Fix infinite recursion in profiles RLS policies.
-- The policies query profiles inside their own predicate, causing recursion.
-- Solution: a SECURITY DEFINER helper that returns the caller's own role,
-- bypassing RLS. Place it in the private schema so it's not REST-exposed.

CREATE OR REPLACE FUNCTION private.get_my_role()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
STABLE
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION private.get_my_role() FROM anon;
GRANT EXECUTE ON FUNCTION private.get_my_role() TO authenticated;

-- Replace the recursive policies with ones that use the helper function.

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated
  USING (private.get_my_role() >= 1);

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR private.get_my_role() >= 5)
  WITH CHECK (auth.uid() = id OR private.get_my_role() >= 5);

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE
  TO authenticated
  USING (private.get_my_role() = 6);
