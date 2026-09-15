import { useEffect, useState, useCallback } from 'react';
import {
  supabase, MarketingChannel, MARKETING_CHANNEL_LABELS,
  AutoReplySetting, AutoReplyChannel, AutoReplyMode, Broadcast, BroadcastChannelFilter,
  CampaignSupportDraft,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useToast } from '@/contexts/ToastContext';
import {
  Facebook, Instagram, MessageCircle, Music2,
  Target, Calendar, Users, Lightbulb, Loader2, Bot, Radio, Save,
  FileEdit, Sparkles, Trash2, Plus,
} from 'lucide-react';

type PrepTab = 'strategie' | 'support';

const CHANNELS: { id: MarketingChannel; label: string; icon: typeof Facebook; iconColor: string }[] = [
  { id: 'facebook', label: 'Facebook', icon: Facebook, iconColor: 'text-blue-600' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, iconColor: 'text-emerald-600' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, iconColor: 'text-pink-600' },
  { id: 'tiktok', label: 'TikTok', icon: Music2, iconColor: 'text-gray-900' },
];

const BROADCAST_CHANNEL_LABELS: Record<BroadcastChannelFilter, string> = {
  all: 'Tous les canaux',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

interface ChannelStrategy {
  channel: MarketingChannel;
  icon: typeof Facebook;
  iconColor: string;
  objective: string;
  audience: string;
  cadence: string;
  contentPillars: string[];
  cta: string;
}

const STRATEGIES: ChannelStrategy[] = [
  {
    channel: 'facebook',
    icon: Facebook,
    iconColor: 'text-blue-600',
    objective: "Notoriété locale et fidélisation : toucher les quartiers desservis et animer une communauté de clients réguliers.",
    audience: "Ménages et commerces (boutiques, kiosques) des zones déjà livrées + familles élargies qui partagent/recommandent.",
    cadence: '3 à 4 publications / semaine (photos produit, coulisses de fabrication, avis clients).',
    contentPillars: [
      'Photos des madeleines fraîches du jour + lieux de vente (preuve sociale)',
      'Coulisses production (pétrissage, cuisson) pour la confiance qualité',
      'Témoignages et avis de points de vente partenaires',
      'Offres ponctuelles (quantité, événements, mariages)',
    ],
    cta: "Bouton « Envoyer un message » → redirige vers WhatsApp pour passer commande.",
  },
  {
    channel: 'whatsapp',
    icon: MessageCircle,
    iconColor: 'text-emerald-600',
    objective: "Canal de commande principal : c'est ici que la conversation se transforme en vente, pas seulement en visibilité.",
    audience: "Clients chauds (ont déjà vu une publicité FB/IG/TikTok) et clients récurrents (boutiques, particuliers, commandes mariage).",
    cadence: "Réponse en continu (objectif < 15 min en heures ouvrées) + statuts WhatsApp quotidiens (produit du jour, stock).",
    contentPillars: [
      'Catalogue WhatsApp Business (photos, prix, types de pots)',
      'Message de bienvenue automatique + menu rapide (commander / suivi / horaires)',
      'Statuts quotidiens : dispo du jour, zones de livraison, ruptures',
      'Confirmation de commande automatisée dès réception',
    ],
    cta: "Numéro WhatsApp Business unique, relayé partout (bio IG/TikTok, posts FB, tournées).",
  },
  {
    channel: 'instagram',
    icon: Instagram,
    iconColor: 'text-pink-600',
    objective: "Image de marque et acquisition de nouveaux clients hors zone historique (visuel, aspirationnel).",
    audience: "Jeunes urbains, amateurs de pâtisserie artisanale, organisateurs d'événements (mariages, anniversaires).",
    cadence: '3 posts/semaine + Stories quotidiennes + 1 Reel/semaine.',
    contentPillars: [
      'Reels courts : fabrication, emballage, livraison (format vertical, musique tendance)',
      'Carrousels « types de pots / formats » avec prix',
      'Stories interactives (sondages « quel parfum demain ? »)',
      'Mise en avant des commandes mariage/événements réalisées',
    ],
    cta: "Lien en bio → WhatsApp direct + bouton contact Instagram relié au même numéro.",
  },
  {
    channel: 'tiktok',
    icon: Music2,
    iconColor: 'text-gray-900',
    objective: "Portée virale et nouvelle clientèle jeune : montrer le savoir-faire artisanal de façon divertissante.",
    audience: "Audience large 18-35 ans, sensible aux formats courts et au storytelling « fait main / local ».",
    cadence: '2 à 3 vidéos/semaine, formats bruts et authentiques (pas trop léchés).',
    contentPillars: [
      'Journée type d’un pétrisseur / d’un commercial en tournée',
      'ASMR fabrication (pâte, cuisson, mise en pot)',
      'Avant/après emballage, dégustations réaction client',
      'Tendances/sons populaires détournés pour la marque',
    ],
    cta: "Lien bio TikTok → WhatsApp. TikTok Shop / formulaire de leads en option plus tard.",
  },
];

export default function CampaignPrepPage() {
  const { toast } = useToast();
  const { isOffline } = useOfflineFetch();
  const [tab, setTab] = useState<PrepTab>('strategie');
  const [channel, setChannel] = useState<MarketingChannel>('facebook');

  const [autoReplySettings, setAutoReplySettings] = useState<AutoReplySetting[]>([]);
  const [autoReplyLoading, setAutoReplyLoading] = useState(true);
  const [autoReplyDrafts, setAutoReplyDrafts] = useState<Record<string, string>>({});
  const [systemPromptDrafts, setSystemPromptDrafts] = useState<Record<string, string>>({});
  const [autoReplySaving, setAutoReplySaving] = useState<string | null>(null);

  const [supportDrafts, setSupportDrafts] = useState<CampaignSupportDraft[]>([]);
  const [supportDraftsLoading, setSupportDraftsLoading] = useState(true);
  const [newDraftTitle, setNewDraftTitle] = useState('');
  const [newDraftBody, setNewDraftBody] = useState('');
  const [newDraftCta, setNewDraftCta] = useState('');
  const [newDraftSaving, setNewDraftSaving] = useState(false);

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(true);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);

  const loadAutoReplySettings = useCallback(async () => {
    setAutoReplyLoading(true);
    const { data, error } = await supabase.from('auto_reply_settings').select('*');
    if (!error && data) {
      const rows = data as AutoReplySetting[];
      setAutoReplySettings(rows);
      setAutoReplyDrafts((prev) => {
        const next = { ...prev };
        for (const r of rows) if (next[r.channel] === undefined) next[r.channel] = r.message;
        return next;
      });
      setSystemPromptDrafts((prev) => {
        const next = { ...prev };
        for (const r of rows) if (next[r.channel] === undefined) next[r.channel] = r.system_prompt ?? '';
        return next;
      });
    }
    setAutoReplyLoading(false);
  }, []);

  useEffect(() => { loadAutoReplySettings(); }, [loadAutoReplySettings]);
  useRealtimeSubscription('campaign-prep-auto-reply', isOffline ? [] : ['auto_reply_settings'], loadAutoReplySettings);

  const toggleAutoReply = async (ch: AutoReplyChannel, enabled: boolean) => {
    setAutoReplySettings((prev) => prev.map((s) => (s.channel === ch ? { ...s, enabled } : s)));
    const { error } = await supabase.from('auto_reply_settings').update({ enabled }).eq('channel', ch);
    if (error) {
      toast('Impossible de mettre à jour le bot.', 'error');
      loadAutoReplySettings();
    }
  };

  const setAutoReplyMode = async (ch: AutoReplyChannel, mode: AutoReplyMode) => {
    setAutoReplySettings((prev) => prev.map((s) => (s.channel === ch ? { ...s, mode } : s)));
    const { error } = await supabase.from('auto_reply_settings').update({ mode }).eq('channel', ch);
    if (error) {
      toast('Impossible de changer le mode du bot.', 'error');
      loadAutoReplySettings();
    }
  };

  const saveAutoReplyMessage = async (ch: AutoReplyChannel) => {
    const message = (autoReplyDrafts[ch] ?? '').trim();
    if (!message) {
      toast('Le message ne peut pas être vide.', 'error');
      return;
    }
    setAutoReplySaving(ch);
    const { error } = await supabase.from('auto_reply_settings').update({ message }).eq('channel', ch);
    setAutoReplySaving(null);
    if (error) {
      toast('Impossible d\'enregistrer le message.', 'error');
      return;
    }
    toast('Message du bot enregistré.', 'success');
  };

  const saveSystemPrompt = async (ch: AutoReplyChannel) => {
    const system_prompt = (systemPromptDrafts[ch] ?? '').trim();
    setAutoReplySaving(ch);
    const { error } = await supabase.from('auto_reply_settings').update({ system_prompt: system_prompt || null }).eq('channel', ch);
    setAutoReplySaving(null);
    if (error) {
      toast("Impossible d'enregistrer le prompt.", 'error');
      return;
    }
    toast('Prompt du bot IA enregistré.', 'success');
  };

  const loadBroadcasts = useCallback(async () => {
    setBroadcastsLoading(true);
    const { data, error } = await supabase
      .from('broadcasts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);
    if (!error) setBroadcasts((data as Broadcast[]) ?? []);
    setBroadcastsLoading(false);
  }, []);

  useEffect(() => { loadBroadcasts(); }, [loadBroadcasts]);
  useRealtimeSubscription('campaign-prep-broadcasts', isOffline ? [] : ['broadcasts'], loadBroadcasts);

  const sendBroadcast = async (event: React.FormEvent, ch: BroadcastChannelFilter) => {
    event.preventDefault();
    if (!broadcastMessage.trim()) {
      toast('Le message est obligatoire.', 'error');
      return;
    }
    if (!window.confirm(`Envoyer ce message à tous les clients ${BROADCAST_CHANNEL_LABELS[ch]} connus ? Cette action est irréversible.`)) return;
    setBroadcastSending(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('broadcast-message', {
      body: { message: broadcastMessage.trim(), channel: ch },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setBroadcastSending(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? "Échec de la diffusion.", 'error');
      loadBroadcasts();
      return;
    }
    const result = data as { sent: number; failed: number; total: number };
    toast(`Diffusion envoyée : ${result.sent}/${result.total} réussis.`, result.failed > 0 ? 'error' : 'success');
    setBroadcastMessage('');
    loadBroadcasts();
  };

  const loadSupportDrafts = useCallback(async () => {
    setSupportDraftsLoading(true);
    const { data, error } = await supabase
      .from('campaign_support_drafts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) setSupportDrafts((data as CampaignSupportDraft[]) ?? []);
    setSupportDraftsLoading(false);
  }, []);

  useEffect(() => { if (tab === 'support') loadSupportDrafts(); }, [tab, loadSupportDrafts]);
  useRealtimeSubscription('campaign-prep-support-drafts', isOffline || tab !== 'support' ? [] : ['campaign_support_drafts'], loadSupportDrafts);

  const createSupportDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newDraftTitle.trim()) {
      toast('Le titre est obligatoire.', 'error');
      return;
    }
    setNewDraftSaving(true);
    const { error } = await supabase.from('campaign_support_drafts').insert({
      channel,
      title: newDraftTitle.trim(),
      body: newDraftBody.trim(),
      cta: newDraftCta.trim() || null,
    });
    setNewDraftSaving(false);
    if (error) {
      toast("Impossible d'enregistrer le brouillon.", 'error');
      return;
    }
    toast('Brouillon enregistré.', 'success');
    setNewDraftTitle('');
    setNewDraftBody('');
    setNewDraftCta('');
    loadSupportDrafts();
  };

  const deleteSupportDraft = async (id: string) => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    const { error } = await supabase.from('campaign_support_drafts').delete().eq('id', id);
    if (error) {
      toast('Impossible de supprimer.', 'error');
      return;
    }
    setSupportDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const copyDraftToClipboard = async (draft: CampaignSupportDraft) => {
    const text = [draft.title, draft.body, draft.cta].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Contenu copié.', 'success');
    } catch {
      toast('Impossible de copier automatiquement — sélectionnez le texte manuellement.', 'error');
    }
  };

  const hasAutoReply = channel === 'facebook' || channel === 'whatsapp' || channel === 'instagram';
  const hasBroadcast = hasAutoReply;
  const strategy = STRATEGIES.find((s) => s.channel === channel);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2"><Target className="w-5 h-5 text-amber-600" /> Préparation de campagne</h1>
        <p className="text-sm text-gray-500 mt-1">Stratégies par réseau, bot (message unique ou conversation IA), diffusion groupée et création de supports.</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('strategie')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === 'strategie' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Target className="w-4 h-4" /> Stratégies &amp; diffusion
        </button>
        <button
          onClick={() => setTab('support')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === 'support' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <FileEdit className="w-4 h-4" /> Création de support
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {CHANNELS.map(({ id, label, icon: Icon, iconColor }) => (
          <button
            key={id}
            onClick={() => setChannel(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              channel === id ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon className={`w-4 h-4 ${channel === id ? '' : iconColor}`} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'strategie' && strategy && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 ${strategy.iconColor}`}>
              <strategy.icon className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-gray-900 text-lg">Stratégie {MARKETING_CHANNEL_LABELS[strategy.channel]}</h3>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Target className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <p className="text-gray-700"><span className="font-medium">Objectif : </span>{strategy.objective}</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Users className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <p className="text-gray-700"><span className="font-medium">Audience : </span>{strategy.audience}</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <p className="text-gray-700"><span className="font-medium">Cadence : </span>{strategy.cadence}</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Lightbulb className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <div className="text-gray-700">
              <span className="font-medium">Contenus clés :</span>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-600">
                {strategy.contentPillars.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-sm text-amber-800">
            <span className="font-medium">Passage à l'action : </span>{strategy.cta}
          </div>
        </div>
      )}

      {tab === 'strategie' && hasAutoReply && (() => {
        const setting = autoReplySettings.find((s) => s.channel === channel);
        const mode = setting?.mode ?? 'simple';
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><Bot className="w-5 h-5 text-violet-600" /> Bot de réponse automatique</h3>
              <button
                onClick={() => toggleAutoReply(channel as AutoReplyChannel, !(setting?.enabled))}
                className={`relative w-10 rounded-full transition-colors ${setting?.enabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
                style={{ height: '22px' }}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${setting?.enabled ? 'translate-x-4' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setAutoReplyMode(channel as AutoReplyChannel, 'simple')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${mode === 'simple' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                Simple (message unique)
              </button>
              <button
                onClick={() => setAutoReplyMode(channel as AutoReplyChannel, 'conversational')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors ${mode === 'conversational' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                <Sparkles className="w-3.5 h-3.5" /> Conversationnel (IA)
              </button>
            </div>

            {autoReplyLoading ? (
              <div className="text-sm text-gray-400">Chargement…</div>
            ) : mode === 'simple' ? (
              <>
                <p className="text-sm text-gray-600">Envoie automatiquement ce message au tout premier contact d'un client (une seule fois, pas à chaque message).</p>
                <div className="flex items-center gap-2">
                  <input
                    value={autoReplyDrafts[channel] ?? ''}
                    onChange={(e) => setAutoReplyDrafts((prev) => ({ ...prev, [channel]: e.target.value }))}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
                  />
                  <button
                    onClick={() => saveAutoReplyMessage(channel as AutoReplyChannel)}
                    disabled={autoReplySaving === channel}
                    className="shrink-0 p-2 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
                    title="Enregistrer"
                  >
                    {autoReplySaving === channel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Répond à chaque message du client (pas une seule fois) en s'appuyant sur un LLM et l'historique de la conversation — jusqu'à ce qu'un membre de l'équipe réponde manuellement (le bot se met alors en pause pour ce client).
                </p>
                <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
                  Nécessite le secret Supabase <code className="font-mono">ANTHROPIC_API_KEY</code> côté serveur (à configurer une fois). Chaque réponse a un coût (tokens) — suivi dans la table <code className="font-mono">bot_messages</code>.
                </div>
                <label className="block text-xs font-medium text-gray-500">Prompt système (qui est le bot, produits/prix/zones/horaires, ton à adopter…)</label>
                <div className="flex items-start gap-2">
                  <textarea
                    value={systemPromptDrafts[channel] ?? ''}
                    onChange={(e) => setSystemPromptDrafts((prev) => ({ ...prev, [channel]: e.target.value }))}
                    rows={5}
                    placeholder="Ex : Tu es l'assistant de Mimsi Distribution. Nos madeleines coûtent... Nos zones de livraison sont... Nos horaires sont... Si tu ne sais pas, dis-le et propose de transmettre à l'équipe."
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
                  />
                  <button
                    onClick={() => saveSystemPrompt(channel as AutoReplyChannel)}
                    disabled={autoReplySaving === channel}
                    className="shrink-0 p-2 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
                    title="Enregistrer"
                  >
                    {autoReplySaving === channel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {tab === 'strategie' && hasBroadcast && (() => {
        const bcChannel = channel as BroadcastChannelFilter;
        const history = broadcasts.filter((b) => b.channel === bcChannel).slice(0, 5);
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Radio className="w-5 h-5 text-orange-600" /> Diffusion groupée {BROADCAST_CHANNEL_LABELS[bcChannel]}</h3>
            <p className="text-sm text-gray-600">Envoie un même message à tous les clients {BROADCAST_CHANNEL_LABELS[bcChannel]} qui nous ont déjà contactés.</p>
            <form onSubmit={(e) => sendBroadcast(e, bcChannel)} className="space-y-3">
              <textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Ex : Promo du jour : -10% sur les madeleines aujourd'hui uniquement !"
                rows={3}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500"
              />
              <button
                type="submit"
                disabled={broadcastSending}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
              >
                {broadcastSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                {broadcastSending ? 'Envoi en cours…' : 'Diffuser'}
              </button>
            </form>
            {!broadcastsLoading && history.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {history.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-800 truncate">{b.message}</p>
                      <p className="text-xs text-gray-400">{new Date(b.created_at).toLocaleString('fr-FR')}</p>
                    </div>
                    <span className={`shrink-0 ml-3 text-xs px-2 py-0.5 rounded-full font-medium ${
                      b.status === 'termine' ? 'bg-emerald-50 text-emerald-700' : b.status === 'echec' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {b.recipients_sent}/{b.recipients_total} envoyés
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {tab === 'strategie' && !hasAutoReply && !hasBroadcast && (
        <p className="text-xs text-gray-400 px-1">Le bot et la diffusion groupée arriveront ici dès qu'une intégration technique existera pour TikTok.</p>
      )}

      {tab === 'support' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-amber-600" /> Nouveau brouillon — {MARKETING_CHANNEL_LABELS[channel]}</h3>
            <form onSubmit={createSupportDraft} className="space-y-3">
              <input
                value={newDraftTitle}
                onChange={(e) => setNewDraftTitle(e.target.value)}
                placeholder="Titre / accroche"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
              />
              <textarea
                value={newDraftBody}
                onChange={(e) => setNewDraftBody(e.target.value)}
                placeholder="Texte du contenu (post, story, message...)"
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
              />
              <input
                value={newDraftCta}
                onChange={(e) => setNewDraftCta(e.target.value)}
                placeholder="Appel à l'action (optionnel) — ex : Commander sur WhatsApp"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={newDraftSaving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
              >
                {newDraftSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer le brouillon
              </button>
            </form>
          </div>

          <div className="space-y-3">
            {supportDraftsLoading ? (
              <div className="text-sm text-gray-400 px-1">Chargement…</div>
            ) : supportDrafts.length === 0 ? (
              <p className="text-sm text-gray-400 px-1">Aucun brouillon pour l'instant.</p>
            ) : (
              supportDrafts.map((d) => {
                const meta = CHANNELS.find((c) => c.id === d.channel);
                return (
                  <div key={d.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                        {meta && <meta.icon className={`w-3.5 h-3.5 ${meta.iconColor}`} />}
                        {meta?.label ?? d.channel}
                        <span className="text-gray-300">·</span>
                        {new Date(d.created_at).toLocaleDateString('fr-FR')}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => copyDraftToClipboard(d)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title="Copier">
                          <FileEdit className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteSupportDraft(d.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Supprimer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="font-semibold text-gray-900 text-sm">{d.title}</p>
                    {d.body && <p className="text-sm text-gray-600 whitespace-pre-wrap">{d.body}</p>}
                    {d.cta && <p className="text-xs text-amber-700 bg-amber-50 inline-block px-2 py-1 rounded-lg">{d.cta}</p>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
