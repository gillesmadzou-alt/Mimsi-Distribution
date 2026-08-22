-- Restore the operational personnel records required by the application.
-- Login profiles are not sufficient on their own: delivery batches reference
-- drivers, while production screens reference bakers and kneaders.

insert into public.drivers (user_id, full_name, phone_primary, zone, status, vehicle_type)
select p.id, p.full_name, coalesce(p.phone, ''), '', 'actif', 'moto'
from public.profiles p
where p.is_active = true
  and p.role in (1, 10, 11)
  and not exists (
    select 1 from public.drivers d where d.user_id = p.id
  );

insert into public.bakers (profile_id, full_name, phone, status)
select p.id, p.full_name, p.phone, 'actif'
from public.profiles p
where p.is_active = true
  and p.role = 9
  and not exists (
    select 1 from public.bakers b where b.profile_id = p.id
  );

insert into public.kneaders (profile_id, full_name, phone, status)
select p.id, p.full_name, p.phone, 'actif'
from public.profiles p
where p.is_active = true
  and p.role = 8
  and not exists (
    select 1 from public.kneaders k where k.profile_id = p.id
  );
