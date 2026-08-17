/*
# Comptabilité des pots vides et couvercles dans les retours/invendus

Les retours peuvent maintenant distinguer :
- `quantity`        : pots prêts à livrer revenus (pot + couvercle + contenu)
- `empty_pots`      : pots vides revenus (sans contenu)
- `empty_lids`      : couvercles des pots vides revenus
- `madeleine_count` : madeleines revenues

Les pots prêts ont leur couvercle attaché, on ne compte pas les couvercles pour eux.
*/

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS empty_pots integer NOT NULL DEFAULT 0 CHECK (empty_pots >= 0),
  ADD COLUMN IF NOT EXISTS empty_lids integer NOT NULL DEFAULT 0 CHECK (empty_lids >= 0);
