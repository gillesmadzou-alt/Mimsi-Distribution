ALTER TABLE public.work_schedules
  DROP CONSTRAINT IF EXISTS work_schedules_person_type_check;

ALTER TABLE public.work_schedules
  ADD CONSTRAINT work_schedules_person_type_check
  CHECK (person_type IN ('driver', 'baker', 'kneader', 'profile'));

ALTER TABLE public.work_schedules
  ADD COLUMN person_role smallint,
  ADD CONSTRAINT work_schedules_person_role_check
  CHECK (person_role IS NULL OR person_role BETWEEN 1 AND 16);

COMMENT ON COLUMN public.work_schedules.person_type IS
  'Origine de la personne programmée : fiche commerciale, production ou profil général.';
