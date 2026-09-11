# Automatisation des commandes Facebook / WhatsApp / Instagram / TikTok

Ce guide t'accompagne pour faire arriver automatiquement, dans l'onglet
**Marketing > Commandes reçues** de l'application, les commandes/messages
reçus sur les réseaux sociaux — via [n8n](https://n8n.io).

Vue d'ensemble de l'architecture :

```
Client écrit sur      Meta / TikTok       n8n (workflow)         App Mimsi Distribution
FB / WhatsApp   ───►  envoie un      ───► normalise et    ───►  (table marketing_orders,
/ IG / TikTok         webhook              transmet              onglet Commandes reçues)
```

Ce qui est **déjà prêt dans le code de l'app** (rien à développer) :

- La table `marketing_orders` ([supabase/migrations/20260910160509_add_marketing_orders.sql](../supabase/migrations/20260910160509_add_marketing_orders.sql))
- La fonction qui reçoit les commandes normalisées depuis n8n : `receive-marketing-order` ([supabase/functions/receive-marketing-order/index.ts](../supabase/functions/receive-marketing-order/index.ts))
- La page **Marketing** dans l'app (stratégie, liste des commandes, statut)
- Un modèle de workflow n8n prêt à importer : [n8n/mimsi-marketing-orders-workflow.json](n8n/mimsi-marketing-orders-workflow.json)

Ce qu'il **reste à faire côté comptes** (aucune ligne de code) :

## 1. Déployer la table et la fonction sur ton projet Supabase

Si tu utilises la CLI Supabase :

```bash
supabase db push
supabase functions deploy receive-marketing-order
supabase secrets set MARKETING_WEBHOOK_SECRET=<valeur-longue-aleatoire-a-toi-de-choisir>
```

Sinon, ouvre le projet dans **Bolt.new** (`sb1-gwcarmm4`) et demande à l'agent
Bolt d'appliquer la migration `20260910160509_add_marketing_orders.sql` et de
déployer la fonction `receive-marketing-order` — Bolt gère ça directement.

Génère un secret aléatoire pour `MARKETING_WEBHOOK_SECRET`, par exemple avec :

```bash
openssl rand -hex 32
```

Garde cette valeur, tu en auras besoin à l'étape 4.

## 2. Créer un compte n8n

Deux options :

- **n8n Cloud** (le plus simple pour démarrer) : [n8n.io](https://n8n.io) → créer un compte.
- **Auto-hébergé** (Docker, Railway, etc.) si tu préfères garder le contrôle total.

## 3. Configurer Meta for Developers (WhatsApp + Facebook + Instagram)

Les trois canaux partagent une seule app et un seul abonnement webhook.

1. Va sur [developers.facebook.com](https://developers.facebook.com) → **Mes apps** → **Créer une app** → type "Entreprise".
2. Ajoute les produits : **WhatsApp**, **Messenger**, **Instagram**.
3. Dans **WhatsApp > Configuration** : associe ton numéro WhatsApp Business (ou utilise le numéro de test pour commencer).
4. Dans **Messenger/Instagram > Paramètres** puis **Webhooks** : renseigne :
   - **URL de rappel** : l'URL du webhook n8n "Meta - Vérification/Évènements" (visible dans n8n une fois le workflow importé et activé, sous la forme `https://<ton-n8n>/webhook/mimsi-marketing/meta`).
   - **Jeton de vérification** : une valeur que tu inventes toi-même — reporte-la dans le nœud "Token de vérification correct ?" du workflow n8n (remplace `CHANGE_ME_META_VERIFY_TOKEN`).
5. Abonne-toi aux champs : `messages` (WhatsApp), `messages` (Messenger), `messages` (Instagram).
6. Passe l'app en mode **Live** (nécessite la vérification business Meta — ça peut prendre quelques jours).

## 4. Configurer TikTok for Business

1. Va sur [developers.tiktok.com](https://developers.tiktok.com) → crée une app.
2. Selon ton besoin : **TikTok Lead Generation** (formulaires de leads sur les pubs) ou **TikTok Shop** (si tu vends directement dessus).
3. Renseigne l'URL webhook n8n "TikTok - Évènements" (`https://<ton-n8n>/webhook/mimsi-marketing/tiktok`).
4. Le format exact du payload TikTok dépend du produit choisi — adapte le nœud "Normaliser (TikTok)" du workflow en conséquence une fois que tu reçois un premier évènement réel (regarde les logs d'exécution dans n8n).

## 5. Importer et configurer le workflow n8n

1. Dans n8n : **Workflows** → **Import from File** → sélectionne [n8n/mimsi-marketing-orders-workflow.json](n8n/mimsi-marketing-orders-workflow.json).
2. Ouvre le nœud **"Envoyer à Mimsi Distribution"** et remplace :
   - L'URL par celle affichée dans l'app (onglet **Marketing > Automatisation**), du type `https://<ton-projet>.supabase.co/functions/v1/receive-marketing-order`.
   - La valeur de l'en-tête `x-webhook-secret` par le secret généré à l'étape 1.
3. Ouvre le nœud **"Token de vérification correct ?"** et remplace `CHANGE_ME_META_VERIFY_TOKEN` par le jeton choisi à l'étape 3.
4. **Active** le workflow (bouton en haut à droite dans n8n).
5. Retourne dans Meta for Developers et clique sur **Vérifier et enregistrer** pour le webhook — si tout est correct, il passe au vert.

## 6. Tester

Avant même d'avoir les comptes réseaux sociaux vérifiés, tu peux tester le
point d'entrée directement :

```bash
curl -X POST "https://<ton-projet>.supabase.co/functions/v1/receive-marketing-order" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <ton-secret>" \
  -d '{"channel":"whatsapp","customer_name":"Test Client","customer_phone":"+242000000000","message":"Je voudrais 2 pots de madeleines"}'
```

Si tout fonctionne, la commande apparaît immédiatement dans l'app,
onglet **Marketing > Commandes reçues**.

## Notes

- Tant que l'automatisation n'est pas branchée, le personnel peut continuer à
  saisir manuellement les commandes reçues par téléphone/réseaux via le
  bouton **"Saisir une commande reçue"** dans l'app — rien ne bloque en
  attendant.
- La vérification business Meta (nécessaire pour sortir du mode test) peut
  prendre plusieurs jours ; commence cette démarche tôt.
- Le secret `MARKETING_WEBHOOK_SECRET` ne doit jamais être exposé côté
  client (navigateur) — il ne vit que côté Supabase et côté n8n.
