# Mimsi SaaS — Structuration de l'idée et étapes clés

> Document de cadrage produit / technique. Point de départ : le code existant de
> `Mimsi-Distribution` (Vite + React + TypeScript + Supabase, 36 pages,
> 159 migrations, 17 Edge Functions).
>
> Les règles des plateformes (Meta, TikTok) évoluent vite : chaque contrainte
> citée en section 5 doit être **revérifiée dans la documentation officielle au
> moment de l'implémentation**.

---

## 1. L'idée, reformulée

> « Un SaaS où chaque commerçant connecte ses comptes WhatsApp, Facebook,
> Instagram et TikTok pour faire de la publicité, préparer ses publications et
> campagnes, et gérer ses clients, commandes, stocks, factures et
> fournisseurs. »

Formulée ainsi, l'idée contient **trois produits complets** :

| # | Produit | Concurrents établis |
|---|---------|---------------------|
| A | Gestion des réseaux sociaux (publication, planification, ads) | Hootsuite, Buffer, Postiz, Mixpost |
| B | Relation client multicanale (inbox, bot, leads) | Chatwoot, Respond.io, Wati |
| C | Gestion commerciale (clients, commandes, stock, factures, fournisseurs) | Odoo, Dolibarr, ERPNext, Akaunting |

Vouloir livrer A + B + C d'un coup, c'est 18–24 mois de développement avant le
premier euro. **La vraie valeur n'est dans aucun des trois pris séparément :
elle est dans la couture entre eux.**

### Le positionnement recommandé : le commerce social bouclé

```
Publicité        Message          Commande         Stock           Facture         Paiement
FB / IG / TikTok  →  WhatsApp  →  enregistrée  →  décrémenté  →  générée  →  Mobile Money
                                                                                     │
                        Relance automatique  ◄───── Créance impayée ◄────────────────┘
```

Aucun outil de la liste ci-dessus ne ferme cette boucle :

- Buffer / Postiz / Mixpost s'arrêtent à la publication. Ils ne savent pas
  qu'un message est devenu une commande.
- Chatwoot s'arrête à la conversation. Il ne connaît ni stock, ni facture.
- Odoo / Dolibarr gèrent le commercial mais ignorent WhatsApp, Instagram,
  TikTok et le Mobile Money.

**La promesse vendable en une phrase :** *« De la publicité Facebook à la
facture payée en Mobile Money, sans ressaisir une seule ligne. »*

### Le marché à viser en premier

Afrique francophone (Congo, Cameroun, Côte d'Ivoire, Sénégal, Gabon, RDC) —
PME et commerçants qui vendent **déjà** par WhatsApp et tiennent leurs comptes
sur un cahier. Différenciateurs que les outils occidentaux n'ont pas :

1. **Mobile Money natif** (MTN, Airtel, Orange, Wave) — déjà amorcé via PawaPay
   et CinetPay dans le dépôt.
2. **Hors-ligne d'abord** — déjà implémenté (Dexie, `offlineQueue.ts`,
   `readCache.ts`, `precache.ts`, `useOfflineSave.ts`). C'est un actif rare et
   très difficile à rattraper.
3. **Comptabilité SYSCOHADA** — déjà implémentée
   (`20260909170030_classify_accounting_entries_syscohada.sql`). Barrière à
   l'entrée énorme pour un concurrent américain.
4. **WhatsApp comme canal principal**, pas comme option secondaire.
5. **Français + interface pensée pour un smartphone Android d'entrée de gamme.**

---

## 2. L'actif de départ : ce qui existe déjà dans le dépôt

C'est le point le plus important de ce document. Tu ne partes pas de zéro : tu
as déjà construit, pour un seul commerce, la moitié du produit.

### Déjà en place et réutilisable tel quel

| Brique | Emplacement | Statut |
|--------|-------------|--------|
| Publication Facebook (posts, stories photo, stories vidéo) | `supabase/functions/publish-to-facebook`, `publish-facebook-story`, `publish-facebook-video-story` | Fonctionnel |
| Webhook Meta unifié (WhatsApp + Messenger + Instagram + commentaires Page) | `supabase/functions/meta-webhook/index.ts` | Fonctionnel |
| Envoi de messages sortants | `send-facebook-message`, `broadcast-message` | Fonctionnel |
| Bot d'auto-réponse + diffusion groupée | `20260912120000_add_auto_reply_and_broadcasts.sql` | Fonctionnel |
| Modération des commentaires | `manage-facebook-comment` | Fonctionnel |
| Commandes venues des réseaux sociaux | `marketing_orders` + `receive-marketing-order` | Fonctionnel |
| Page Marketing par plateforme (FB / WA / IG / TikTok) | `src/pages/MarketingPage.tsx` (1382 lignes) | Fonctionnel |
| Paiements Mobile Money + carte | `initiate-mobile-money-payment`, `initiate-card-payment`, `pawapay-webhook`, `cinetpay-webhook`, `payment_requests` | Squelette |
| Relance automatique des impayés | `send-payment-reminders`, `receivables` | Fonctionnel |
| Clients / points de vente | `sales_points`, `SalesPointsPage` | Fonctionnel |
| Stock, mouvements, inventaires | `stock_movements`, `inventory_sessions`, `inventory_entries`, `StockPage`, `BatchesPage` | Fonctionnel |
| Fournisseurs | `suppliers`, `20260911180000_add_supplier_accounts.sql` | Fonctionnel |
| Comptabilité (grand livre, SYSCOHADA) | `accounting_entries`, `JournalPage`, `AccountKeepingPage` | Fonctionnel |
| Documents / pièces justificatives (PDF, Word, images) | `documents`, `DocumentsPage` | Fonctionnel |
| Notifications push web | `send-push`, VAPID, `webPush.ts` | Fonctionnel |
| Hors-ligne + synchronisation | `src/lib/offlineQueue.ts`, `readCache.ts`, `precache.ts` | Fonctionnel |
| Rôles hiérarchiques + RLS | `private.get_my_role()`, policies sur toutes les tables | Fonctionnel |
| Exports PDF / Excel, codes-barres, cartes | `jspdf`, `xlsx`, `jsbarcode`, `@zxing`, `leaflet` | Fonctionnel |

### Ce qui manque pour que ça devienne un SaaS

| Manque | Gravité | Détail |
|--------|---------|--------|
| **Isolation multi-locataire** | 🔴 Bloquant | Aucune table ne porte de `org_id` / `tenant_id`. Les RLS filtrent par *rôle*, pas par *entreprise*. Deux clients partageraient les mêmes données. |
| **Secrets par client** | 🔴 Bloquant | `FACEBOOK_PAGE_ACCESS_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `WHATSAPP_PHONE_NUMBER_ID` sont des variables d'environnement Deno → **une seule entreprise possible par déploiement**. |
| **OAuth self-service** | 🔴 Bloquant | Aujourd'hui les comptes sont branchés à la main dans Meta for Developers. Un client SaaS doit pouvoir cliquer « Connecter ma Page » lui-même. |
| Inscription / abonnement / facturation SaaS | 🔴 Bloquant | Pas de plans, quotas, essai gratuit, ni facturation récurrente. |
| Planification des publications | 🟠 Important | Publication immédiate uniquement. Pas de calendrier éditorial ni de file d'attente. |
| Publicités (ads) | 🟠 Important | Rien. La page Marketing décrit la *stratégie* publicitaire, elle ne crée pas de campagne. |
| Instagram (publication) | 🟠 Important | Seulement les messages entrants et l'envoi sortant. Pas de publication de feed/reels. |
| TikTok | 🟠 Important | Aucune intégration technique (`MarketingPage.tsx:783` le dit explicitement). |
| Inbox unifiée | 🟡 Souhaitable | Les messages arrivent en base mais il n'y a pas d'écran de conversation type messagerie. |
| Métier générique | 🟡 Souhaitable | Le domaine est spécifique à la boulangerie/distribution : `dough_batches`, `kneaders`, `bakers`, `pot_types`, `consignments`, `wedding_orders`. Un SaaS grand public a besoin d'un modèle `produits / variantes` neutre. |

**Conclusion de cette section :** environ **60–70 % du module commerce (C)** et
**40 % du module social (A/B)** existent. L'effort principal n'est pas de
construire des fonctionnalités, c'est de **transformer une application mono-
entreprise en plateforme multi-locataire**.

---

## 3. Architecture fonctionnelle : 6 modules

### M1 — Connexions & identité
- Inscription, espace de travail (organisation), invitation d'équipe, rôles.
- Écran « Mes canaux » : connecter / déconnecter FB Page, compte IG pro, numéro
  WhatsApp Business, compte TikTok.
- Santé des connexions : jeton expiré, permission révoquée, reconnexion guidée.

### M2 — Studio social (préparer les publications)
- Composeur unique → publication adaptée par canal (formats, longueurs, hashtags).
- Bibliothèque média (photos/vidéos produits), recadrage automatique par format.
- Calendrier éditorial, file d'attente, meilleurs créneaux, brouillons, validation.
- Formats : post FB, story FB, feed IG, story IG, reel IG, vidéo TikTok, statut WA.

### M3 — Inbox unifiée & bot
- Une conversation = un client, tous canaux confondus, assignable à un agent.
- Réponses rapides, étiquettes, catalogue produit envoyable en un clic.
- Bot : réponses automatiques, qualification, prise de commande guidée, escalade humaine.
- **Le bouton clé : « Convertir en commande »** → crée la commande et le client.

### M4 — Publicités & campagnes
- Création de campagne assistée (objectif, audience, budget, créa, durée).
- Audiences réutilisables, y compris audiences personnalisées à partir des clients.
- Suivi : dépense, portée, coût par message/commande, **retour sur dépense
  publicitaire réel** (croisé avec les commandes encaissées — c'est ça que
  personne d'autre ne peut calculer).
- Le budget est dépensé sur **le compte publicitaire du client**, pas le tien
  (voir section 5).

### M5 — Commerce (le cœur déjà construit)
- Clients (fiche, historique, canal d'origine, solde).
- Catalogue produits/variantes/prix (à généraliser depuis le modèle actuel).
- Commandes → livraison → facture → encaissement Mobile Money/carte/espèces.
- Stock, mouvements, inventaires, alertes de réassort.
- Fournisseurs, achats, comptes fournisseurs.
- Créances et relances automatiques.
- Comptabilité SYSCOHADA, journaux, exports.

### M6 — Pilotage & plateforme
- Tableau de bord : chiffre d'affaires, marge, top produits, canal le plus rentable.
- Abonnement : plan, quotas, consommation, factures SaaS, essai gratuit.
- Administration plateforme (côté toi) : locataires, usage, incidents, support.

---

## 4. Architecture technique

### Pile recommandée : garder l'existant

Reste sur **Supabase + React + Vite + TypeScript**. Ne réécris rien. Le seul
ajout structurel nécessaire est une **couche de travaux de fond** (planification,
reprise sur erreur, limitation de débit), que les Edge Functions ne couvrent pas
seules.

```
┌──────────────────────────────────────────────────────────────────┐
│  React PWA (hors-ligne d'abord, Dexie)  — existant               │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Supabase JS (JWT avec org_id)
┌────────────────────────────▼─────────────────────────────────────┐
│  Postgres + RLS multi-locataire                                  │
│  organizations · memberships · social_connections (chiffré)       │
│  + toutes les tables métier existantes, avec org_id ajouté        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌──────────────────┬─────────▼──────────┬──────────────────────────┐
│ Edge Functions   │ Ordonnanceur       │ Couche connecteurs       │
│ (webhooks, OAuth)│ (pg_cron + file)   │ 1 adaptateur / plateforme│
└──────────────────┴────────────────────┴─────────┬────────────────┘
                                                  │
        ┌──────────────┬──────────────┬───────────┴──────┬─────────────┐
     Meta Graph    WhatsApp Cloud   Meta Marketing    TikTok        PawaPay
     (FB + IG)         API              API          Open API       CinetPay
```

### 4.1 Multi-locataire (le chantier fondateur)

```sql
-- Nouvelles tables
organizations (id, name, country, currency, plan, trial_ends_at, created_at)
memberships   (org_id, user_id, role, invited_by, accepted_at)

-- Sur CHAQUE table métier existante
ALTER TABLE <table> ADD COLUMN org_id uuid NOT NULL REFERENCES organizations(id);
CREATE INDEX <table>_org_idx ON <table>(org_id);
```

Le motif RLS, en prolongement de `private.get_my_role()` qui existe déjà :

```sql
CREATE OR REPLACE FUNCTION private.current_org() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT org_id FROM public.memberships
   WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
   LIMIT 1;
$$;

-- Toute policy devient : isolation d'abord, rôle ensuite
CREATE POLICY marketing_orders_select ON public.marketing_orders
  FOR SELECT TO authenticated
  USING (org_id = private.current_org() AND private.get_my_role() >= 4);
```

**Règles de sécurité non négociables :**
- `org_id` en `NOT NULL`, jamais fourni par le client : rempli par un trigger
  `BEFORE INSERT` depuis `private.current_org()`.
- Tester l'isolation avec un **test automatisé** qui crée deux organisations et
  vérifie qu'aucune ligne ne fuit. Une fuite inter-clients = fin du produit.
- Toute Edge Function utilisant `SUPABASE_SERVICE_ROLE_KEY` contourne les RLS :
  elle doit **filtrer explicitement par `org_id`** dans chaque requête.

### 4.2 Secrets par locataire (le deuxième chantier fondateur)

Il faut sortir les jetons des variables d'environnement.

```sql
CREATE TABLE social_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN
                      ('facebook','instagram','whatsapp','tiktok')),
  external_id       text NOT NULL,        -- page_id, ig_user_id, phone_number_id, open_id
  display_name      text,
  access_token_enc  bytea NOT NULL,       -- chiffré (Vault / pgsodium), jamais en clair
  refresh_token_enc bytea,
  scopes            text[],
  expires_at        timestamptz,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','expired','revoked','error')),
  last_error        text,
  connected_by      uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX social_connections_platform_external_key
  ON social_connections(platform, external_id);
```

- **Aucune policy RLS de lecture du jeton pour `authenticated`.** Le front ne
  voit que `platform`, `display_name`, `status`, `expires_at`. Les jetons ne
  sont lus que par les Edge Functions en `service_role`.
- Un travail de fond rafraîchit les jetons longue durée avant expiration et
  bascule `status` à `expired` sinon, pour déclencher une invite de reconnexion.
- L'index unique sur `(platform, external_id)` est ce qui permet au webhook
  entrant de **router un événement vers la bonne organisation** : Meta envoie un
  `page_id` / `phone_number_id`, on remonte à l'`org_id`.

### 4.3 Couche connecteurs

Un adaptateur par plateforme, derrière une interface commune :

```ts
interface ChannelAdapter {
  publish(conn: Connection, post: NormalizedPost): Promise<PublishResult>;
  sendMessage(conn: Connection, to: string, msg: OutboundMessage): Promise<void>;
  parseWebhook(payload: unknown): NormalizedEvent[];
  refreshToken(conn: Connection): Promise<Connection>;
  capabilities(): Capabilities;   // formats, limites, ce qui est supporté
}
```

C'est ce qui évite que la logique de chaque plateforme se répande dans les
écrans. `meta-webhook/index.ts` fait déjà exactement ce travail de
normalisation (`channel`, `extractWhatsappText`) : c'est le bon modèle, il faut
le généraliser et y ajouter la résolution du locataire.

### 4.4 Ordonnanceur et file d'attente

Nécessaire pour : publications planifiées, diffusions groupées, relances,
rafraîchissement de jetons, synchronisation des statistiques de campagnes.

```sql
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,              -- publish_post, send_broadcast, sync_insights...
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending',   -- pending|running|done|failed
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs(status, run_at) WHERE status = 'pending';
```

`pg_cron` déclenche une Edge Function toutes les minutes ; celle-ci prend les
travaux dus avec `FOR UPDATE SKIP LOCKED`, exécute, réessaie avec un délai
exponentiel. **Limitation de débit par organisation** obligatoire : les quotas
d'API Meta/TikTok sont par application, donc un client bruyant peut faire
bloquer *tous* les autres.

### 4.5 Abonnement et mesure d'usage

```sql
plans              (code, name, price_xaf, max_channels, max_posts_month,
                    max_conversations_month, features jsonb)
subscriptions      (org_id, plan_code, status, current_period_end,
                    provider, provider_ref)
usage_counters     (org_id, period, metric, value)   -- posts, conversations, ads
```

Les quotas se vérifient **avant** l'action (publier, diffuser) et l'usage
s'incrémente après succès. `payment_requests` et les intégrations PawaPay /
CinetPay existantes servent à encaisser l'abonnement en Mobile Money — un
avantage décisif sur un marché où peu de gens ont une carte bancaire.

---

## 5. Les murs à connaître avant de coder

C'est ici que la plupart des projets de ce type échouent. Aucun de ces points
n'est un détail technique : chacun peut décaler le lancement de plusieurs mois.

### 5.1 WhatsApp — le canal le plus important et le plus contraint

- Il faut passer par la **WhatsApp Cloud API** (Meta). Un WhatsApp personnel ou
  WhatsApp Business classique ne s'automatise pas légalement : les bibliothèques
  non officielles font bannir le numéro, et ne sont pas une base de SaaS.
- Pour connecter **les numéros de tes clients**, tu dois devenir **Tech Provider
  / Solution Partner** chez Meta et intégrer **l'Embedded Signup** : le client
  crée son compte WhatsApp Business (WABA) et vérifie son numéro depuis ton
  interface. C'est une démarche administrative, pas seulement du code.
- Chaque client a besoin de : un numéro dédié non déjà utilisé sur WhatsApp, une
  vérification d'entreprise, des **modèles de messages approuvés** par Meta pour
  tout message sortant hors fenêtre de service.
- **Fenêtre de 24 h** : hors de ce délai après le dernier message du client, tu
  ne peux écrire qu'avec un modèle approuvé et payant.
- La messagerie est **payante à l'usage** (barème par catégorie de modèle :
  marketing, utilitaire, authentification ; service souvent gratuit dans la
  fenêtre). → Ce coût doit être **refacturé** ou plafonné par quota, sinon un
  seul client avec une grosse base te ruine. Vérifie le barème en vigueur et
  par pays.
- Le mot « diffusion groupée » doit être manié avec prudence : le marketing non
  sollicité fait chuter la note de qualité du numéro puis le fait suspendre.
  Prévois **le consentement (opt-in) et le désabonnement** dès le premier jour.

### 5.2 Meta App Review et vérification d'entreprise

Les permissions dont tu as besoin sont toutes en « accès avancé », donc soumises
à revue : publication de Pages, publication Instagram, gestion WhatsApp, gestion
des publicités, messagerie. Il faut prévoir :

- **Vérification de l'entreprise** (documents légaux de ta société).
- Une **vidéo de démonstration** par permission, montrant le parcours exact.
- Une politique de confidentialité, des conditions d'utilisation, et un
  **point de terminaison de suppression des données** fonctionnel.
- Une **évaluation de la protection des données** (Data Protection Assessment)
  à renouveler périodiquement dès que tu traites des données utilisateur.
- Compter **plusieurs semaines à plusieurs mois**, avec des refus et des
  itérations. **Démarre cette procédure très tôt**, en parallèle du
  développement, jamais à la fin.

### 5.3 Instagram

- La publication et la messagerie exigent un **compte professionnel** (Business
  ou Creator). Selon l'API choisie, il doit être lié à une Page Facebook.
- Pas de publication de stories IG par API dans les mêmes conditions que le
  feed ; les capacités diffèrent selon le type de contenu (image, carrousel,
  reel). Le composeur doit donc **désactiver proprement** ce qui n'est pas
  possible, plutôt que de faire échouer la publication.

### 5.4 TikTok

- Deux univers séparés : **Content Posting API** (publications organiques) et
  **Marketing API** (publicités). Deux demandes d'accès distinctes.
- Sans audit validé, la Content Posting API ne permet souvent que des
  publications **privées / brouillon** — inutilisable commercialement. L'audit
  est donc un prérequis, pas une option.
- Pas de messagerie directe par API : **TikTok ne peut pas alimenter ton inbox**.
  Le parcours réaliste reste : publicité/vidéo TikTok → lien en bio → WhatsApp.
  C'est déjà exactement ce que décrit `MarketingPage.tsx`. Assume-le dans le
  produit au lieu de promettre un inbox TikTok.

### 5.5 Publicités : qui paie ?

Point juridique et technique souvent découvert trop tard :

- Le budget publicitaire est dépensé sur le **compte publicitaire du client**,
  avec **son moyen de paiement** à lui. Ton SaaS pilote la campagne, il ne la
  finance pas.
- Techniquement : le client accorde l'accès à son Business Manager / compte
  publicitaire ; tu utilises un **jeton d'utilisateur système**.
- Vouloir facturer le budget pub à ta place (revente de média) te transforme en
  agence/revendeur : autre statut Meta, avance de trésorerie, risque de fraude
  et d'impayés. **À éviter au lancement.**
- Sur le marché visé, beaucoup de commerçants n'ont **pas de carte bancaire**
  pour alimenter un compte pub Meta. C'est un frein commercial réel : le module
  M4 aura moins d'usage que le M2/M3 au départ. **Raison supplémentaire de ne
  pas en faire la première brique.**

### 5.6 Données personnelles

Tu stockes les données de clients **de tes clients** (noms, téléphones,
conversations). Donc :

- Tu es sous-traitant : il faut un **contrat de traitement** avec chaque client.
- Suppression et export sur demande ; conservation limitée des contenus de
  conversation (les conditions des plateformes limitent ce que tu peux stocker
  et combien de temps).
- Chiffrement au repos des jetons et des contenus sensibles, journal d'audit
  (la table `audit_logs` existe déjà — à étendre avec `org_id`).
- Respecter les lois locales des pays visés (RGPD si des clients sont dans l'UE,
  et cadres nationaux africains émergents sur les données personnelles).

---

## 6. Modèle économique

Prix repères pour le marché visé (à valider par entretiens, en FCFA) :

| Plan | Cible | Prix indicatif / mois | Contenu |
|------|-------|----------------------|---------|
| **Gratuit / Essai** | Test | 0 (14–30 jours) | 1 canal, 10 publications, commandes illimitées |
| **Commerçant** | Vendeur solo | ~5 000 – 10 000 FCFA | 2 canaux, inbox, commandes, factures, stock |
| **Business** | PME 3–10 salariés | ~25 000 – 40 000 FCFA | 4 canaux, équipe, bot, comptabilité, rapports |
| **Pro / Agence** | Multi-boutiques | ~75 000 FCFA + | Multi-organisations, campagnes pub, API, marque blanche |

Principes :

- **Refacturer l'usage variable** : messages WhatsApp payants au-delà d'un
  quota inclus. Sinon ta marge disparaît sur les gros comptes.
- **Encaisser en Mobile Money** (PawaPay/CinetPay déjà en place) et non
  seulement par carte : sur ce marché, c'est déterminant.
- **Vendre le résultat, pas les fonctionnalités** : « vos commandes WhatsApp
  dans un carnet automatique, vos factures en 1 clic », pas « gestionnaire
  multicanal avec RBAC ».
- Facturation annuelle avec remise pour financer l'acquisition.

---

## 7. Étapes clés — feuille de route

Durées indicatives pour **1 développeur à temps plein**. Les phases 1 à 3
peuvent tourner en parallèle des démarches administratives de la phase 0.

### Phase 0 — Cadrage et démarches (semaines 1–2, en parallèle de tout le reste)

1. Choisir le segment et **interroger 10 à 15 commerçants** qui vendent déjà sur
   WhatsApp. Trois questions : comment prends-tu les commandes aujourd'hui ?
   qu'est-ce qui te fait perdre de l'argent ? paierais-tu X FCFA/mois ?
2. **Créer la société** (nécessaire pour la vérification Meta).
3. **Ouvrir l'app Meta de production** et lancer immédiatement : vérification
   d'entreprise, demandes de permissions avancées, candidature Tech Provider
   WhatsApp.
4. **Lancer la demande d'accès TikTok** (Content Posting + Marketing API).
5. Rédiger politique de confidentialité, CGU, contrat de sous-traitance.
6. Trancher : quel métier généraliser en premier (agroalimentaire ? prêt-à-
   porter ? cosmétique ?) — cela détermine le modèle produit/variante.

> ✅ **Fin de phase 0 :** dossiers déposés chez Meta et TikTok, positionnement
> validé par des entretiens réels, entité juridique existante.

### Phase 1 — Socle multi-locataire (semaines 3–8)

C'est **le chantier non contournable**. Rien de vendable ne peut exister avant.

1. Tables `organizations`, `memberships` ; inscription crée une organisation.
2. Migration : `org_id` sur toutes les tables métier, avec adossement des
   données existantes à une organisation « Mimsi Distribution ».
3. Réécriture systématique des policies RLS : `org_id = private.current_org()`
   **et** contrôle de rôle.
4. Trigger de remplissage automatique de `org_id`, refus des insertions sans.
5. Table `social_connections` avec jetons chiffrés ; **suppression des jetons
   des variables d'environnement** ; adaptation des Edge Functions pour lire la
   connexion du locataire.
6. Routage du webhook `meta-webhook` vers la bonne organisation via
   `(platform, external_id)`.
7. Sélecteur d'organisation + invitation d'équipe dans l'interface.
8. **Test d'isolation automatisé** : deux organisations, zéro fuite, en CI.

> ✅ **Fin de phase 1 :** deux entreprises distinctes utilisent la même instance
> sans jamais voir les données de l'autre, chacune avec sa propre Page Facebook.

### Phase 2 — Connexions self-service, studio et inbox (semaines 9–18)

1. **OAuth Facebook / Instagram** : « Connecter ma Page » de bout en bout,
   sélection de la Page et du compte IG, stockage chiffré, écran de santé des
   connexions.
2. **Embedded Signup WhatsApp** : le client branche son propre numéro.
3. **OAuth TikTok** (dès l'accès obtenu).
4. Bibliothèque média + composeur unique multi-format.
5. File `jobs` + `pg_cron` → **publications planifiées** et calendrier éditorial.
6. Généralisation de la publication : feed IG, reels, TikTok (en réutilisant
   `publish-to-facebook` comme modèle d'adaptateur).
7. **Inbox unifiée** : écran de conversation par client, tous canaux, assignation,
   réponses rapides, respect de la fenêtre de 24 h et des modèles WhatsApp.
8. Bouton **« Convertir en commande »** : de la conversation vers
   `marketing_orders` puis vers une commande réelle.
9. Consentement et désabonnement sur les diffusions groupées.

> ✅ **Fin de phase 2 :** un commerçant s'inscrit seul, connecte ses 4 comptes,
> planifie ses publications de la semaine, répond à ses clients dans un seul
> écran et transforme un message en commande. **C'est le produit minimum
> vendable.** Premiers clients payants ici.

### Phase 3 — Commerce généralisé (semaines 19–24)

1. Modèle **produits / variantes / prix** neutre, remplaçant progressivement
   `pot_types` & co. (garder la verticale boulangerie comme module optionnel).
2. Parcours commande → livraison → facture PDF → encaissement.
3. Branchement complet des paiements : le client encaisse **ses** clients en
   Mobile Money (comptes marchands par locataire).
4. Stock et réassort accessibles à un commerçant non spécialiste.
5. Fournisseurs et achats simplifiés.
6. Tableau de bord : canal le plus rentable, top produits, marge.
7. Onboarding guidé + import de contacts/produits depuis Excel.

> ✅ **Fin de phase 3 :** la boucle complète message → commande → stock →
> facture → paiement fonctionne pour n'importe quel commerçant.

### Phase 4 — Publicités (semaines 25–34, conditionné à l'accès Meta)

1. Liaison du compte publicitaire du client (Business Manager, jeton système).
2. Assistant de création de campagne (objectif « messages » en priorité : c'est
   celui qui alimente la boucle).
3. Audiences, dont audiences personnalisées issues de la base clients.
4. Synchronisation des statistiques et **retour sur dépense publicitaire réel**
   croisé avec les commandes encaissées — **l'argument de vente décisif**.
5. TikTok Ads si l'accès est accordé.

> ✅ **Fin de phase 4 :** le client voit « 12 000 FCFA de pub → 34 conversations
> → 11 commandes → 96 000 FCFA encaissés ». Aucun concurrent ne lui montre ça.

### Phase 5 — Industrialisation SaaS (semaines 35–42)

1. Plans, quotas, mesure d'usage, essai gratuit, relance d'abonnement.
2. Facturation récurrente en Mobile Money et par carte.
3. Console d'administration plateforme, supervision, alertes (Sentry est déjà
   en place), limitation de débit par organisation.
4. Centre d'aide, modèles de messages prêts à l'emploi par secteur,
   `UserManualModal` étendu.
5. Programme de parrainage / partenaires revendeurs locaux.

> ✅ **Fin de phase 5 :** acquisition, facturation et support tournent sans toi
> dans la boucle pour chaque nouveau client.

### Ordre de priorité, en une ligne

**Multi-locataire → connexions self-service → studio + inbox → commerce →
publicités → industrialisation.**

Ne fais **jamais** les publicités avant l'inbox : les publicités remplissent
l'inbox, et sans inbox la dépense publicitaire est perdue.

---

## 8. Ce qui existe déjà en open source sur GitHub

Réponse à ta question : **il existe beaucoup de projets libres qui couvrent une
moitié de ton idée, aucun qui couvre l'ensemble.** Les projets se répartissent en
deux familles qui ne se parlent pas.

### Famille A — Gestion des réseaux sociaux

| Projet | Étoiles | Licence | Ce qu'il fait | Ce qui manque par rapport à ton idée |
|--------|---------|---------|---------------|--------------------------------------|
| [Postiz](https://github.com/gitroomhq/postiz-app) | ~35,8 k | **AGPL-3.0** | Planification sur 30+ canaux dont FB, IG, TikTok ; IA ; analytics ; équipes ; serveur MCP | Pas de WhatsApp, pas de pub, **aucune gestion commerciale** |
| [Mixpost](https://mixpost.app/) | ~3,5 k | Lite **MIT**, Pro/Enterprise **payant** | Planification auto-hébergée, 11 réseaux, workflow de validation, multilingue | Idem : ni WhatsApp, ni commerce, ni Mobile Money |
| [Shoutrrr](https://github.com/coollabsio/shoutrrr) | — | Open source | Alternative à Buffer, calendrier unique, jetons chez soi | Périmètre purement publication |
| [Socioboard](https://github.com/socioboard) | — | Open source | Marketing + support + génération de leads | Projet ancien, pas de commerce |

### Famille B — Relation client multicanale

| Projet | Étoiles | Licence | Ce qu'il fait | Ce qui manque |
|--------|---------|---------|---------------|---------------|
| [Chatwoot](https://github.com/chatwoot/chatwoot) | ~36,8 k | **MIT** au cœur, dossier `enterprise/` sous licence commerciale | Inbox unifiée WhatsApp, Messenger, Instagram, email, SMS, Telegram ; bots ; équipes ; **multi-locataire natif** | **Pas de TikTok**, pas de publication/planification, pas de commandes/stock/factures, pas de pub. Pile Ruby on Rails. |

### Famille C — Gestion commerciale

| Projet | Licence | Ce qu'il fait | Ce qui manque |
|--------|---------|---------------|---------------|
| [Dolibarr](https://www.dolibarr.org/) | GPL | ERP/CRM mature : clients, fournisseurs, devis, factures, stock, compta | Réseaux sociaux : rien. Ergonomie datée, pas mobile/hors-ligne |
| [ERPNext](https://github.com/frappe/erpnext) | GPL-3.0 | ERP complet, très modulaire | Idem, et lourd à héberger |
| [Odoo Community](https://www.odoo.com/) | LGPL (communauté) | Suite modulaire, CRM + ventes + stock + compta | Modules réseaux sociaux limités ; la version utile est payante |
| [Akaunting](https://github.com/akaunting/akaunting) | GPL-3.0 | Compta, facturation, dépenses, stock ; place de marché d'extensions | Pas de réseaux sociaux |
| [IDURAR](https://github.com/idurar/idurar-erp-crm) | Fair-code | ERP/CRM MERN : facturation, stock, compta, RH | Pas de réseaux sociaux, projet jeune |
| [Axelor](https://github.com/axelor) | AGPL | ERP avec connecteurs annoncés WhatsApp / Instagram / Facebook | Java/lourd ; connecteurs superficiels, pas de publication ni de pub |

### Ce que cette analyse t'apprend

1. **Ton créneau est réel.** Personne ne relie publication + inbox + publicité +
   commandes + stock + factures + Mobile Money + hors-ligne + SYSCOHADA. Le vide
   se situe exactement à la jonction des familles A, B et C — c'est-à-dire
   précisément là où ton dépôt actuel est déjà à cheval.
2. **Attention aux licences.** Forker **Postiz (AGPL-3.0)** ou **Axelor (AGPL)**
   t'obligerait à publier le code source de ton SaaS, y compris tes
   modifications, à tes utilisateurs. **Incompatible avec un SaaS propriétaire**
   sauf licence commerciale négociée. Même vigilance pour Dolibarr/ERPNext/
   Akaunting en GPL. Les seules bases juridiquement confortables sont **MIT** :
   Mixpost Lite et le cœur de Chatwoot (en excluant `enterprise/`).
3. **Ne réécris pas ton produit sur une de ces bases.** Ta pile
   Supabase/React/TypeScript, ton hors-ligne et ta compta SYSCOHADA sont ton
   avantage ; les adopter voudrait dire repartir en PHP/Laravel (Mixpost),
   Rails (Chatwoot) ou Java (Axelor) et **perdre 18 mois de travail déjà fait**.
4. **Sers-t'en comme référence, pas comme fondation.** Trois lectures rentables :
   - **Chatwoot** (MIT) : le modèle de données des conversations multicanales et
     l'isolation multi-locataire. Lis le schéma, réimplémente-le sur Postgres.
   - **Mixpost Lite** (MIT) : le motif d'adaptateur par réseau et la file de
     publications planifiées.
   - **Postiz** : la couverture de plateformes et les parcours de connexion —
     à lire pour l'inspiration produit, **pas à copier** (AGPL).
5. **Le planificateur est devenu une commodité.** Vingt projets libres le font
   gratuitement. Ne construis pas ton produit *autour* du planificateur : c'est
   une case à cocher. Ta valeur, c'est la boucle **message → commande → stock →
   facture → Mobile Money**, et le calcul du retour réel sur dépense
   publicitaire. Aucun projet libre ne peut te le disputer.

Sources : [Postiz](https://github.com/gitroomhq/postiz-app) ·
[Chatwoot](https://github.com/chatwoot/chatwoot) ·
[Mixpost](https://mixpost.app/) ·
[Shoutrrr](https://github.com/coollabsio/shoutrrr) ·
[Dolibarr](https://www.dolibarr.org/) ·
[IDURAR](https://github.com/idurar/idurar-erp-crm) ·
[GitHub topic `social-media-management`](https://github.com/topics/social-media-management) ·
[comparatif open source de planificateurs](https://postiz.com/blog/open-source-social-media-scheduler) ·
[comparatif ERP/CRM open source](https://www.nocobase.com/en/blog/top-10-most-starred-open-source-erp-and-crm-on-github)

---

## 9. Risques principaux

| Risque | Impact | Comment le réduire |
|--------|--------|--------------------|
| Refus ou lenteur de la revue Meta | 🔴 Bloque le lancement | Déposer dès la semaine 1 ; prévoir un mode dégradé « saisie manuelle » (déjà supporté par `marketing_orders`) pour vendre sans attendre |
| Fuite de données entre locataires | 🔴 Fin du produit | `org_id NOT NULL` + RLS systématique + test d'isolation en CI + audit des fonctions `service_role` |
| Coût des messages WhatsApp non maîtrisé | 🔴 Marge négative | Quotas par plan, refacturation de l'usage, plafond par organisation |
| Suspension d'un numéro pour spam | 🟠 Client perdu | Consentement obligatoire, désabonnement, surveillance de la note de qualité, garde-fous dans le produit |
| Périmètre trop large | 🟠 Jamais de livraison | Respecter l'ordre de la section 7 ; publicités en phase 4, pas avant |
| Clients sans carte bancaire pour la pub | 🟠 Module M4 peu utilisé | Vendre d'abord M2/M3 ; explorer les intermédiaires locaux de rechargement de compte pub |
| Rupture d'API des plateformes | 🟠 Panne fonctionnelle | Couche adaptateur isolée, alertes Sentry, dégradation propre par canal |
| Changement de licence / dépendance à un projet libre | 🟡 Dette | Ne rien forker en AGPL/GPL ; réimplémenter les idées, pas le code |

---

## 10. Les cinq décisions à prendre maintenant

1. **Le segment de départ** : un seul secteur, un seul pays pour commencer.
2. **Le sort de la verticale boulangerie** : module optionnel conservé, ou
   extrait dans une organisation de démonstration ? (Recommandation : le
   conserver comme modèle et première référence client.)
3. **Le nom et l'entité juridique** — prérequis de la vérification Meta.
4. **Le prix du plan « Commerçant »** — à trancher après les 15 entretiens.
5. **Le budget de départ** : compte développeur Meta, vérification d'entreprise,
   Supabase en offre payante, nom de domaine, comptes marchands PawaPay/CinetPay.

**La toute première ligne de code à écrire reste la même quelle que soit la
réponse à ces cinq questions : la migration multi-locataire.** Tant qu'elle
n'existe pas, chaque fonctionnalité ajoutée devra être réécrite.
