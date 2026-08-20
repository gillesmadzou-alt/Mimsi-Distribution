-- Add Logistics department roles (10-14)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role BETWEEN 1 AND 14);

COMMENT ON COLUMN profiles.role IS '1=livreur (commercial), 2=gestionnaire_stock, 3=comptable, 4=directeur_adjoint, 5=directrice, 6=admin, 7=directrice_commerciale, 8=responsable_production, 9=fournier, 10=chauffeur, 11=chauffeur_externe, 12=agent_securite, 13=plongeuse, 14=femme_menage';
