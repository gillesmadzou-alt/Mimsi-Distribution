-- Centralize personnel creation while keeping operational tables compatible.
-- Role 9 is the petrisseur linked to bakers; role 15 is the fournier linked to kneaders.

comment on column public.profiles.role is
  '1=commercial, 2=gestionnaire_stock, 3=comptable, 4=directeur_adjoint, 5=directrice, 6=admin, 7=directrice_commerciale, 8=responsable_production, 9=petrisseur, 10=commercial, 11=commercial_externe, 12=agent_securite, 13=plongeuse, 14=femme_menage, 15=fournier, 16=assistant_gestion_stock';

insert into public.bakers (profile_id, full_name, phone, status)
select p.id, p.full_name, p.phone, 'actif'
from public.profiles p
where p.is_active = true and p.role = 9
  and not exists (select 1 from public.bakers b where b.profile_id = p.id);

insert into public.kneaders (profile_id, full_name, phone, status)
select p.id, p.full_name, p.phone, 'actif'
from public.profiles p
where p.is_active = true and p.role = 15
  and not exists (select 1 from public.kneaders k where k.profile_id = p.id);

insert into public.drivers (user_id, full_name, phone_primary, zone, status, vehicle_type)
select p.id, p.full_name, coalesce(p.phone, ''), '', 'actif', 'moto'
from public.profiles p
where p.is_active = true and p.role in (1, 10, 11)
  and not exists (select 1 from public.drivers d where d.user_id = p.id);
