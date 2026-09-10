import { useEffect, useState, useCallback } from 'react';
import {
  supabase, MarketingOrder, MarketingChannel, MarketingOrderStatus,
  MARKETING_CHANNEL_LABELS, MARKETING_CHANNEL_META,
  MARKETING_ORDER_STATUS_LABELS, MARKETING_ORDER_STATUS_META,
} from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useToast } from '@/contexts/ToastContext';
import {
  Facebook, Instagram, MessageCircle, Music2, Inbox, Zap, Plus, X,
  Target, Calendar, Users, Lightbulb, Copy, CheckCircle2, ExternalLink,
} from 'lucide-react';

type Tab = 'strategie' | 'commandes' | 'automatisation';

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: 'strategie', label: 'Stratégie par canal', icon: Target },
          { id: 'commandes', label: `Commandes reçues${newCount ? ` (${newCount} nouvelles)` : ''}`, icon: Inbox },
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
                      <select
                        value={o.status}
                        onChange={(e) => updateStatus(o.id, e.target.value as MarketingOrderStatus)}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        {(Object.keys(MARKETING_ORDER_STATUS_LABELS) as MarketingOrderStatus[]).map((s) => (
                          <option key={s} value={s}>{MARKETING_ORDER_STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'automatisation' && (
        <div className="space-y-4">
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
