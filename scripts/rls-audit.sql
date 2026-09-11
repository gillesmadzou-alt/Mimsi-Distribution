-- Audit des politiques RLS (Row Level Security)
-- ------------------------------------------------
-- À coller dans le SQL Editor de Supabase et exécuter. Ne modifie rien
-- (lecture seule) : signale les politiques potentiellement trop permissives
-- pour revue manuelle. À relancer après chaque migration qui touche des
-- policies, ou périodiquement (ex: une fois par mois).

-- 1) Tables exposées via l'API (schema public) sans RLS activée du tout :
--    la table est accessible sans AUCUNE restriction dès qu'un rôle a accès
--    à l'API — c'est presque toujours une erreur.
select
  n.nspname as schema,
  c.relname as table_name,
  'RLS DÉSACTIVÉE — table non protégée' as finding
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;

-- 2) Politiques dont la condition est triviale (`true`) : autorise TOUT le
--    monde (y compris `anon`) à voir/modifier TOUTES les lignes. Peut être
--    volontaire (ex: tables de référence en lecture publique) mais doit
--    être vérifié au cas par cas — surtout pour INSERT/UPDATE/DELETE.
select
  schemaname as schema,
  tablename as table_name,
  policyname as policy,
  cmd as command,
  roles,
  qual as using_clause,
  with_check,
  case
    when cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (qual = 'true' or with_check = 'true')
      then '⚠️ ÉCRITURE ouverte à tous — à vérifier en priorité'
    when qual = 'true' or with_check = 'true'
      then 'Lecture ouverte à tous — à confirmer volontaire'
    else null
  end as finding
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by
  case when cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') then 0 else 1 end,
  tablename, policyname;

-- 3) Politiques qui accordent un accès au rôle `anon` (visiteur non
--    authentifié) plutôt qu'à `authenticated` uniquement — à vérifier que
--    c'est bien intentionnel (ex: aucune page publique n'existe dans cette
--    app, donc `anon` ne devrait normalement jamais apparaître ici).
select
  schemaname as schema,
  tablename as table_name,
  policyname as policy,
  cmd as command,
  roles
from pg_policies
where schemaname = 'public'
  and 'anon' = any(roles)
order by tablename, policyname;

-- 4) Tables du schema public sans AUCUNE politique définie alors que RLS
--    est activée : dans ce cas, PostgREST bloque tout accès par défaut
--    (pas un risque de sécurité), mais ça casse silencieusement les
--    fonctionnalités qui en dépendent — utile pour diagnostiquer un "ça ne
--    charge rien" plutôt qu'une fuite de données.
select
  n.nspname as schema,
  c.relname as table_name,
  'RLS activée mais 0 politique — accès totalement bloqué via l''API' as finding
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = n.nspname and p.tablename = c.relname
  )
order by c.relname;
