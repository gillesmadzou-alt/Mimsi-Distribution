-- Fait évoluer le bot de réponse automatique (auto_reply_settings) d'un
-- simple message de bienvenue "envoyé une fois" vers un vrai bot
-- conversationnel optionnel, propulsé par un LLM (Anthropic Claude), qui
-- peut échanger plusieurs messages avec le client en gardant le contexte.
--
-- Le mode "simple" (comportement historique) reste le défaut pour chaque
-- canal : rien ne change tant que l'équipe ne bascule pas explicitement un
-- canal en mode "conversational" depuis la page Préparation de campagne.

ALTER TABLE public.auto_reply_settings
  ADD COLUMN mode text NOT NULL DEFAULT 'simple' CHECK (mode IN ('simple', 'conversational')),
  ADD COLUMN system_prompt text;

COMMENT ON COLUMN public.auto_reply_settings.mode IS
  'simple = message unique envoyé au premier contact (comportement historique). conversational = bot IA qui répond à chaque message tant qu''un humain n''a pas repris la conversation.';
COMMENT ON COLUMN public.auto_reply_settings.system_prompt IS
  'Prompt système donné au LLM en mode conversational (qui est le bot, produits/prix/zones/horaires Mimsi, ton, quand dire "je ne sais pas"...).';

-- Une ligne par conversation (canal + identifiant client). bot_active
-- matérialise la règle de handoff bot -> humain : dès qu'un membre de
-- l'équipe répond manuellement à ce client (voir send-facebook-message),
-- bot_active passe à false et le bot IA se tait pour ce fil tant que
-- personne ne le réactive.
CREATE TABLE public.bot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'facebook', 'instagram')),
  customer_phone text NOT NULL,
  bot_active boolean NOT NULL DEFAULT true,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, customer_phone)
);

ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.bot_conversations TO authenticated;

CREATE POLICY bot_conversations_select
  ON public.bot_conversations FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY bot_conversations_update
  ON public.bot_conversations FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 4)
  WITH CHECK (private.get_my_role() >= 4);

CREATE TRIGGER bot_conversations_set_updated_at
  BEFORE UPDATE ON public.bot_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.bot_conversations IS
  'Une ligne par (canal, client) suivi par le bot conversationnel : bot_active porte la règle de handoff bot -> humain.';

-- Historique des messages échangés (nécessaire pour donner du contexte au
-- LLM à chaque tour) + suivi du coût (tokens) par message généré par le bot.
CREATE TABLE public.bot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.bot_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bot_messages_conversation_created_idx
  ON public.bot_messages(conversation_id, created_at);

ALTER TABLE public.bot_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.bot_messages TO authenticated;

CREATE POLICY bot_messages_select
  ON public.bot_messages FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

COMMENT ON TABLE public.bot_messages IS
  'Historique des messages du bot conversationnel (contexte pour le LLM) avec tokens consommés par réponse, pour le suivi de coût.';
