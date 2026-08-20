-- Add "Responsable de production" (role=8) and "Fournier" (role=9) roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role BETWEEN 1 AND 9);

COMMENT ON COLUMN profiles.role IS '1=livreur (commercial), 2=gestionnaire_stock, 3=comptable, 4=directeur_adjoint, 5=directrice, 6=admin, 7=directrice_commerciale, 8=responsable_production, 9=fournier';
