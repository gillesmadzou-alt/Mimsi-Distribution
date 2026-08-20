/*
# Expand delivery expenses with typed categories

## Purpose
Drivers incur many types of expenses during deliveries: fuel, oil, roadside
assistance, tire inflation, car wash, papers, spoiled madeleines, missing
madeleines, money transfers, transfer fees, cash pickup, cash shipping,
rations, credit under authorization, and other. This migration adds an
`expense_type` enum and an `authorized_by` field for credit expenses.

## Changes
- New enum `expense_type_enum` with all categories
- Add `expense_type` column (NOT NULL, default 'papier_pdv')
- Add `authorized_by` text column (nullable, used when expense_type = 'credit_autorise')
- Add `expense_date` date column (NOT NULL, default today) for daily totals
- Add `tournee` text column (nullable) to group expenses by round/tournée
*/

CREATE TYPE expense_type_enum AS ENUM (
  'carburant',
  'huile_moteur',
  'depannage',
  'gonflage_pneus',
  'location_voiture',
  'papiers',
  'madeleines_avaries',
  'madeleines_manquants',
  'transfert_argent',
  'frais_transfert',
  'recuperation_caisse',
  'expedition_caisse',
  'ration',
  'credit_autorise',
  'papier_pdv',
  'autre'
);

ALTER TABLE delivery_expenses
  ADD COLUMN IF NOT EXISTS expense_type expense_type_enum NOT NULL DEFAULT 'papier_pdv',
  ADD COLUMN IF NOT EXISTS authorized_by text,
  ADD COLUMN IF NOT EXISTS expense_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS tournee text;

CREATE INDEX IF NOT EXISTS idx_delivery_expenses_type       ON delivery_expenses (expense_type);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_date       ON delivery_expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_driver    ON delivery_expenses (driver_id);
