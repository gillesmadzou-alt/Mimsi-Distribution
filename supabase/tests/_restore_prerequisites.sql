-- Prerequis d'une base cible de restauration.
--
-- Une restauration reelle se fait dans un projet Supabase neuf, qui fournit
-- deja les roles de la plateforme et le schema `extensions` contenant pgcrypto.
-- Une base Postgres nue ne les a pas, et la restauration echoue alors sur des
-- objets qui n'ont rien a voir avec les donnees -- par exemple la valeur par
-- defaut `extensions.gen_random_bytes(32)` de organizations.ingest_token.
--
-- Ce fichier reproduit ces prerequis, et rien d'autre : ni tables, ni schema
-- `auth`, ni `private`, qui viennent tous du dump lui-meme.

DO $$ BEGIN CREATE ROLE anon NOLOGIN;                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE supabase_auth_admin NOLOGIN;     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator NOINHERIT LOGIN;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
