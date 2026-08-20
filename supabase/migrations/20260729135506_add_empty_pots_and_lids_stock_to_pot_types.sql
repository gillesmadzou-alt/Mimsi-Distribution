/*
# Gestion des stocks : pots prêts, pots vides et couvercles

La gestionnaire des stocks gère trois types d'inventaire par type de pot :
- `stock_quantity`    : pots prêts à livrer (pot + couvercle + contenu)
- `empty_pots_stock`  : pots vides (sans contenu)
- `empty_lids_stock`  : couvercles séparés (pour les pots vides)
*/

ALTER TABLE pot_types
  ADD COLUMN IF NOT EXISTS empty_pots_stock integer NOT NULL DEFAULT 0 CHECK (empty_pots_stock >= 0),
  ADD COLUMN IF NOT EXISTS empty_lids_stock integer NOT NULL DEFAULT 0 CHECK (empty_lids_stock >= 0);
