-- ============================================================================
-- CLOISONNER LES CONTRAINTES D'UNICITE
-- ----------------------------------------------------------------------------
-- Defaut passe a travers les mailles des migrations 20260914090000-090200.
--
-- Ajouter `org_id` et une policy d'isolation empeche un locataire de VOIR les
-- donnees d'un autre. Cela n'empeche pas une contrainte d'unicite definie
-- avant l'existence des organisations de porter sur TOUTE la table, tous
-- locataires confondus. Le deuxieme client se heurte alors a une violation de
-- contrainte causee par une ligne qu'il ne peut meme pas voir -- une erreur
-- incomprehensible pour lui comme pour le support.
--
-- Le cas le plus grave est `auto_reply_settings`, dont la CLE PRIMAIRE est
-- `channel` seul : trois lignes au total pour toute la plateforme. Un deuxieme
-- locataire ne peut tout simplement pas configurer son bot de reponse
-- automatique, et `meta-webhook` ne trouvant aucun reglage pour son org_id, son
-- bot reste muet sans le moindre message d'erreur.
--
-- Ne sont PAS modifiees les contraintes dont la cle est globale par nature --
-- `barcodes(code)`, `qr_codes(code)`, `facebook_comments(comment_id)`,
-- `marketing_orders(channel, external_id)`, `payment_requests(provider,
-- provider_reference)`, `social_connections(platform, external_id)` -- ni
-- celles dont le parent porte deja org_id (`batch_pot_types(batch_id, ...)`
-- et consorts) : une collision inter-locataires y est impossible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reponses automatiques : la cle primaire elle-meme etait globale
-- ----------------------------------------------------------------------------
ALTER TABLE public.auto_reply_settings DROP CONSTRAINT auto_reply_settings_pkey;
ALTER TABLE public.auto_reply_settings ADD PRIMARY KEY (org_id, channel);

-- Chaque nouvelle organisation doit disposer de ses trois reglages, sinon son
-- ecran de configuration du bot est vide et le bot ne repond jamais.
CREATE OR REPLACE FUNCTION private.seed_org_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.auto_reply_settings (org_id, channel)
  VALUES (NEW.id, 'whatsapp'), (NEW.id, 'facebook'), (NEW.id, 'instagram')
  ON CONFLICT (org_id, channel) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_defaults
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.seed_org_defaults();

COMMENT ON FUNCTION private.seed_org_defaults() IS
  'Cree les reglages par defaut d''une nouvelle organisation. A etendre au fur et a mesure que d''autres tables de configuration apparaissent.';

-- ----------------------------------------------------------------------------
-- 2. Les unicites metier : uniques DANS une organisation, pas au-dela
-- ----------------------------------------------------------------------------

-- Deux commercants ont evidemment le droit d'avoir tous les deux « Farine ».
ALTER TABLE public.ingredients DROP CONSTRAINT ingredients_name_key;
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_org_name_key UNIQUE (org_id, name);

-- Les codes de tournee sont numerotes par entreprise.
ALTER TABLE public.delivery_batches DROP CONSTRAINT delivery_batches_batch_code_key;
ALTER TABLE public.delivery_batches ADD CONSTRAINT delivery_batches_org_batch_code_key UNIQUE (org_id, batch_code);

-- Idem pour les codes fournisseurs.
ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_supplier_code_key;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_org_supplier_code_key UNIQUE (org_id, supplier_code);

-- Les references comptables sont chronologiques et reprennent a 1 dans chaque
-- entreprise : sans org_id, la deuxieme organisation entre en collision des sa
-- premiere ecriture (voir 20260909164154_generate_chronological_accounting_references).
ALTER TABLE public.accounting_entries DROP CONSTRAINT accounting_entries_reference_unique;
ALTER TABLE public.accounting_entries ADD CONSTRAINT accounting_entries_org_reference_unique UNIQUE (org_id, reference);
