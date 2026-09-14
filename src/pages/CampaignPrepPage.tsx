import { useEffect, useState, useCallback } from 'react';
import {
  supabase, MarketingChannel, MARKETING_CHANNEL_LABELS,
  AutoReplySetting, AutoReplyChannel, Broadcast, BroadcastChannelFilter,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useToast } from '@/contexts/ToastContext';
import {
  Facebook, Instagram, MessageCircle, Music2,
  Target, Calendar, Users, Lightbulb, Loader2, Bot, Radio, Save,
} from 'lucide-react';

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
  const [channel, setChannel] = useState<MarketingChannel>('facebook');

  const [autoReplySettings, setAutoReplySettings] = useState<AutoReplySetting[]>([]);
  const [autoReplyLoading, setAutoReplyLoading] = useState(true);
  const [autoReplyDrafts, setAutoReplyDrafts] = useState<Record<string, string>>({});
  const [autoReplySaving, setAutoReplySaving] = useState<string | null>(null);

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

  const hasAutoReply = channel === 'facebook' || channel === 'whatsapp' || channel === 'instagram';
  const hasBroadcast = hasAutoReply;
  const strategy = STRATEGIES.find((s) => s.channel === channel);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2"><Target className="w-5 h-5 text-amber-600" /> Préparation de campagne</h1>
        <p className="text-sm text-gray-500 mt-1">Toutes les stratégies par réseau, ainsi que le bot de bienvenue et la diffusion groupée pour préparer puis lancer une campagne.</p>
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

      {strategy && (
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

      {hasAutoReply && (() => {
        const setting = autoReplySettings.find((s) => s.channel === channel);
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
            <p className="text-sm text-gray-600">Envoie automatiquement ce message au tout premier contact d'un client (une seule fois, pas à chaque message).</p>
            {autoReplyLoading ? (
              <div className="text-sm text-gray-400">Chargement…</div>
            ) : (
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
            )}
          </div>
        );
      })()}

      {hasBroadcast && (() => {
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

      {!hasAutoReply && !hasBroadcast && (
        <p className="text-xs text-gray-400 px-1">Le bot et la diffusion groupée arriveront ici dès qu'une intégration technique existera pour TikTok.</p>
      )}
    </div>
  );
}
