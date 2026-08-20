/*
# Corriger les codes à barres : utiliser bakers (fourniers) au lieu de suppliers

1. Contexte
- L'utilisateur appelle "fournier" la personne qui gère le four (table bakers)
- La table bakers existe déjà avec full_name (nom + prénom combinés)
- Les colonnes supplier_id/supplier_code ont été ajoutées par erreur à la table barcodes
- Il faut remplacer par baker_id et baker_code

2. Modifications
- Ajoute baker_id et baker_code à la table barcodes
- Supprime les colonnes supplier_id et supplier_code de barcodes
- Ne supprime pas la table suppliers (elle pourrait servir plus tard)
*/

ALTER TABLE public.barcodes
  ADD COLUMN IF NOT EXISTS baker_id uuid REFERENCES public.bakers(id),
  ADD COLUMN IF NOT EXISTS baker_code text;

ALTER TABLE public.barcodes
  DROP COLUMN IF EXISTS supplier_id,
  DROP COLUMN IF EXISTS supplier_code;
