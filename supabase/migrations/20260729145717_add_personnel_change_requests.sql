/*
# Demandes de modification du personnel (livreurs, pétrisseurs, fourniers)

## Objectif
Workflow d'approbation obligatoire pour toute création, modification ou suppression
des livreurs, pétrisseurs et fourniers. Les chefs de départements soumettent les
demandes ; la Directrice ET le Directeur général adjoint doivent tous deux approuver
avant que la modification ne soit appliquée.

## 1. Nouvelle table `personnel_change_requests`
- `id` (uuid, PK)
- `entity_type` (text, NOT NULL) — 'driver', 'kneader', 'baker'
- `action_type` (text, NOT NULL) — 'create', 'update', 'delete'
- `entity_id` (uuid, nullable) — ID de l'entité existante (null pour create)
- `payload` (jsonb, NOT NULL) — données du formulaire à appliquer
- `status` (text, NOT NULL, défaut 'en_attente') — 'en_attente', 'validee', 'rejetee'
- `directrice_approved_by` (uuid, FK profiles, nullable)
- `directrice_approved_at` (timestamptz, nullable)
- `adjoint_approved_by` (uuid, FK profiles, nullable)
- `adjoint_approved_at` (timestamptz, nullable)
- `rejected_by` (uuid, FK profiles, nullable)
- `rejected_at` (timestamptz, nullable)
- `rejection_reason` (text, nullable)
- `applied` (boolean, NOT NULL, défaut false) — indique si la modif a été appliquée à la table cible
- `requested_by` (uuid, FK profiles) — demandeur
- `notes` (text, nullable)
- `created_at` (timestamptz, défaut now())
- `updated_at` (timestamptz, défaut now())

## 2. Sécurité
- RLS activée, politiques CRUD pour authenticated
*/

CREATE TABLE IF NOT EXISTS personnel_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('driver', 'kneader', 'baker')),
  action_type text NOT NULL CHECK (action_type IN ('create', 'update', 'delete')),
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'validee', 'rejetee')),
  requested_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  directrice_approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  directrice_approved_at timestamptz,
  adjoint_approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  adjoint_approved_at timestamptz,
  rejected_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,
  applied boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE personnel_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "change_requests_select" ON personnel_change_requests;
CREATE POLICY "change_requests_select" ON personnel_change_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "change_requests_insert" ON personnel_change_requests;
CREATE POLICY "change_requests_insert" ON personnel_change_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "change_requests_update" ON personnel_change_requests;
CREATE POLICY "change_requests_update" ON personnel_change_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "change_requests_delete" ON personnel_change_requests;
CREATE POLICY "change_requests_delete" ON personnel_change_requests FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_pcr_status ON personnel_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_pcr_entity ON personnel_change_requests(entity_type);
