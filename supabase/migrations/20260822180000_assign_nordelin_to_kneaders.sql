-- The personnel roster defines Nordelin as the pâte-preparation operator.
-- The other active role-9 users remain in the production personnel registry.

insert into public.kneaders (profile_id, full_name, phone, status)
select p.id, p.full_name, p.phone, 'actif'
from public.profiles p
where p.is_active = true
  and p.role = 9
  and p.full_name = 'KOUKASSANADIANDAYA Nordelin'
  and not exists (
    select 1 from public.kneaders k where k.profile_id = p.id
  );

-- The first recovery migration created this row in bakers. It has no historic
-- activity and is removed here so that the person appears in the correct list.
delete from public.bakers b
using public.profiles p
where b.profile_id = p.id
  and p.full_name = 'KOUKASSANADIANDAYA Nordelin'
  and not exists (select 1 from public.production_records pr where pr.baker_id = b.id)
  and not exists (select 1 from public.dough_deliveries dd where dd.baker_id = b.id);
