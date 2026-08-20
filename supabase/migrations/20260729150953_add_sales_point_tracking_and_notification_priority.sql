/*
# Points de vente : traçabilité + notifications DG/DGA

## 1. Ajouter `created_by` et `driver_id` à `sales_points`
- `created_by` : qui a créé le point de vente
- `driver_id` : livreur responsable du point (nullable)

## 2. Ajouter `priority` à `app_notifications`
- 'haute', 'moyenne', 'basse' (défaut 'moyenne')
- Permet de classer les notifications par importance

## 3. Trigger `notify_sales_point_changes`
- À chaque INSERT/UPDATE/DELETE sur sales_points, notifie la Directrice (5) et le Directeur adjoint (4)
*/

-- 1. Add created_by and driver_id to sales_points
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='created_by') THEN
    ALTER TABLE sales_points ADD COLUMN created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='driver_id') THEN
    ALTER TABLE sales_points ADD COLUMN driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Add priority to app_notifications
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_notifications' AND column_name='priority') THEN
    ALTER TABLE app_notifications ADD COLUMN priority text NOT NULL DEFAULT 'moyenne' CHECK (priority IN ('haute', 'moyenne', 'basse'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_notifications_priority ON app_notifications(priority);

-- 3. Function to notify DG (5) and DGA (4) about sales point changes
CREATE OR REPLACE FUNCTION notify_sales_point_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_action text;
  v_point_name text;
  v_actor text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'créé';
    v_point_name := NEW.name;
    v_actor := COALESCE((SELECT full_name FROM profiles WHERE id = NEW.created_by), 'Un utilisateur');
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'modifié';
    v_point_name := NEW.name;
    v_actor := COALESCE((SELECT full_name FROM profiles WHERE id = NEW.created_by), 'Un utilisateur');
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'supprimé';
    v_point_name := OLD.name;
    v_actor := 'Un utilisateur';
  END IF;

  INSERT INTO app_notifications (user_id, title, message, type, priority, link_page)
  SELECT id,
    'Point de vente ' || v_action,
    v_actor || ' a ' || v_action || ' le point de vente « ' || v_point_name || ' »',
    CASE WHEN v_action = 'supprimé' THEN 'warning' ELSE 'info' END,
    CASE WHEN v_action = 'supprimé' THEN 'haute' ELSE 'moyenne' END,
    'sales-points'
  FROM profiles
  WHERE role IN (4, 5) AND is_active = true;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_sales_point_changes ON sales_points;
CREATE TRIGGER trg_notify_sales_point_changes
  AFTER INSERT OR UPDATE OR DELETE ON sales_points
  FOR EACH ROW
  EXECUTE FUNCTION notify_sales_point_changes();
