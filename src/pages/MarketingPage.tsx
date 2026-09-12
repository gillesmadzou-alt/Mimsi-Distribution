import { useEffect, useState, useCallback } from 'react';
import {
  supabase, MarketingOrder, MarketingChannel, MarketingOrderStatus,
  MARKETING_CHANNEL_LABELS, MARKETING_CHANNEL_META,
  MARKETING_ORDER_STATUS_LABELS, MARKETING_ORDER_STATUS_META,
  FacebookPost, FacebookComment, AutoReplySetting, AutoReplyChannel,
  Broadcast, BroadcastChannelFilter, FacebookStory,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useToast } from '@/contexts/ToastContext';
import {
  Facebook, Instagram, MessageCircle, Music2, Inbox, Zap, Plus, X,
  Target, Calendar, Users, Lightbulb, Copy, CheckCircle2, ExternalLink,
  Send, Link2, AlertTriangle, Loader2, MessageSquare, EyeOff, Trash2, UserX, Reply,
  Bot, Radio, Save, Image as ImageIcon, Film,
} from 'lucide-react';

type Tab = 'strategie' | 'commandes' | 'commentaires' | 'publier' | 'automatisation';

const AUTO_REPLY_CHANNELS: AutoReplyChannel[] = ['whatsapp', 'facebook', 'instagram'];
const BROADCAST_CHANNEL_LABELS: Record<BroadcastChannelFilter, string> = {
  all: 'Tous les canaux',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

const FB_COMMENT_STATUS_LABELS: Record<FacebookComment['status'], string> = {
  nouveau: 'Nouveau',
  traite: 'Répondu',
  masque: 'Masqué',
  supprime: 'Supprimé',
};

const FB_COMMENT_STATUS_META: Record<FacebookComment['status'], { color: string; bgColor: string }> = {
  nouveau: { color: 'text-amber-700', bgColor: 'bg-amber-50' },
  traite: { color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  masque: { color: 'text-gray-600', bgColor: 'bg-gray-100' },
  supprime: { color: 'text-red-700', bgColor: 'bg-red-50' },
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
      'Confirmation de commande automatisée (n8n) dès réception',
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

export default function MarketingPage() {
  const { toast } = useToast();
  const { fetchWithCache, isOffline } = useOfflineFetch();
  const [tab, setTab] = useState<Tab>('strategie');
  const [orders, setOrders] = useState<MarketingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<'all' | MarketingChannel>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | MarketingOrderStatus>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const [fbPosts, setFbPosts] = useState<FacebookPost[]>([]);
  const [fbLoading, setFbLoading] = useState(true);
  const [fbMessage, setFbMessage] = useState('');
  const [fbLink, setFbLink] = useState('');
  const [publishing, setPublishing] = useState(false);

  const [fbComments, setFbComments] = useState<FacebookComment[]>([]);
  const [fbCommentsLoading, setFbCommentsLoading] = useState(true);
  const [commentReplyDrafts, setCommentReplyDrafts] = useState<Record<string, string>>({});
  const [commentActionBusy, setCommentActionBusy] = useState<string | null>(null);

  const [orderReplyDrafts, setOrderReplyDrafts] = useState<Record<string, string>>({});
  const [orderReplyBusy, setOrderReplyBusy] = useState<string | null>(null);
  const [openReplyFor, setOpenReplyFor] = useState<string | null>(null);

  const [autoReplySettings, setAutoReplySettings] = useState<AutoReplySetting[]>([]);
  const [autoReplyLoading, setAutoReplyLoading] = useState(true);
  const [autoReplyDrafts, setAutoReplyDrafts] = useState<Record<string, string>>({});
  const [autoReplySaving, setAutoReplySaving] = useState<string | null>(null);

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(true);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastChannel, setBroadcastChannel] = useState<BroadcastChannelFilter>('all');
  const [broadcastSending, setBroadcastSending] = useState(false);

  const [fbStories, setFbStories] = useState<FacebookStory[]>([]);
  const [fbStoriesLoading, setFbStoriesLoading] = useState(true);
  const [storyPreview, setStoryPreview] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const [storyPublishing, setStoryPublishing] = useState(false);

  const [form, setForm] = useState({
    channel: 'whatsapp' as MarketingChannel,
    customer_name: '',
    customer_phone: '',
    message: '',
  });

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('marketing_orders_page', async () => {
      const { data, error } = await supabase
        .from('marketing_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as MarketingOrder[];
    });
    if (!result.error) setOrders(result.data ?? []);
    setLoading(false);
  }, [fetchWithCache]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useRealtimeSubscription('marketing-page', isOffline ? [] : ['marketing_orders'], loadOrders);

  const loadFbPosts = useCallback(async () => {
    setFbLoading(true);
    const { data, error } = await supabase
      .from('facebook_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) setFbPosts((data as FacebookPost[]) ?? []);
    setFbLoading(false);
  }, []);

  useEffect(() => { loadFbPosts(); }, [loadFbPosts]);
  useRealtimeSubscription('marketing-page-fb', isOffline ? [] : ['facebook_posts'], loadFbPosts);

  const loadFbComments = useCallback(async () => {
    setFbCommentsLoading(true);
    const { data, error } = await supabase
      .from('facebook_comments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) setFbComments((data as FacebookComment[]) ?? []);
    setFbCommentsLoading(false);
  }, []);

  useEffect(() => { loadFbComments(); }, [loadFbComments]);
  useRealtimeSubscription('marketing-page-fb-comments', isOffline ? [] : ['facebook_comments'], loadFbComments);

  const commentAction = async (comment: FacebookComment, action: 'reply' | 'hide' | 'delete' | 'block') => {
    if (action === 'delete' && !window.confirm('Supprimer définitivement ce commentaire ?')) return;
    if (action === 'block' && !window.confirm(`Bloquer ${comment.from_name ?? 'cette personne'} sur la Page ? Elle ne pourra plus ni commenter ni écrire à la Page.`)) return;

    const message = action === 'reply' ? (commentReplyDrafts[comment.comment_id] ?? '').trim() : undefined;
    if (action === 'reply' && !message) {
      toast('Écris une réponse avant d\'envoyer.', 'error');
      return;
    }

    setCommentActionBusy(comment.comment_id);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('manage-facebook-comment', {
      body: { action, comment_id: comment.comment_id, message },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setCommentActionBusy(null);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? "Échec de l'action.", 'error');
      return;
    }
    const successLabels = { reply: 'Réponse publiée.', hide: 'Commentaire masqué.', delete: 'Commentaire supprimé.', block: 'Personne bloquée sur la Page.' };
    toast(successLabels[action], 'success');
    if (action === 'reply') setCommentReplyDrafts((prev) => ({ ...prev, [comment.comment_id]: '' }));
    loadFbComments();
  };

  const replyToOrder = async (order: MarketingOrder) => {
    const message = (orderReplyDrafts[order.id] ?? '').trim();
    if (!message) {
      toast('Écris une réponse avant d\'envoyer.', 'error');
      return;
    }
    if (!order.customer_phone) {
      toast('Identifiant du destinataire manquant.', 'error');
      return;
    }
    setOrderReplyBusy(order.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('send-facebook-message', {
      body: { recipient_id: order.customer_phone, message, order_id: order.id },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setOrderReplyBusy(null);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? "Échec de l'envoi.", 'error');
      return;
    }
    toast('Réponse envoyée sur Messenger.', 'success');
    setOrderReplyDrafts((prev) => ({ ...prev, [order.id]: '' }));
    setOpenReplyFor(null);
    loadOrders();
  };

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
  useRealtimeSubscription('marketing-page-auto-reply', isOffline ? [] : ['auto_reply_settings'], loadAutoReplySettings);

  const toggleAutoReply = async (channel: AutoReplyChannel, enabled: boolean) => {
    setAutoReplySettings((prev) => prev.map((s) => (s.channel === channel ? { ...s, enabled } : s)));
    const { error } = await supabase.from('auto_reply_settings').update({ enabled }).eq('channel', channel);
    if (error) {
      toast('Impossible de mettre à jour le bot.', 'error');
      loadAutoReplySettings();
    }
  };

  const saveAutoReplyMessage = async (channel: AutoReplyChannel) => {
    const message = (autoReplyDrafts[channel] ?? '').trim();
    if (!message) {
      toast('Le message ne peut pas être vide.', 'error');
      return;
    }
    setAutoReplySaving(channel);
    const { error } = await supabase.from('auto_reply_settings').update({ message }).eq('channel', channel);
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
      .limit(30);
    if (!error) setBroadcasts((data as Broadcast[]) ?? []);
    setBroadcastsLoading(false);
  }, []);

  useEffect(() => { loadBroadcasts(); }, [loadBroadcasts]);
  useRealtimeSubscription('marketing-page-broadcasts', isOffline ? [] : ['broadcasts'], loadBroadcasts);

  const sendBroadcast = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!broadcastMessage.trim()) {
      toast('Le message est obligatoire.', 'error');
      return;
    }
    if (!window.confirm('Envoyer ce message à tous les clients connus concernés ? Cette action est irréversible.')) return;
    setBroadcastSending(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('broadcast-message', {
      body: { message: broadcastMessage.trim(), channel: broadcastChannel },
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

  const publishToFacebook = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fbMessage.trim()) {
      toast('Le message est obligatoire.', 'error');
      return;
    }
    setPublishing(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('publish-to-facebook', {
      body: { message: fbMessage.trim(), link: fbLink.trim() || undefined },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setPublishing(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? "Échec de la publication.", 'error');
      loadFbPosts();
      return;
    }
    toast('Publié sur la Page Facebook.', 'success');
    setFbMessage('');
    setFbLink('');
    loadFbPosts();
  };

  const loadFbStories = useCallback(async () => {
    setFbStoriesLoading(true);
    const { data, error } = await supabase
      .from('facebook_stories')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error) setFbStories((data as FacebookStory[]) ?? []);
    setFbStoriesLoading(false);
  }, []);

  useEffect(() => { loadFbStories(); }, [loadFbStories]);
  useRealtimeSubscription('marketing-page-fb-stories', isOffline ? [] : ['facebook_stories'], loadFbStories);

  const handleStoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Seules les images sont prises en charge pour les Stories.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setStoryPreview({ base64: result, mimeType: file.type, previewUrl: result });
    };
    reader.readAsDataURL(file);
  };

  const publishStory = async () => {
    if (!storyPreview) {
      toast('Choisis une image avant de publier.', 'error');
      return;
    }
    setStoryPublishing(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('publish-facebook-story', {
      body: { image_base64: storyPreview.base64, mime_type: storyPreview.mimeType },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setStoryPublishing(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? 'Échec de la publication de la Story.', 'error');
      loadFbStories();
      return;
    }
    toast('Story publiée sur Facebook.', 'success');
    setStoryPreview(null);
    loadFbStories();
  };

  const updateStatus = async (id: string, status: MarketingOrderStatus) => {
    const { error } = await supabase.from('marketing_orders').update({ status }).eq('id', id);
    if (error) {
      toast("Impossible de mettre à jour le statut.", 'error');
      return;
    }
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
  };

  const submitManualOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.customer_name.trim() && !form.customer_phone.trim() && !form.message.trim()) {
      toast('Renseignez au moins un nom, un téléphone ou un message.', 'error');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('marketing_orders').insert({
      channel: form.channel,
      customer_name: form.customer_name.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      message: form.message.trim() || null,
      status: 'nouveau',
    });
    setSubmitting(false);
    if (error) {
      toast("Impossible d'enregistrer la commande.", 'error');
      return;
    }
    toast('Commande enregistrée.', 'success');
    setForm({ channel: 'whatsapp', customer_name: '', customer_phone: '', message: '' });
    setShowAdd(false);
    loadOrders();
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/receive-marketing-order`;
  const copyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const filteredOrders = orders.filter((o) => {
    if (channelFilter !== 'all' && o.channel !== channelFilter) return false;
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    return true;
  });

  const newCount = orders.filter((o) => o.status === 'nouveau').length;
  const newCommentsCount = fbComments.filter((c) => c.status === 'nouveau').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: 'strategie', label: 'Stratégie par canal', icon: Target },
          { id: 'commandes', label: `Commandes reçues${newCount ? ` (${newCount} nouvelles)` : ''}`, icon: Inbox },
          { id: 'commentaires', label: `Commentaires Facebook${newCommentsCount ? ` (${newCommentsCount})` : ''}`, icon: MessageSquare },
          { id: 'publier', label: 'Publier sur Facebook', icon: Send },
          { id: 'automatisation', label: 'Automatisation (n8n)', icon: Zap },
        ] as { id: Tab; label: string; icon: typeof Target }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              tab === id ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'strategie' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.channel} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 ${s.iconColor}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg">{MARKETING_CHANNEL_LABELS[s.channel]}</h3>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Target className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <p className="text-gray-700"><span className="font-medium">Objectif : </span>{s.objective}</p>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Users className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <p className="text-gray-700"><span className="font-medium">Audience : </span>{s.audience}</p>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <p className="text-gray-700"><span className="font-medium">Cadence : </span>{s.cadence}</p>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Lightbulb className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="text-gray-700">
                    <span className="font-medium">Contenus clés :</span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-600">
                      {s.contentPillars.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-sm text-amber-800">
                  <span className="font-medium">Passage à l'action : </span>{s.cta}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'commandes' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setChannelFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${channelFilter === 'all' ? 'bg-amber-500 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
              >
                Tous les canaux
              </button>
              {(Object.keys(MARKETING_CHANNEL_LABELS) as MarketingChannel[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setChannelFilter(c)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${channelFilter === c ? 'bg-amber-500 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                >
                  {MARKETING_CHANNEL_LABELS[c]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | MarketingOrderStatus)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">Tous les statuts</option>
                {(Object.keys(MARKETING_ORDER_STATUS_LABELS) as MarketingOrderStatus[]).map((s) => (
                  <option key={s} value={s}>{MARKETING_ORDER_STATUS_LABELS[s]}</option>
                ))}
              </select>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all"
              >
                <Plus className="w-4 h-4" />
                Saisir une commande reçue
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-400">Chargement…</div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
              <Inbox className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              Aucune commande pour l'instant. Une fois l'automatisation branchée (voir l'onglet « Automatisation »), les commandes venant de Facebook, WhatsApp, Instagram et TikTok apparaîtront ici automatiquement.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((o) => {
                const meta = MARKETING_CHANNEL_META[o.channel];
                const statusMeta = MARKETING_ORDER_STATUS_META[o.status];
                return (
                  <div key={o.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.bgColor} ${meta.color}`}>
                            {MARKETING_CHANNEL_LABELS[o.channel]}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.bgColor} ${statusMeta.color}`}>
                            {MARKETING_ORDER_STATUS_LABELS[o.status]}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(o.created_at).toLocaleString('fr-FR')}
                          </span>
                        </div>
                        <p className="font-medium text-gray-900 mt-1">{o.customer_name ?? 'Client sans nom'}</p>
                        {o.customer_phone && <p className="text-sm text-gray-500">{o.customer_phone}</p>}
                        {o.message && <p className="text-sm text-gray-600 mt-1">{o.message}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {o.channel === 'facebook' && o.customer_phone && (
                          <button
                            onClick={() => setOpenReplyFor(openReplyFor === o.id ? null : o.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
                          >
                            <Reply className="w-3.5 h-3.5" />
                            Répondre
                          </button>
                        )}
                        <select
                          value={o.status}
                          onChange={(e) => updateStatus(o.id, e.target.value as MarketingOrderStatus)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          {(Object.keys(MARKETING_ORDER_STATUS_LABELS) as MarketingOrderStatus[]).map((s) => (
                            <option key={s} value={s}>{MARKETING_ORDER_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {openReplyFor === o.id && (
                      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                        <input
                          value={orderReplyDrafts[o.id] ?? ''}
                          onChange={(e) => setOrderReplyDrafts((prev) => ({ ...prev, [o.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') replyToOrder(o); }}
                          placeholder="Répondre sur Messenger…"
                          className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => replyToOrder(o)}
                          disabled={orderReplyBusy === o.id}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          {orderReplyBusy === o.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'commentaires' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 text-sm">Commentaires sur les publications de la Page</h3>
            <p className="text-xs text-gray-500 mt-0.5">Répondre, masquer, supprimer un commentaire, ou bloquer une personne qui se comporte mal.</p>
          </div>
          {fbCommentsLoading ? (
            <div className="text-center py-16 text-gray-400">Chargement…</div>
          ) : fbComments.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              Aucun commentaire pour l'instant.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {fbComments.map((c) => {
                const statusMeta = FB_COMMENT_STATUS_META[c.status];
                const busy = commentActionBusy === c.comment_id;
                const isModerated = c.status === 'masque' || c.status === 'supprime';
                return (
                  <div key={c.id} className="px-5 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900">{c.from_name ?? 'Personne inconnue'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.bgColor} ${statusMeta.color}`}>
                            {FB_COMMENT_STATUS_LABELS[c.status]}
                          </span>
                          {c.created_time && (
                            <span className="text-xs text-gray-400">{new Date(c.created_time).toLocaleString('fr-FR')}</span>
                          )}
                        </div>
                        {c.message && <p className="text-sm text-gray-700 mt-1">{c.message}</p>}
                      </div>
                    </div>
                    {!isModerated && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          value={commentReplyDrafts[c.comment_id] ?? ''}
                          onChange={(e) => setCommentReplyDrafts((prev) => ({ ...prev, [c.comment_id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commentAction(c, 'reply'); }}
                          placeholder="Répondre au commentaire…"
                          className="flex-1 min-w-[180px] rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => commentAction(c, 'reply')}
                          disabled={busy}
                          title="Répondre"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Reply className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => commentAction(c, 'hide')}
                          disabled={busy}
                          title="Masquer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => commentAction(c, 'delete')}
                          disabled={busy}
                          title="Supprimer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => commentAction(c, 'block')}
                          disabled={busy}
                          title="Bloquer cette personne sur la Page"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'publier' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Send className="w-5 h-5 text-blue-600" /> Publier une annonce sur la Page Facebook</h3>
            <p className="text-sm text-gray-600">
              Publie directement un post sur la Page Facebook Mimsi Distribution — pratique pour annoncer une disponibilité,
              une promotion ou une actualité, sans quitter l'app.
            </p>
            <form onSubmit={publishToFacebook} className="space-y-3">
              <textarea
                value={fbMessage}
                onChange={(e) => setFbMessage(e.target.value)}
                placeholder="Ex : Madeleines fraîches disponibles aujourd'hui ! Commandez sur WhatsApp au ..."
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={fbLink}
                  onChange={(e) => setFbLink(e.target.value)}
                  placeholder="Lien à joindre (facultatif)"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={publishing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {publishing ? 'Publication…' : 'Publier maintenant'}
              </button>
            </form>
            <p className="text-xs text-gray-500">
              Nécessite que les secrets <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded">FACEBOOK_PAGE_ID</code> et
              <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded">FACEBOOK_PAGE_ACCESS_TOKEN</code> soient configurés côté
              Supabase (voir <code className="px-1 py-0.5 bg-gray-100 rounded">docs/marketing-automation-guide.md</code>).
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">Historique des publications</h3>
            </div>
            {fbLoading ? (
              <div className="text-center py-10 text-gray-400 text-sm">Chargement…</div>
            ) : fbPosts.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">Aucune publication envoyée pour l'instant.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {fbPosts.map((p) => (
                  <div key={p.id} className="px-5 py-3 flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      p.status === 'published' ? 'bg-emerald-50 text-emerald-600' : p.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {p.status === 'published' ? <CheckCircle2 className="w-4 h-4" /> : p.status === 'failed' ? <AlertTriangle className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 line-clamp-2">{p.message}</p>
                      {p.link && <p className="text-xs text-blue-600 truncate">{p.link}</p>}
                      {p.error && <p className="text-xs text-red-600 mt-0.5">{p.error}</p>}
                      <p className="text-xs text-gray-400 mt-1">{new Date(p.created_at).toLocaleString('fr-FR')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><ImageIcon className="w-5 h-5 text-fuchsia-600" /> Publier une Story (photo)</h3>
            <p className="text-sm text-gray-600">
              Publie une image en Story sur la Page Facebook — visible 24h, idéal pour une annonce rapide (dispo du jour, promo flash).
            </p>
            <div className="flex items-start gap-4">
              <label className="shrink-0 w-28 h-48 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:border-fuchsia-400 transition-colors overflow-hidden bg-gray-50">
                {storyPreview ? (
                  <img src={storyPreview.previewUrl} alt="Aperçu Story" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <ImageIcon className="w-6 h-6 text-gray-400 mb-1" />
                    <span className="text-xs text-gray-400 px-2 text-center">Choisir une image</span>
                  </>
                )}
                <input type="file" accept="image/*" onChange={handleStoryFileChange} className="hidden" />
              </label>
              <div className="flex-1 space-y-3">
                <p className="text-xs text-gray-500">Format vertical recommandé (ex : 1080×1920). L'image sera publiée telle quelle, sans recadrage automatique.</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={publishStory}
                    disabled={!storyPreview || storyPublishing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
                  >
                    {storyPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                    {storyPublishing ? 'Publication…' : 'Publier la Story'}
                  </button>
                  {storyPreview && (
                    <button onClick={() => setStoryPreview(null)} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                  )}
                </div>
                <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5">
                  <Film className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Stories vidéo et Facebook Live ne sont pas pris en charge ici : ils nécessitent un flux vidéo/streaming (upload résumable ou diffusion en direct via un logiciel comme OBS), ce qui dépasse une simple publication depuis l'app.</span>
                </div>
              </div>
            </div>
            {!fbStoriesLoading && fbStories.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {fbStories.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      s.status === 'published' ? 'bg-emerald-50 text-emerald-600' : s.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {s.status === 'published' ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    </div>
                    <span className="text-gray-500 text-xs flex-1">{new Date(s.created_at).toLocaleString('fr-FR')}</span>
                    {s.error && <span className="text-xs text-red-600 truncate max-w-[50%]">{s.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'automatisation' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Bot className="w-5 h-5 text-violet-600" /> Bot de réponse automatique</h3>
            <p className="text-sm text-gray-600">
              Envoie automatiquement un message de bienvenue au tout premier contact d'un client sur chaque canal (une seule fois, pas à chaque message).
            </p>
            {autoReplyLoading ? (
              <div className="text-center py-6 text-gray-400 text-sm">Chargement…</div>
            ) : (
              <div className="space-y-3">
                {AUTO_REPLY_CHANNELS.map((channel) => {
                  const setting = autoReplySettings.find((s) => s.channel === channel);
                  const meta = MARKETING_CHANNEL_META[channel];
                  return (
                    <div key={channel} className="border border-gray-100 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.bgColor} ${meta.color}`}>
                          {MARKETING_CHANNEL_LABELS[channel]}
                        </span>
                        <button
                          onClick={() => toggleAutoReply(channel, !(setting?.enabled))}
                          className={`relative w-10 h-5.5 rounded-full transition-colors ${setting?.enabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
                          style={{ height: '22px' }}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${setting?.enabled ? 'translate-x-4' : ''}`} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={autoReplyDrafts[channel] ?? ''}
                          onChange={(e) => setAutoReplyDrafts((prev) => ({ ...prev, [channel]: e.target.value }))}
                          className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-violet-500"
                        />
                        <button
                          onClick={() => saveAutoReplyMessage(channel)}
                          disabled={autoReplySaving === channel}
                          className="shrink-0 p-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
                          title="Enregistrer"
                        >
                          {autoReplySaving === channel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {autoReplySettings.some((s) => s.channel === 'whatsapp' && s.enabled) && (
              <p className="text-xs text-amber-600">Pour WhatsApp, l'envoi nécessite un numéro de production configuré (secrets WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID) — pas encore actif avec le numéro de test.</p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Radio className="w-5 h-5 text-orange-600" /> Diffusion groupée</h3>
            <p className="text-sm text-gray-600">
              Envoie un même message à tous les clients qui nous ont déjà contactés (WhatsApp, Facebook, Instagram), en une seule fois.
            </p>
            <form onSubmit={sendBroadcast} className="space-y-3">
              <textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Ex : Promo du jour : -10% sur les madeleines aujourd'hui uniquement !"
                rows={3}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-orange-500"
              />
              <div className="flex items-center gap-3">
                <select
                  value={broadcastChannel}
                  onChange={(e) => setBroadcastChannel(e.target.value as BroadcastChannelFilter)}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-orange-500"
                >
                  {(Object.keys(BROADCAST_CHANNEL_LABELS) as BroadcastChannelFilter[]).map((c) => (
                    <option key={c} value={c}>{BROADCAST_CHANNEL_LABELS[c]}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={broadcastSending}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
                >
                  {broadcastSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                  {broadcastSending ? 'Envoi en cours…' : 'Diffuser'}
                </button>
              </div>
            </form>
            {!broadcastsLoading && broadcasts.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {broadcasts.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-800 truncate">{b.message}</p>
                      <p className="text-xs text-gray-400">{BROADCAST_CHANNEL_LABELS[b.channel]} · {new Date(b.created_at).toLocaleString('fr-FR')}</p>
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

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /> Comment ça marche</h3>
            <p className="text-sm text-gray-600">
              Facebook, WhatsApp et Instagram partagent un seul point de configuration (une « app » Meta for Developers) ;
              TikTok est séparé. Dans les deux cas, le principe est le même :
            </p>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 text-sm">
              {['Client écrit sur FB/IG/WhatsApp/TikTok', 'La plateforme envoie un webhook', 'n8n reçoit, normalise et transmet', 'La commande apparaît ici'].map((step, i) => (
                <div key={step} className="flex-1 bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-amber-900">{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h3 className="font-bold text-gray-900">1. Point d'entrée déjà prêt côté application</h3>
            <p className="text-sm text-gray-600">
              Une fonction est déjà en place pour recevoir les commandes normalisées envoyées par n8n :
            </p>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <code className="text-xs sm:text-sm text-gray-700 flex-1 overflow-x-auto whitespace-nowrap">{webhookUrl}</code>
              <button onClick={copyWebhook} className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 transition-colors" title="Copier">
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Protégée par un secret : dans n8n, le nœud « HTTP Request » qui appelle cette URL doit envoyer l'en-tête
              <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded">x-webhook-secret</code>
              avec la même valeur que <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded">MARKETING_WEBHOOK_SECRET</code> configuré côté Supabase.
              Cette fonction (<code className="px-1 py-0.5 bg-gray-100 rounded">receive-marketing-order</code>) et la table
              qui stocke les commandes (<code className="px-1 py-0.5 bg-gray-100 rounded">marketing_orders</code>) sont déjà dans le code —
              il reste à les déployer sur ton projet Supabase.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h3 className="font-bold text-gray-900">2. Ce qu'il te reste à faire (côté comptes, pas du code)</h3>
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              <li>Créer un compte n8n (n8n.cloud) ou héberger n8n toi-même — aucune donnée de l'app n'y transite sauf les commandes.</li>
              <li>Créer une app sur <span className="font-medium">Meta for Developers</span> (business.facebook.com) pour connecter WhatsApp Business Cloud API, Messenger (Facebook) et Instagram Direct — les trois partagent une seule souscription webhook.</li>
              <li>Créer un compte <span className="font-medium">TikTok for Business</span> développeur pour les leads/messages TikTok.</li>
              <li>Importer le modèle de workflow n8n fourni dans le projet (voir plus bas) et y renseigner tes identifiants de chaque plateforme.</li>
              <li>Définir le secret partagé côté Supabase et dans n8n (même valeur des deux côtés).</li>
            </ol>
            <p className="text-sm text-gray-500">
              Un guide détaillé pas-à-pas est disponible dans le dépôt du projet :
              <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded">docs/marketing-automation-guide.md</code>.
              Le modèle de workflow prêt à importer dans n8n est dans
              <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded">docs/n8n/mimsi-marketing-orders-workflow.json</code>.
            </p>
            <a
              href="https://n8n.io/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-amber-700 font-medium hover:underline"
            >
              Créer un compte n8n <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowAdd(false)}>
          <form onSubmit={submitManualOrder} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Saisir une commande reçue</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-500">
              À utiliser tant que l'automatisation n'est pas branchée : consigne ici une commande reçue par téléphone, WhatsApp, ou un message vu sur les réseaux.
            </p>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Canal</label>
              <select
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value as MarketingChannel })}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
              >
                {(Object.keys(MARKETING_CHANNEL_LABELS) as MarketingChannel[]).map((c) => (
                  <option key={c} value={c}>{MARKETING_CHANNEL_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <input
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              placeholder="Nom du client"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
            />
            <input
              value={form.customer_phone}
              onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
              placeholder="Téléphone"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
            />
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Détail de la commande / message du client"
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500"
            />
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowAdd(false)} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700">Annuler</button>
              <button disabled={submitting} className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {submitting ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
