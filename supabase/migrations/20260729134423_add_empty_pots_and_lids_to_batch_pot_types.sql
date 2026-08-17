/*
# Pots vides et couvercles lors des tournées

Les livreurs partent avec des pots prêts à livrer (pot + couvercle + contenu)
mais aussi avec des pots vides et leurs couvercles séparés.
- Les pots prêts à livrer ont leur couvercle : on ne compte pas les couvercles pour eux.
- Les pots vides sont comptabilisés séparément.
- Les couvercles des pots vides sont aussi comptabilisés séparément.

## 1. Ajout des colonnes empty_pots et empty_lids sur batch_pot_types
- `empty_pots` (integer, NOT NULL, DEFAULT 0) — nombre de pots vides de ce type
- `empty_lids` (integer, NOT NULL, DEFAULT 0) — nombre de couvercles pour les pots vides de ce type
*/

ALTER TABLE batch_pot_types
  ADD COLUMN IF NOT EXISTS empty_pots integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS empty_lids integer NOT NULL DEFAULT 0;
