import { useState, useEffect, useCallback } from 'react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  supabase, formatFCFA,
  type Driver, type PotType, type OpportunisticSale, type WeddingOrder,
  type WeddingOrderStatus, type WeddingPaymentStatus,
  WEDDING_ORDER_STATUS_META, WEDDING_PAYMENT_STATUS_META,
} from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { cachePageData, getCachedPageData } from '@/lib/readCache';
import {
  Plus, Trash2, X, Sparkles, Heart, Search, Phone, MapPin, Calendar,
  TrendingUp, Package, CheckCircle2, Clock, AlertCircle,
} from 'lucide-react';

type Tab = 'sales' | 'weddings';

export default function OpportunisticSalesPage() {
  const { profile, offlineMode, manualOffline } = useAuth();
  const isOffline = offlineMode || manualOffline || !navigator.onLine;
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('sales');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [potTypes, setPotTypes] = useState<PotType[]>([]);
  const [sales, setSales] = useState<OpportunisticSale[]>([]);
  const [weddings, setWeddings] = useState<WeddingOrder[]>([]);

  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showWeddingModal, setShowWeddingModal] = useState(false);

  const [saleForm, setSaleForm] = useState({
    driver_id: '',
    pot_type_id: '',
    item_description: '',
    quantity: 1,
    unit_price_fcfa: 0,
    payment_type: 'comptant' as 'comptant' | 'credit',
    customer_name: '',
    customer_phone: '',
    sale_date: new Date().toISOString().slice(0, 10),
    sale_context: 'standard' as 'standard' | 'fair',
    fair_name: '',
    fair_location: '',
    notes: '',
  });

  const [weddingForm, setWeddingForm] = useState({
    driver_id: '',
    pot_type_id: '',
    quantity: 1,
    unit_price_fcfa: 0,
    bride_name: '',
    groom_name: '',
    customer_phone: '',
    wedding_date: '',
    delivery_address: '',
    status: 'en_attente' as WeddingOrderStatus,
    payment_status: 'non_paye' as WeddingPaymentStatus,
    amount_paid_fcfa: 0,
    order_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);

    if (isOffline) {
      const cached = await getCachedPageData<{drivers: Driver[]; potTypes: PotType[]; sales: OpportunisticSale[]; weddings: WeddingOrder[]}>('opportunistic-sales');
      if (cached) {
        setDrivers(cached.data.drivers);
        setPotTypes(cached.data.potTypes);
        setSales(cached.data.sales);
        setWeddings(cached.data.weddings);
      }
      setLoading(false);
      return;
    }

    const [driversRes, potTypesRes, salesRes, weddingsRes] = await Promise.all([
      supabase.from('drivers').select('*').order('full_name'),
      supabase.from('pot_types').select('*').order('name'),
      supabase.from('opportunistic_sales').select('*, driver:drivers(*), pot_type:pot_types(*)').order('sale_date', { ascending: false }),
      supabase.from('wedding_orders').select('*, driver:drivers(*), pot_type:pot_types(*)').order('order_date', { ascending: false }),
    ]);
    const drivers = driversRes.data ?? [];
    const potTypes = potTypesRes.data ?? [];
    const sales = salesRes.data ?? [];
    const weddings = weddingsRes.data ?? [];
    setDrivers(drivers);
    setPotTypes(potTypes);
    setSales(sales);
    setWeddings(weddings);
    await cachePageData('opportunistic-sales', { drivers, potTypes, sales, weddings });
    setLoading(false);
  }, [isOffline]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeSubscription('opportunistic-sales-page', isOffline ? [] : ['opportunistic_sales', 'wedding_orders', 'pot_types', 'drivers'], () => { loadData(); });

  const resetSaleForm = () => {
    setSaleForm({
      driver_id: '', pot_type_id: '', item_description: '', quantity: 1,
      unit_price_fcfa: 0, payment_type: 'comptant', customer_name: '',
      customer_phone: '', sale_date: new Date().toISOString().slice(0, 10), notes: '',
      sale_context: 'standard', fair_name: '', fair_location: '',
    });
  };

  const resetWeddingForm = () => {
    setWeddingForm({
      driver_id: '', pot_type_id: '', quantity: 1, unit_price_fcfa: 0,
      bride_name: '', groom_name: '', customer_phone: '', wedding_date: '',
      delivery_address: '', status: 'en_attente', payment_status: 'non_paye',
      amount_paid_fcfa: 0, order_date: new Date().toISOString().slice(0, 10), notes: '',
    });
  };

  const handleSaveSale = async () => {
    if (!saleForm.driver_id) return;
    if (saleForm.sale_context === 'fair' && !saleForm.fair_name.trim()) {
      toast('Indiquez le nom de la foire.', 'error');
      return;
    }
    setSaving(true);
    const total = saleForm.quantity * saleForm.unit_price_fcfa;
    await supabase.from('opportunistic_sales').insert({
      driver_id: saleForm.driver_id,
      pot_type_id: saleForm.pot_type_id || null,
      item_description: saleForm.item_description,
      quantity: saleForm.quantity,
      unit_price_fcfa: saleForm.unit_price_fcfa,
      total_amount_fcfa: total,
      payment_type: saleForm.payment_type,
      customer_name: saleForm.customer_name || null,
      customer_phone: saleForm.customer_phone || null,
      sale_date: saleForm.sale_date,
      sale_context: saleForm.sale_context,
      fair_name: saleForm.sale_context === 'fair' ? saleForm.fair_name || null : null,
      fair_location: saleForm.sale_context === 'fair' ? saleForm.fair_location || null : null,
      notes: saleForm.notes || null,
    });
    setSaving(false);
    setShowSaleModal(false);
    resetSaleForm();
    loadData();
  };

  const handleSaveWedding = async () => {
    if (!weddingForm.driver_id) return;
    setSaving(true);
    const total = weddingForm.quantity * weddingForm.unit_price_fcfa;
    await supabase.from('wedding_orders').insert({
      driver_id: weddingForm.driver_id,
      pot_type_id: weddingForm.pot_type_id || null,
      quantity: weddingForm.quantity,
      unit_price_fcfa: weddingForm.unit_price_fcfa,
      total_amount_fcfa: total,
      bride_name: weddingForm.bride_name || null,
      groom_name: weddingForm.groom_name || null,
      customer_phone: weddingForm.customer_phone || null,
      wedding_date: weddingForm.wedding_date || null,
      delivery_address: weddingForm.delivery_address || null,
      status: weddingForm.status,
      payment_status: weddingForm.payment_status,
      amount_paid_fcfa: weddingForm.amount_paid_fcfa,
      order_date: weddingForm.order_date,
      notes: weddingForm.notes || null,
    });
    setSaving(false);
    setShowWeddingModal(false);
    resetWeddingForm();
    loadData();
  };

  const handleDeleteSale = async (id: string) => {
    await supabase.from('opportunistic_sales').delete().eq('id', id);
    loadData();
  };

  const handleDeleteWedding = async (id: string) => {
    await supabase.from('wedding_orders').delete().eq('id', id);
    loadData();
  };

  const updateWeddingStatus = async (id: string, status: WeddingOrderStatus) => {
    const { error } = await supabase.from('wedding_orders').update({ status }).eq('id', id);
    if (error) { toast('Erreur lors de la mise à jour du statut.', 'error'); return; }
    loadData();
  };

  const updateWeddingPayment = async (id: string, payment_status: WeddingPaymentStatus) => {
    const { error } = await supabase.from('wedding_orders').update({ payment_status }).eq('id', id);
    if (error) { toast('Erreur lors de la mise à jour du paiement.', 'error'); return; }
    loadData();
  };

  // Stats
  const totalSalesAmount = sales.reduce((s, sale) => s + sale.total_amount_fcfa, 0);
  const totalSalesCount = sales.reduce((s, sale) => s + sale.quantity, 0);
  const creditSalesAmount = sales.filter((s) => s.payment_type === 'credit').reduce((s, sale) => s + sale.total_amount_fcfa, 0);

  const totalWeddingAmount = weddings.reduce((s, w) => s + w.total_amount_fcfa, 0);
  const totalWeddingPaid = weddings.reduce((s, w) => s + w.amount_paid_fcfa, 0);
  const pendingWeddings = weddings.filter((w) => w.status === 'en_attente').length;
  const deliveredWeddings = weddings.filter((w) => w.status === 'livre').length;

  const filteredSales = sales.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.item_description?.toLowerCase().includes(q) ||
      s.customer_name?.toLowerCase().includes(q) ||
      s.fair_name?.toLowerCase().includes(q) ||
      s.fair_location?.toLowerCase().includes(q) ||
      s.driver?.full_name?.toLowerCase().includes(q);
  });

  const filteredWeddings = weddings.filter((w) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return w.bride_name?.toLowerCase().includes(q) ||
      w.groom_name?.toLowerCase().includes(q) ||
      w.driver?.full_name?.toLowerCase().includes(q);
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400">Chargement…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          Ventes opportunes & Commandes mariage
        </h2>
        <button
          onClick={() => activeTab === 'sales' ? setShowSaleModal(true) : setShowWeddingModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {activeTab === 'sales' ? 'Nouvelle vente' : 'Nouvelle commande'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 p-1.5">
        <button
          onClick={() => setActiveTab('sales')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'sales' ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Ventes opportunes
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-black/10">{sales.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('weddings')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'weddings' ? 'bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Heart className="w-4 h-4" />
          Commandes mariage
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-black/10">{weddings.length}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={activeTab === 'sales' ? 'Rechercher par client, commercial, article…' : 'Rechercher par mariés, commercial…'}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none"
        />
      </div>

      {/* Stats cards */}
      {activeTab === 'sales' ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Montant total" value={formatFCFA(totalSalesAmount)} icon={TrendingUp} color="from-emerald-500 to-emerald-600" />
          <StatCard label="Articles vendus" value={totalSalesCount.toLocaleString('fr-FR')} icon={Package} color="from-blue-500 to-blue-600" />
          <StatCard label="Ventes à crédit" value={formatFCFA(creditSalesAmount)} icon={Clock} color="from-amber-500 to-amber-600" />
          <StatCard label="Nombre de ventes" value={sales.length.toString()} icon={Sparkles} color="from-violet-500 to-violet-600" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Montant total" value={formatFCFA(totalWeddingAmount)} icon={TrendingUp} color="from-rose-500 to-rose-600" />
          <StatCard label="Encaissé" value={formatFCFA(totalWeddingPaid)} icon={CheckCircle2} color="from-emerald-500 to-emerald-600" />
          <StatCard label="En attente" value={pendingWeddings.toString()} icon={Clock} color="from-amber-500 to-amber-600" />
          <StatCard label="Livrées" value={deliveredWeddings.toString()} icon={Heart} color="from-blue-500 to-blue-600" />
        </div>
      )}

      {/* Sales list */}
      {activeTab === 'sales' && (
        <div className="space-y-2">
          {filteredSales.length === 0 ? (
            <EmptyState text="Aucune vente opportune enregistrée" />
          ) : (
            filteredSales.map((sale) => (
              <div key={sale.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{sale.item_description || sale.pot_type?.name || 'Vente'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${sale.payment_type === 'credit' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {sale.payment_type === 'credit' ? 'Crédit' : 'Comptant'}
                    </span>
                    {sale.sale_context === 'fair' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-lime-100 text-lime-800">Foire</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{sale.driver?.full_name ?? '—'}</span>
                    <span>{sale.quantity} × {formatFCFA(sale.unit_price_fcfa)}</span>
                    <span>{new Date(sale.sale_date).toLocaleDateString('fr-FR')}</span>
                    {sale.customer_name && <span>· {sale.customer_name}</span>}
                    {sale.sale_context === 'fair' && <span>· {sale.fair_name || 'Foire'}{sale.fair_location ? ` — ${sale.fair_location}` : ''}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-gray-900">{formatFCFA(sale.total_amount_fcfa)}</span>
                  <button onClick={() => handleDeleteSale(sale.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Weddings list */}
      {activeTab === 'weddings' && (
        <div className="space-y-2">
          {filteredWeddings.length === 0 ? (
            <EmptyState text="Aucune commande de mariage enregistrée" />
          ) : (
            filteredWeddings.map((w) => {
              const statusMeta = WEDDING_ORDER_STATUS_META[w.status];
              const payMeta = WEDDING_PAYMENT_STATUS_META[w.payment_status];
              return (
                <div key={w.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                      <Heart className="w-5 h-5 text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">
                          {w.bride_name || w.groom_name ? `${w.bride_name ?? '—'} & ${w.groom_name ?? '—'}` : 'Commande mariage'}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusMeta.bgColor} ${statusMeta.color}`}>{statusMeta.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${payMeta.bgColor} ${payMeta.color}`}>{payMeta.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        <span>{w.driver?.full_name ?? '—'}</span>
                        <span>{w.quantity} pots × {formatFCFA(w.unit_price_fcfa)}</span>
                        <span>{new Date(w.order_date).toLocaleDateString('fr-FR')}</span>
                        {w.wedding_date && <span className="flex items-center gap-0.5"><Calendar className="w-3 h-3" />{new Date(w.wedding_date).toLocaleDateString('fr-FR')}</span>}
                        {w.customer_phone && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{w.customer_phone}</span>}
                        {w.delivery_address && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{w.delivery_address}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-sm font-bold text-gray-900">{formatFCFA(w.total_amount_fcfa)}</span>
                      {w.amount_paid_fcfa > 0 && w.amount_paid_fcfa < w.total_amount_fcfa && (
                        <span className="text-xs text-amber-600">Versé: {formatFCFA(w.amount_paid_fcfa)}</span>
                      )}
                      <button onClick={() => handleDeleteWedding(w.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Status controls */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400 mr-1">Statut:</span>
                      {(['en_attente', 'confirme', 'livre', 'annule'] as WeddingOrderStatus[]).map((st) => (
                        <button
                          key={st}
                          onClick={() => updateWeddingStatus(w.id, st)}
                          className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                            w.status === st
                              ? `${WEDDING_ORDER_STATUS_META[st].bgColor} ${WEDDING_ORDER_STATUS_META[st].color}`
                              : 'text-gray-400 hover:bg-gray-100'
                          }`}
                        >
                          {WEDDING_ORDER_STATUS_META[st].label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-xs text-gray-400 mr-1">Paiement:</span>
                      {(['non_paye', 'partiel', 'paye'] as WeddingPaymentStatus[]).map((ps) => (
                        <button
                          key={ps}
                          onClick={() => updateWeddingPayment(w.id, ps)}
                          className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                            w.payment_status === ps
                              ? `${WEDDING_PAYMENT_STATUS_META[ps].bgColor} ${WEDDING_PAYMENT_STATUS_META[ps].color}`
                              : 'text-gray-400 hover:bg-gray-100'
                          }`}
                        >
                          {WEDDING_PAYMENT_STATUS_META[ps].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Sale Modal */}
      {showSaleModal && (
        <Modal title="Nouvelle vente opportune" icon={Sparkles} onClose={() => { setShowSaleModal(false); resetSaleForm(); }} onSave={handleSaveSale} saving={saving}>
          <div className="space-y-3">
            <Field label="Commercial *">
              <select value={saleForm.driver_id} onChange={(e) => setSaleForm({ ...saleForm, driver_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none">
                <option value="">Sélectionner…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </Field>
            <Field label="Type de pot">
              <select value={saleForm.pot_type_id} onChange={(e) => setSaleForm({ ...saleForm, pot_type_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none">
                <option value="">Autre (décrire ci-dessous)</option>
                {potTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Description de l'article">
              <input type="text" value={saleForm.item_description} onChange={(e) => setSaleForm({ ...saleForm, item_description: e.target.value })}
                placeholder="ex: Pot de madeleines, gâteau spécial…"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none" />
            </Field>
            <Field label="Contexte de la vente">
              <select value={saleForm.sale_context} onChange={(e) => setSaleForm({ ...saleForm, sale_context: e.target.value as 'standard' | 'fair' })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none">
                <option value="standard">Vente opportune classique</option>
                <option value="fair">Vente en foire</option>
              </select>
            </Field>
            {saleForm.sale_context === 'fair' && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-lime-200 bg-lime-50 p-3">
                <Field label="Nom de la foire *">
                  <input type="text" value={saleForm.fair_name} onChange={(e) => setSaleForm({ ...saleForm, fair_name: e.target.value })}
                    placeholder="ex : Foire de Brazzaville"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-lime-500 outline-none" />
                </Field>
                <Field label="Lieu de la foire">
                  <input type="text" value={saleForm.fair_location} onChange={(e) => setSaleForm({ ...saleForm, fair_location: e.target.value })}
                    placeholder="Ville, site ou arrondissement"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-lime-500 outline-none" />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantité">
                <input type="number" min={1} value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: Math.max(1, Number(e.target.value)) })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none" />
              </Field>
              <Field label="Prix unitaire (FCFA)">
                <input type="number" min={0} value={saleForm.unit_price_fcfa} onChange={(e) => setSaleForm({ ...saleForm, unit_price_fcfa: Math.max(0, Number(e.target.value)) })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none" />
              </Field>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">Type de paiement:</span>
              {(['comptant', 'credit'] as const).map((pt) => (
                <button key={pt} onClick={() => setSaleForm({ ...saleForm, payment_type: pt })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    saleForm.payment_type === pt ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {pt === 'comptant' ? 'Comptant' : 'Crédit'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nom du client">
                <input type="text" value={saleForm.customer_name} onChange={(e) => setSaleForm({ ...saleForm, customer_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none" />
              </Field>
              <Field label="Téléphone">
                <input type="text" value={saleForm.customer_phone} onChange={(e) => setSaleForm({ ...saleForm, customer_phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none" />
              </Field>
            </div>
            <Field label="Date de la vente">
              <input type="date" value={saleForm.sale_date} onChange={(e) => setSaleForm({ ...saleForm, sale_date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none" />
            </Field>
            <Field label="Notes">
              <textarea value={saleForm.notes} onChange={(e) => setSaleForm({ ...saleForm, notes: e.target.value })} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-amber-500 outline-none resize-none" />
            </Field>
            {saleForm.quantity > 0 && saleForm.unit_price_fcfa > 0 && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50">
                <span className="text-sm text-amber-700 font-medium">Total de la vente</span>
                <span className="text-lg font-bold text-amber-900">{formatFCFA(saleForm.quantity * saleForm.unit_price_fcfa)}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Wedding Modal */}
      {showWeddingModal && (
        <Modal title="Nouvelle commande mariage" icon={Heart} onClose={() => { setShowWeddingModal(false); resetWeddingForm(); }} onSave={handleSaveWedding} saving={saving}>
          <div className="space-y-3">
            <Field label="Commercial *">
              <select value={weddingForm.driver_id} onChange={(e) => setWeddingForm({ ...weddingForm, driver_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none">
                <option value="">Sélectionner…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nom de la mariée">
                <input type="text" value={weddingForm.bride_name} onChange={(e) => setWeddingForm({ ...weddingForm, bride_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
              </Field>
              <Field label="Nom du marié">
                <input type="text" value={weddingForm.groom_name} onChange={(e) => setWeddingForm({ ...weddingForm, groom_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
              </Field>
            </div>
            <Field label="Type de pot">
              <select value={weddingForm.pot_type_id} onChange={(e) => setWeddingForm({ ...weddingForm, pot_type_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none">
                <option value="">Sélectionner…</option>
                {potTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantité (pots)">
                <input type="number" min={1} value={weddingForm.quantity} onChange={(e) => setWeddingForm({ ...weddingForm, quantity: Math.max(1, Number(e.target.value)) })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
              </Field>
              <Field label="Prix unitaire (FCFA)">
                <input type="number" min={0} value={weddingForm.unit_price_fcfa} onChange={(e) => setWeddingForm({ ...weddingForm, unit_price_fcfa: Math.max(0, Number(e.target.value)) })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date du mariage">
                <input type="date" value={weddingForm.wedding_date} onChange={(e) => setWeddingForm({ ...weddingForm, wedding_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
              </Field>
              <Field label="Téléphone">
                <input type="text" value={weddingForm.customer_phone} onChange={(e) => setWeddingForm({ ...weddingForm, customer_phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
              </Field>
            </div>
            <Field label="Adresse de livraison">
              <input type="text" value={weddingForm.delivery_address} onChange={(e) => setWeddingForm({ ...weddingForm, delivery_address: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
            </Field>
            <Field label="Montant déjà versé (FCFA)">
              <input type="number" min={0} value={weddingForm.amount_paid_fcfa} onChange={(e) => setWeddingForm({ ...weddingForm, amount_paid_fcfa: Math.max(0, Number(e.target.value)) })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none" />
            </Field>
            <Field label="Notes">
              <textarea value={weddingForm.notes} onChange={(e) => setWeddingForm({ ...weddingForm, notes: e.target.value })} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-rose-500 outline-none resize-none" />
            </Field>
            {weddingForm.quantity > 0 && weddingForm.unit_price_fcfa > 0 && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50">
                <span className="text-sm text-rose-700 font-medium">Total de la commande</span>
                <span className="text-lg font-bold text-rose-900">{formatFCFA(weddingForm.quantity * weddingForm.unit_price_fcfa)}</span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof TrendingUp; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-2`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, icon: Icon, onClose, onSave, saving, children }: {
  title: string; icon: typeof Sparkles; onClose: () => void; onSave: () => void; saving: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto animate-[scaleIn_180ms_ease-out]">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Icon className="w-5 h-5 text-amber-500" />
            {title}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          {children}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Annuler
          </button>
          <button onClick={onSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <AlertCircle className="w-10 h-10 mb-2 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
