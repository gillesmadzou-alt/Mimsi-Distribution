import { useEffect, useState, useCallback } from 'react';
import {
  supabase, MarketingOrder, MarketingChannel, MarketingOrderStatus,
  MARKETING_CHANNEL_LABELS, MARKETING_CHANNEL_META,
  MARKETING_ORDER_STATUS_LABELS, MARKETING_ORDER_STATUS_META,
  FacebookPost, FacebookComment, FacebookStory,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  Facebook, Instagram, MessageCircle, Music2, Inbox, Plus, X,
  Target, CheckCircle2,
  Send, Link2, AlertTriangle, Loader2, MessageSquare, EyeOff, Trash2, UserX, Reply,
  Image as ImageIcon, Film, Clock, PauseCircle, LayoutGrid,
  Wallet, BellRing, CreditCard, Copy, ExternalLink, ArrowRight,
} from 'lucide-react';
import { formatFCFA } from '@/lib/supabase';

type Platform = 'overview' | 'facebook' | 'whatsapp' | 'instagram' | 'tiktok';

const PLATFORMS: { id: Platform; label: string; icon: typeof Facebook; iconColor: string }[] = [
  { id: 'overview', label: 'Vue d\'ensemble', icon: LayoutGrid, iconColor: 'text-amber-600' },
  { id: 'facebook', label: 'Facebook', icon: Facebook, iconColor: 'text-blue-600' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, iconColor: 'text-emerald-600' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, iconColor: 'text-pink-600' },
  { id: 'tiktok', label: 'TikTok', icon: Music2, iconColor: 'text-gray-900' },
];

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

export default function MarketingPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { fetchWithCache, isOffline } = useOfflineFetch();
  const [platform, setPlatform] = useState<Platform>('overview');
  const [orders, setOrders] = useState<MarketingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | MarketingOrderStatus>('all');
  const [overviewChannelFilter, setOverviewChannelFilter] = useState<'all' | MarketingChannel>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [paymentModalOrder, setPaymentModalOrder] = useState<MarketingOrder | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentRequesting, setPaymentRequesting] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ url: string; copied: boolean } | null>(null);

  const [pendingReceivables, setPendingReceivables] = useState<{ count: number; totalDue: number }>({ count: 0, totalDue: 0 });
  const [recentPayments, setRecentPayments] = useState<{ id: string; amount_fcfa: number; payment_date: string; sales_point_name: string | null }[]>([]);
  const [paymentAlertsLoading, setPaymentAlertsLoading] = useState(true);
  const [sendingReminders, setSendingReminders] = useState(false);

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

  const [fbStories, setFbStories] = useState<FacebookStory[]>([]);
  const [fbStoriesLoading, setFbStoriesLoading] = useState(true);
  const [storyPreview, setStoryPreview] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const [storyPublishing, setStoryPublishing] = useState(false);
  const [videoStoryPreview, setVideoStoryPreview] = useState<{ base64: string; mimeType: string; previewUrl: string; sizeMb: number } | null>(null);
  const [videoStoryPublishing, setVideoStoryPublishing] = useState(false);

  const [form, setForm] = useState({
    channel: 'facebook' as MarketingChannel,
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

  const loadPaymentAlerts = useCallback(async () => {
    setPaymentAlertsLoading(true);
    const [{ data: recv }, { data: pays }] = await Promise.all([
      supabase.from('receivables').select('amount_fcfa, amount_paid, status').in('status', ['en_attente', 'partiel']),
      supabase
        .from('receivable_payments')
        .select('id, amount_fcfa, payment_date, receivable:receivables(sales_point:sales_points(name))')
        .order('payment_date', { ascending: false })
        .limit(5),
    ]);
    const count = recv?.length ?? 0;
    const totalDue = (recv ?? []).reduce((sum, r) => sum + ((r.amount_fcfa as number) - (r.amount_paid as number)), 0);
    setPendingReceivables({ count, totalDue });
    setRecentPayments(
      (pays ?? []).map((p: any) => ({
        id: p.id,
        amount_fcfa: p.amount_fcfa,
        payment_date: p.payment_date,
        sales_point_name: p.receivable?.sales_point?.name ?? null,
      })),
    );
    setPaymentAlertsLoading(false);
  }, []);

  useEffect(() => { loadPaymentAlerts(); }, [loadPaymentAlerts]);
  useRealtimeSubscription('marketing-page-payment-alerts', isOffline ? [] : ['receivables', 'receivable_payments'], loadPaymentAlerts);

  const sendPaymentReminders = async () => {
    if (!window.confirm('Envoyer un rappel WhatsApp à tous les points de vente ayant une créance en attente ou partielle ?')) return;
    setSendingReminders(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('send-payment-reminders', {
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setSendingReminders(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? "Échec de l'envoi des relances.", 'error');
      return;
    }
    const result = data as { sales_points_relances: number; sent: number; failed: number };
    toast(`Relances envoyées : ${result.sent}/${result.sales_points_relances} points de vente.`, result.failed > 0 ? 'error' : 'success');
  };

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

  const MAX_VIDEO_STORY_MB = 18;

  const handleVideoStoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast('Choisis un fichier vidéo.', 'error');
      return;
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_VIDEO_STORY_MB) {
      toast(`Vidéo trop volumineuse (${sizeMb.toFixed(1)} Mo) — reste sur un clip court de moins de ${MAX_VIDEO_STORY_MB} Mo.`, 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setVideoStoryPreview({ base64: result, mimeType: file.type, previewUrl: result, sizeMb });
    };
    reader.readAsDataURL(file);
  };

  const publishVideoStory = async () => {
    if (!videoStoryPreview) {
      toast('Choisis une vidéo avant de publier.', 'error');
      return;
    }
    setVideoStoryPublishing(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('publish-facebook-video-story', {
      body: { video_base64: videoStoryPreview.base64, mime_type: videoStoryPreview.mimeType },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setVideoStoryPublishing(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? 'Échec de la publication de la Story vidéo.', 'error');
      loadFbStories();
      return;
    }
    toast('Story vidéo publiée sur Facebook.', 'success');
    setVideoStoryPreview(null);
    loadFbStories();
  };

  const openPaymentModal = (order: MarketingOrder) => {
    setPaymentModalOrder(order);
    setPaymentAmount('');
    setPaymentResult(null);
  };

  const requestCardPayment = async () => {
    if (!paymentModalOrder) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      toast('Indique un montant valide.', 'error');
      return;
    }
    setPaymentRequesting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('initiate-card-payment', {
      body: {
        amount_fcfa: amount,
        customer_name: paymentModalOrder.customer_name,
        customer_phone: paymentModalOrder.customer_phone,
        marketing_order_id: paymentModalOrder.id,
      },
      headers: sessionData.session ? { Authorization: `Bearer ${sessionData.session.access_token}` } : undefined,
    });
    setPaymentRequesting(false);
    if (error || (data as { error?: string } | null)?.error) {
      toast((data as { error?: string } | null)?.error ?? "Échec de la création du lien de paiement.", 'error');
      return;
    }
    const url = (data as { payment_url?: string })?.payment_url;
    if (!url) {
      toast("CinetPay n'a pas renvoyé de lien de paiement.", 'error');
      return;
    }
    setPaymentResult({ url, copied: false });
  };

  const copyPaymentLink = () => {
    if (!paymentResult) return;
    navigator.clipboard?.writeText(paymentResult.url).then(() => {
      setPaymentResult((prev) => (prev ? { ...prev, copied: true } : prev));
      setTimeout(() => setPaymentResult((prev) => (prev ? { ...prev, copied: false } : prev)), 2000);
    });
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
    setForm((f) => ({ ...f, customer_name: '', customer_phone: '', message: '' }));
    setShowAdd(false);
    loadOrders();
  };

  const openAddFor = (channel: MarketingChannel) => {
    setForm((f) => ({ ...f, channel }));
    setShowAdd(true);
  };

  const newCountFor = (channel: MarketingChannel) => orders.filter((o) => o.channel === channel && o.status === 'nouveau').length;
  const newCommentsCount = fbComments.filter((c) => c.status === 'nouveau').length;

  // --- Blocs réutilisables, communs à plusieurs plateformes ---

  const renderStatusNote = (icon: typeof Clock, color: string, bg: string, text: string) => {
    const Icon = icon;
    return (
      <div className={`rounded-2xl border p-4 flex items-start gap-2.5 text-sm ${bg} ${color}`}>
        <Icon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{text}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {PLATFORMS.map(({ id, label, icon: Icon, iconColor }) => {
          const badge = id === 'overview'
            ? 0
            : id === 'facebook'
              ? newCountFor('facebook') + newCommentsCount
              : newCountFor(id as MarketingChannel);
          return (
            <button
              key={id}
              onClick={() => setPlatform(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                platform === id ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Icon className={`w-4 h-4 ${platform === id ? '' : iconColor}`} />
              {label}
              {badge > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${platform === id ? 'bg-white/25' : 'bg-amber-100 text-amber-700'}`}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {platform === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLATFORMS.filter((p) => p.id !== 'overview').map(({ id, label, icon: Icon, iconColor }) => {
              const count = newCountFor(id as MarketingChannel) + (id === 'facebook' ? newCommentsCount : 0);
              return (
                <button key={id} onClick={() => setPlatform(id)} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                    <span className="font-medium text-gray-900 text-sm">{label}</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{count}</p>
                  <p className="text-xs text-gray-400">nouveau{count > 1 ? 'x' : ''}</p>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => onNavigate?.('campaign-prep')}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:shadow-md transition-shadow text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <Target className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-gray-900">Préparation de campagne</h3>
              <p className="text-sm text-gray-500">Stratégies par réseau, bot de bienvenue et diffusion groupée</p>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-400" />
          </button>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><BellRing className="w-5 h-5 text-amber-600" /> Alertes paiement</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> En attente de paiement</p>
                {paymentAlertsLoading ? (
                  <p className="text-sm text-gray-400 mt-2">Chargement…</p>
                ) : pendingReceivables.count === 0 ? (
                  <p className="text-sm text-emerald-700 mt-2">Aucune créance en attente 🎉</p>
                ) : (
                  <>
                    <p className="text-xl font-bold text-amber-800 mt-1">{formatFCFA(pendingReceivables.totalDue)}</p>
                    <p className="text-xs text-amber-700">{pendingReceivables.count} créance{pendingReceivables.count > 1 ? 's' : ''} concernée{pendingReceivables.count > 1 ? 's' : ''}</p>
                    {profile && (profile.role ?? 0) >= 5 && (
                      <button
                        onClick={sendPaymentReminders}
                        disabled={sendingReminders}
                        className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                      >
                        {sendingReminders ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                        Relancer par WhatsApp
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <p className="text-xs text-emerald-700 font-medium flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Confirmations de paiement récentes</p>
                {paymentAlertsLoading ? (
                  <p className="text-sm text-gray-400 mt-2">Chargement…</p>
                ) : recentPayments.length === 0 ? (
                  <p className="text-sm text-gray-500 mt-2">Aucun encaissement récent.</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {recentPayments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 truncate">{p.sales_point_name ?? 'Point de vente'}</span>
                        <span className="font-medium text-emerald-700 shrink-0 ml-2">{formatFCFA(p.amount_fcfa)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400">Détail complet et encaissement manuel sur la page Créances.</p>
          </div>

          <div className="space-y-3">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Inbox className="w-4 h-4 text-gray-400" /> Toutes les commandes</h3>
              <div className="flex items-center gap-2 flex-wrap ml-auto">
                <select
                  value={overviewChannelFilter}
                  onChange={(e) => setOverviewChannelFilter(e.target.value as 'all' | MarketingChannel)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="all">Tous les canaux</option>
                  {(Object.keys(MARKETING_CHANNEL_LABELS) as MarketingChannel[]).map((c) => (
                    <option key={c} value={c}>{MARKETING_CHANNEL_LABELS[c]}</option>
                  ))}
                </select>
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
                  onClick={() => openAddFor(overviewChannelFilter === 'all' ? 'facebook' : overviewChannelFilter)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Saisir une commande
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-16 text-gray-400">Chargement…</div>
            ) : orders.filter((o) => (overviewChannelFilter === 'all' || o.channel === overviewChannelFilter) && (statusFilter === 'all' || o.status === statusFilter)).length === 0 ? (
              <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
                <Inbox className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                Aucune commande pour l'instant.
              </div>
            ) : (
              <div className="space-y-3">
                {orders
                  .filter((o) => (overviewChannelFilter === 'all' || o.channel === overviewChannelFilter) && (statusFilter === 'all' || o.status === statusFilter))
                  .map((o) => {
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
                              <span className="text-xs text-gray-400">{new Date(o.created_at).toLocaleString('fr-FR')}</span>
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
                            <button
                              onClick={() => openPaymentModal(o)}
                              title="Demander un paiement par carte"
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-sm font-medium hover:bg-violet-100 transition-colors"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                            </button>
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
        </div>
      )}

      {platform === 'facebook' && (
        <div className="space-y-4">
          {renderStatusNote(CheckCircle2, 'text-emerald-800', 'bg-emerald-50 border-emerald-100', "Connecté et actif : messages, commentaires et publications passent directement par l'app (webhook meta-webhook).")}

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

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Send className="w-5 h-5 text-blue-600" /> Publier une annonce sur la Page</h3>
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
            {!fbLoading && fbPosts.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-2">
                {fbPosts.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      p.status === 'published' ? 'bg-emerald-50 text-emerald-600' : p.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {p.status === 'published' ? <CheckCircle2 className="w-3.5 h-3.5" /> : p.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 line-clamp-2">{p.message}</p>
                      {p.error && <p className="text-xs text-red-600 mt-0.5">{p.error}</p>}
                      <p className="text-xs text-gray-400 mt-1">{new Date(p.created_at).toLocaleString('fr-FR')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><ImageIcon className="w-5 h-5 text-fuchsia-600" /> Publier une Story</h3>
            <p className="text-sm text-gray-600">Visible 24h, idéal pour une annonce rapide (dispo du jour, promo flash).</p>

            <div className="flex items-start gap-4">
              <label className="shrink-0 w-24 h-40 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:border-fuchsia-400 transition-colors overflow-hidden bg-gray-50">
                {storyPreview ? (
                  <img src={storyPreview.previewUrl} alt="Aperçu Story" className="w-full h-full object-cover" />
                ) : (
                  <>
                    <ImageIcon className="w-5 h-5 text-gray-400 mb-1" />
                    <span className="text-xs text-gray-400 px-2 text-center">Photo</span>
                  </>
                )}
                <input type="file" accept="image/*" onChange={handleStoryFileChange} className="hidden" />
              </label>
              <div className="flex-1 space-y-2">
                <button
                  onClick={publishStory}
                  disabled={!storyPreview || storyPublishing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
                >
                  {storyPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  {storyPublishing ? 'Publication…' : 'Publier la Story photo'}
                </button>
                {storyPreview && (
                  <button onClick={() => setStoryPreview(null)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 flex items-start gap-4">
              <label className="shrink-0 w-24 h-40 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:border-fuchsia-400 transition-colors overflow-hidden bg-gray-50">
                {videoStoryPreview ? (
                  <video src={videoStoryPreview.previewUrl} className="w-full h-full object-cover" muted />
                ) : (
                  <>
                    <Film className="w-5 h-5 text-gray-400 mb-1" />
                    <span className="text-xs text-gray-400 px-2 text-center">Vidéo</span>
                  </>
                )}
                <input type="file" accept="video/*" onChange={handleVideoStoryFileChange} className="hidden" />
              </label>
              <div className="flex-1 space-y-2">
                <p className="text-xs text-gray-500">Clip court (max {MAX_VIDEO_STORY_MB} Mo). {videoStoryPreview && `Fichier : ${videoStoryPreview.sizeMb.toFixed(1)} Mo.`}</p>
                <button
                  onClick={publishVideoStory}
                  disabled={!videoStoryPreview || videoStoryPublishing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50"
                >
                  {videoStoryPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                  {videoStoryPublishing ? 'Publication…' : 'Publier la Story vidéo'}
                </button>
                {videoStoryPreview && (
                  <button onClick={() => setVideoStoryPreview(null)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                )}
                <p className="text-xs text-gray-400">Facebook Live n'est pas pris en charge ici (nécessite un flux RTMP en direct via un logiciel comme OBS).</p>
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
                    {s.media_type === 'video' ? <Film className="w-3.5 h-3.5 text-gray-400" /> : <ImageIcon className="w-3.5 h-3.5 text-gray-400" />}
                    <span className="text-gray-500 text-xs flex-1">{new Date(s.created_at).toLocaleString('fr-FR')}</span>
                    {s.error && <span className="text-xs text-red-600 truncate max-w-[50%]">{s.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-sm text-gray-500">
            📋 Commandes reçues : onglet <span className="font-medium text-gray-900">Vue d'ensemble</span> → Toutes les commandes (filtrables par canal). 📣 Bot de bienvenue et diffusion groupée : page <span className="font-medium text-gray-900">Préparation de campagne</span>.
          </p>
        </div>
      )}

      {platform === 'whatsapp' && (
        <div className="space-y-4">
          {renderStatusNote(AlertTriangle, 'text-amber-800', 'bg-amber-50 border-amber-100', "Numéro de test actif pour les essais techniques. Pour un usage réel avec tes clients, il faut enregistrer un numéro WhatsApp de production dans Meta for Developers.")}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-sm text-gray-600">
              💰 La relance des points de vente en impayé (WhatsApp) se trouve sur la page <span className="font-medium text-gray-900">Créances</span>, bouton « Relancer les impayés ».
            </p>
            <p className="text-sm text-gray-500 mt-2">
              📋 Commandes reçues : onglet <span className="font-medium text-gray-900">Vue d'ensemble</span> → Toutes les commandes (filtrables par canal). 📣 Bot de bienvenue et diffusion groupée : page <span className="font-medium text-gray-900">Préparation de campagne</span>.
            </p>
          </div>
        </div>
      )}

      {platform === 'instagram' && (
        <div className="space-y-4">
          {renderStatusNote(Clock, 'text-amber-800', 'bg-amber-50 border-amber-100', "Pas encore connecté : il faut d'abord créer/lier un compte Instagram professionnel à la Page Facebook avant que les messages et le bot ne fonctionnent ici.")}
          <p className="text-sm text-gray-500">
            📋 Commandes reçues : onglet <span className="font-medium text-gray-900">Vue d'ensemble</span> → Toutes les commandes (filtrables par canal). 📣 Bot de bienvenue et diffusion groupée : page <span className="font-medium text-gray-900">Préparation de campagne</span>.
          </p>
        </div>
      )}

      {platform === 'tiktok' && (
        <div className="space-y-4">
          {renderStatusNote(PauseCircle, 'text-gray-600', 'bg-gray-50 border-gray-200', "En pause : TikTok ne propose pas d'API pour recevoir les messages directs sur un compte classique. Saisie manuelle des commandes en attendant (ou une alternative payante via TikTok Ads plus tard).")}
          <p className="text-sm text-gray-500">
            📋 Les commandes TikTok saisies manuellement apparaissent dans l'onglet <span className="font-medium text-gray-900">Vue d'ensemble</span> → Toutes les commandes (filtre par canal).
          </p>
        </div>
      )}

      {paymentModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setPaymentModalOrder(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><CreditCard className="w-5 h-5 text-violet-600" /> Paiement par carte</h3>
              <button type="button" onClick={() => setPaymentModalOrder(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Client : <span className="font-medium text-gray-900">{paymentModalOrder.customer_name ?? 'Client sans nom'}</span>
              {paymentModalOrder.customer_phone && <> · {paymentModalOrder.customer_phone}</>}
            </p>

            {!paymentResult ? (
              <>
                <div>
                  <label className="text-sm text-gray-600 block mb-1">Montant (FCFA)</label>
                  <input
                    type="number"
                    min="1"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Ex : 5000"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-violet-500"
                  />
                </div>
                <p className="text-xs text-gray-400">Un lien de paiement sécurisé CinetPay (Visa/Mastercard) sera généré, à envoyer au client.</p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setPaymentModalOrder(null)} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700">Annuler</button>
                  <button
                    type="button"
                    onClick={requestCardPayment}
                    disabled={paymentRequesting}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {paymentRequesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {paymentRequesting ? 'Génération…' : 'Générer le lien'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-violet-700 font-medium">Lien de paiement généré :</p>
                  <p className="text-sm text-gray-800 break-all">{paymentResult.url}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={copyPaymentLink}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    {paymentResult.copied ? 'Copié !' : 'Copier le lien'}
                  </button>
                  <a
                    href={paymentResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 py-2.5 text-sm font-medium text-white"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Ouvrir le lien
                  </a>
                </div>
                <button type="button" onClick={() => setPaymentModalOrder(null)} className="w-full rounded-xl bg-gray-50 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors">
                  Fermer
                </button>
              </>
            )}
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
              À utiliser pour consigner une commande reçue par téléphone ou un message vu sur les réseaux, tant qu'elle n'est pas arrivée automatiquement.
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
