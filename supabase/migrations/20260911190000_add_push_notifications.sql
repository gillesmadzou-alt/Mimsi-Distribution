-- Web Push : table des abonnements + déclenchement automatique de l'envoi
-- à chaque nouvelle notification in-app (table app_notifications), via la
-- fonction Edge `send-push`.
--
-- Mise en place manuelle requise après cette migration (voir
-- docs/web-push-setup.md) :
--   1. Secrets de la fonction Edge `send-push` : VAPID_PUBLIC_KEY,
--      VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), et
--      PUSH_TRIGGER_SECRET (partagé avec le trigger ci-dessous).
--   2. Deux secrets dans Vault (SQL Editor, pas dans une migration versionnée
--      pour ne jamais committer de secret) :
--        select vault.create_secret('<url du projet>', 'project_url');
--        select vault.create_secret('<même valeur que PUSH_TRIGGER_SECRET>', 'push_trigger_secret');
--   3. VITE_VAPID_PUBLIC_KEY côté front (Vercel + .env local).

create extension if not exists pg_net;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy "users manage their own push subscriptions"
  on public.push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.push_subscriptions is
  'Abonnements Web Push par utilisateur (endpoint navigateur + clés de chiffrement). Alimenté par src/lib/webPush.ts.';

-- Déclenche l'envoi push à chaque nouvelle notification in-app. Utilise
-- Vault plutôt qu'une valeur en dur pour ne jamais committer de secret dans
-- une migration versionnée dans git.
create or replace function private.trigger_send_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  trigger_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into trigger_secret
  from vault.decrypted_secrets where name = 'push_trigger_secret';

  -- Secrets pas encore configurés (juste après cette migration, avant la
  -- mise en place manuelle décrite plus haut) : on ne bloque pas l'insertion
  -- de la notification, on renonce simplement à l'envoi push.
  if project_url is null or trigger_secret is null then
    return NEW;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', trigger_secret),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'notification_id', NEW.id,
      'title', NEW.title,
      'body', NEW.message,
      'link_page', NEW.link_page,
      'priority', NEW.priority
    )
  );

  return NEW;
end;
$$;

create trigger app_notifications_send_push
  after insert on public.app_notifications
  for each row
  execute function private.trigger_send_push_notification();
