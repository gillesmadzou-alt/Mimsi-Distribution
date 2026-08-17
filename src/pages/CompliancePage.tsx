import { useEffect, useState, useCallback } from 'react';
import { supabase, ComplianceCheck, ComplianceDiscrepancy, ComplianceComment, ComplianceAuditEntry, formatFCFA } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import {
  ShieldCheck, ShieldAlert, Clock, CheckCircle2, XCircle,
  Beaker, ChefHat, Truck, Scale, AlertTriangle, Bell,
  MessageSquare, Send, BadgeCheck, Ban, ScrollText, History,
  ArrowRight, CloudOff,
} from 'lucide-react';

type Tab = 'discrepancies' | 'financial' | 'registry';

const STAGE_CONFIG: Record<string, { label: string; Icon: typeof Beaker; color: string }> = {
  pate_production:  { label: 'Pétrisseur → pétrisseur',    Icon: Beaker,   color: 'text-blue-600 bg-blue-50' },
  production_stock: { label: 'pétrisseur → Stock',          Icon: ChefHat,  color: 'text-amber-600 bg-amber-50' },
  stock_livraison:  { label: 'Stock → Livraison',        Icon: Truck,    color: 'text-purple-600 bg-purple-50' },
  poids_seau:       { label: 'Poids de seau (12,8 kg)',   Icon: Scale,    color: 'text-red-600 bg-red-50' },
};

const STATUS_CONFIG: Record<string, { label: string; style: string; Icon: typeof Clock }> = {
  non_resolu: { label: 'Non résolu',     style: 'bg-red-50 text-red-700',       Icon: AlertTriangle },
  resolu:     { label: 'Résolu',         style: 'bg-amber-50 text-amber-700',   Icon: Clock },
  valide:     { label: 'Validé',         style: 'bg-emerald-50 text-emerald-700', Icon: BadgeCheck },
  rejete:     { label: 'Rejeté',         style: 'bg-gray-100 text-gray-600',   Icon: Ban },
};

const FIN_STATUS_CONFIG: Record<string, { label: string; style: string; Icon: typeof Clock }> = {
  en_attente:   { label: 'En attente',     style: 'bg-amber-50 text-amber-700',   Icon: Clock },
  conforme:     { label: 'Conforme',        style: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  non_conforme: { label: 'Non conforme',   style: 'bg-red-50 text-red-700',       Icon: XCircle },
};

export default function CompliancePage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile } = useAuth();
  const { promptDialog } = useConfirm();
  const [tab, setTab] = useState<Tab>('discrepancies');
  const [checks, setChecks] = useState<ComplianceCheck[]>([]);
  const [discrepancies, setDiscrepancies] = useState<ComplianceDiscrepancy[]>([]);
  const [comments, setComments] = useState<Record<string, ComplianceComment[]>>({});
  const [loading, setLoading] = useState(true);
  const [filterStage, setFilterStage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [auditTrail, setAuditTrail] = useState<ComplianceAuditEntry[]>([]);
  const [auditFilterType, setAuditFilterType] = useState('');

  const canComment = (profile?.role ?? 1) >= 2;
  const canValidate = [4, 5, 6].includes(profile?.role ?? 0);
  const canManageFin = (profile?.role ?? 1) >= 3;
  const canViewRegistry = [4, 5, 6].includes(profile?.role ?? 0);
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadAll = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('compliance_page', async () => {
      let discQuery = supabase.from('compliance_discrepancies').select('*').order('detected_at', { ascending: false }).limit(200);
      if (filterStage) discQuery = discQuery.eq('chain_stage', filterStage);
      if (filterStatus) discQuery = discQuery.eq('status', filterStatus);
      const [discRes, checksRes] = await Promise.all([
        discQuery,
        supabase.from('compliance_checks')
          .select('*, batch:delivery_batches(*, driver:drivers(full_name), pot_type:pot_types(name, unit_price_fcfa))')
          .order('created_at', { ascending: false }).limit(100),
      ]);
      return { discrepancies: discRes.data ?? [], checks: checksRes.data ?? [] };
    });
    if (result.data) {
      setDiscrepancies(result.data.discrepancies);
      setChecks(result.data.checks);
    }
    setLoading(false);
  }, [fetchWithCache, filterStage, filterStatus]);

  useEffect(() => {
    if (tab === 'registry') { loadAuditTrail(); } else { loadAll(); }
  }, [filterStage, filterStatus, tab, auditFilterType, loadAll]);
  useRealtimeSubscription('compliance-page', isOffline ? [] : ['compliance_checks', 'compliance_discrepancies', 'compliance_comments', 'compliance_audit_trail'], loadAll);

  const loadAuditTrail = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('compliance_audit', async () => {
      let q = supabase.from('compliance_audit_trail').select('*').order('decided_at', { ascending: false }).limit(500);
      if (auditFilterType) q = q.eq('decision_type', auditFilterType);
      const { data } = await q;
      return data ?? [];
    });
    if (result.data) setAuditTrail(result.data);
    setLoading(false);
  }, [fetchWithCache, auditFilterType]);

  const loadComments = async (discrepancyId: string) => {
    const { data } = await supabase
      .from('compliance_comments')
      .select('*')
      .eq('discrepancy_id', discrepancyId)
      .order('created_at', { ascending: true });
    setComments((prev) => ({ ...prev, [discrepancyId]: data ?? [] }));
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setCommentText('');
      loadComments(id);
    }
  };

  const submitComment = async (discId: string) => {
    if (!commentText.trim() || !profile) return;
    await supabase.from('compliance_comments').insert({
      discrepancy_id: discId,
      author_id: profile.id,
      author_name: profile.full_name,
      author_role: profile.role,
      comment: commentText.trim(),
    });
    setCommentText('');
    loadComments(discId);
  };

  const validateDiscrepancy = async (disc: ComplianceDiscrepancy, decision: 'valide' | 'rejete') => {
    const isValidate = decision === 'valide';
    const note = await promptDialog({
      title: isValidate ? 'Validation de l\u00e9cart' : 'Rejet de l\u00e9cart',
      message: isValidate
        ? `Ajoutez un commentaire de validation pour \u00ab ${disc.entity_label} \u00bb.`
        : `Indiquez le motif du rejet pour \u00ab ${disc.entity_label} \u00bb.`,
      placeholder: isValidate ? 'Commentaire de validation\u2026' : 'Motif du rejet\u2026',
      confirmLabel: isValidate ? 'Valider' : 'Rejeter',
      cancelLabel: 'Annuler',
      danger: !isValidate,
      multiline: true,
    });
    if (note === null) return;
    await supabase.from('compliance_discrepancies')
      .update({
        status: decision,
        comment: note || null,
        validated_by: profile?.id,
        validated_at: new Date().toISOString(),
      })
      .eq('id', disc.id);
    loadAll();
  };

  const setCheckStatus = async (check: ComplianceCheck, newStatus: 'conforme' | 'non_conforme', comment?: string) => {
    await supabase.from('compliance_checks')
      .update({
        status: newStatus,
        checked_by: (await supabase.auth.getUser()).data.user?.id,
        checked_at: new Date().toISOString(),
        comment: comment ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', check.id);
    loadAll();
  };

  const discStats = {
    non_resolu: discrepancies.filter((d) => d.status === 'non_resolu').length,
    resolu: discrepancies.filter((d) => d.status === 'resolu').length,
    valide: discrepancies.filter((d) => d.status === 'valide').length,
    poids_seau: discrepancies.filter((d) => d.chain_stage === 'poids_seau' && d.status === 'non_resolu').length,
  };

  const checkStats = {
    en_attente: checks.filter((c) => c.status === 'en_attente').length,
    conforme: checks.filter((c) => c.status === 'conforme').length,
    non_conforme: checks.filter((c) => c.status === 'non_conforme').length,
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        <button onClick={() => setTab('discrepancies')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'discrepancies' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500'}`}>
          Écarts de chaîne
        </button>
        <button onClick={() => setTab('financial')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'financial' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500'}`}>
          Conformité financière
        </button>
        {canViewRegistry && (
          <button onClick={() => setTab('registry')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${tab === 'registry' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500'}`}>
            <ScrollText className="w-4 h-4" /> Registre
          </button>
        )}
      </div>

      {/* Cross-links */}
      <div className="flex gap-2">
        <button onClick={() => onNavigate?.('batches')}
          className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-1.5">
          <ArrowRight className="w-4 h-4" /> Voir tournées
        </button>
        <button onClick={() => onNavigate?.('receivables')}
          className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors flex items-center gap-1.5">
          <ArrowRight className="w-4 h-4" /> Voir créances
        </button>
      </div>

      {/* Stats */}
      {tab === 'registry' ? (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                <BadgeCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Validations</p>
                <p className="text-2xl font-bold text-gray-900">{auditTrail.filter((a) => a.decision_type === 'valide' || a.decision_type === 'conforme').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
                <Ban className="w-6 h-6 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Rejets</p>
                <p className="text-2xl font-bold text-gray-900">{auditTrail.filter((a) => a.decision_type === 'rejete' || a.decision_type === 'non_conforme').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Décisions écarts</p>
                <p className="text-2xl font-bold text-gray-900">{auditTrail.filter((a) => a.entity_type === 'discrepancy').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                <History className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Décisions financières</p>
                <p className="text-2xl font-bold text-gray-900">{auditTrail.filter((a) => a.entity_type === 'financial_check').length}</p>
              </div>
            </div>
          </div>
        </div>
      ) : tab === 'discrepancies' ? (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Non résolus</p>
                <p className="text-2xl font-bold text-gray-900">{discStats.non_resolu}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">En attente</p>
                <p className="text-2xl font-bold text-gray-900">{discStats.resolu}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                <BadgeCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Validés</p>
                <p className="text-2xl font-bold text-gray-900">{discStats.valide}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center">
                <Scale className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Poids seau non conforme</p>
                <p className="text-2xl font-bold text-gray-900">{discStats.poids_seau}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(FIN_STATUS_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.Icon;
            return (
              <div key={key} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${cfg.style}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{cfg.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{checkStats[key as keyof typeof checkStats] ?? 0}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters for registry */}
      {tab === 'registry' && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setAuditFilterType('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!auditFilterType ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Toutes les décisions
          </button>
          <button onClick={() => setAuditFilterType('valide')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${auditFilterType === 'valide' ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Validations écarts
          </button>
          <button onClick={() => setAuditFilterType('rejete')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${auditFilterType === 'rejete' ? 'bg-gray-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Rejets écarts
          </button>
          <button onClick={() => setAuditFilterType('conforme')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${auditFilterType === 'conforme' ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Conformes finance
          </button>
          <button onClick={() => setAuditFilterType('non_conforme')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${auditFilterType === 'non_conforme' ? 'bg-red-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Non conformes finance
          </button>
        </div>
      )}

      {/* Filters for discrepancies */}
      {tab === 'discrepancies' && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterStage('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterStage ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Tous les maillons
          </button>
          {Object.entries(STAGE_CONFIG).map(([val, cfg]) => (
            <button key={val} onClick={() => setFilterStage(val)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStage === val ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {cfg.label}
            </button>
          ))}
          <div className="w-px bg-gray-200 mx-1" />
          <button onClick={() => setFilterStatus('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterStatus ? 'bg-gray-700 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Tous statuts
          </button>
          <button onClick={() => setFilterStatus('non_resolu')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === 'non_resolu' ? 'bg-red-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Non résolus
          </button>
          <button onClick={() => setFilterStatus('valide')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === 'valide' ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Validés
          </button>
        </div>
      )}

      {/* Filters for financial */}
      {tab === 'financial' && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterStatus('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!filterStatus ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            Toutes
          </button>
          {Object.entries(FIN_STATUS_CONFIG).map(([val, cfg]) => (
            <button key={val} onClick={() => setFilterStatus(val)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === val ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {cfg.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && discrepancies.length === 0 && checks.length === 0 && auditTrail.length === 0 ? (
        <div className="text-center py-20 text-gray-400 flex flex-col items-center gap-2">
          <CloudOff className="w-12 h-12 text-gray-300" />
          <p>Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger les données de conformité.</p>
        </div>
      ) : tab === 'registry' ? (
        auditTrail.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <ScrollText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Aucune décision enregistrée</p>
            <p className="text-sm mt-1">Le registre se remplit automatiquement à chaque validation ou rejet</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {auditTrail.map((entry) => {
              const isPositive = entry.decision_type === 'valide' || entry.decision_type === 'conforme';
              const stageCfg = entry.chain_stage ? STAGE_CONFIG[entry.chain_stage] : null;
              return (
                <div key={entry.id} className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-600'}`}>
                      {isPositive ? <BadgeCheck className="w-5 h-5" /> : <Ban className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{entry.entity_label}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {isPositive ? 'Validé' : 'Rejeté'}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">
                          {entry.entity_type === 'discrepancy' ? 'Écart de chaîne' : 'Conformité financière'}
                        </span>
                        {stageCfg && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageCfg.color}`}>
                            {stageCfg.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Décidé par: </span>
                          <span className="font-semibold text-gray-900">{entry.decided_by_name}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Statut: </span>
                          <span className="text-gray-700">{entry.previous_status ?? '—'} → {entry.new_status ?? '—'}</span>
                        </div>
                      </div>
                      {entry.decision_comment && (
                        <p className="text-sm text-gray-600 mt-1 italic">"{entry.decision_comment}"</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(entry.decided_at).toLocaleString('fr-FR')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'discrepancies' ? (
        discrepancies.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Aucun écart détecté</p>
            <p className="text-sm mt-1">Les écarts sont détectés automatiquement à chaque étape de la chaîne</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {discrepancies.map((disc) => {
              const stageCfg = STAGE_CONFIG[disc.chain_stage] ?? STAGE_CONFIG.pate_production;
              const StageIcon = stageCfg.Icon;
              const statusCfg = STATUS_CONFIG[disc.status] ?? STATUS_CONFIG.non_resolu;
              const StatusIcon = statusCfg.Icon;
              const isExpanded = expandedId === disc.id;
              const discComments = comments[disc.id] ?? [];
              const canValidateThis = canValidate && (disc.status === 'non_resolu' || disc.status === 'resolu');
              return (
                <div key={disc.id} className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${stageCfg.color}`}>
                      <StageIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{disc.entity_label}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageCfg.color}`}>
                          {stageCfg.label}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${statusCfg.style}`}>
                          <StatusIcon className="w-3 h-3" /> {statusCfg.label}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Attendu: </span>
                          <span className="font-semibold text-gray-900">{disc.expected_qty} {disc.unit}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Constaté: </span>
                          <span className="font-semibold text-gray-900">{disc.actual_qty} {disc.unit}</span>
                        </div>
                        <div className={disc.variance < 0 ? 'text-red-600' : 'text-orange-600'}>
                          <span className="font-medium">Écart: {disc.variance > 0 ? '+' : ''}{disc.variance} {disc.unit}</span>
                        </div>
                      </div>
                      {disc.comment && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-sm">
                          <Scale className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-gray-700">{disc.comment}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        <p className="text-xs text-gray-400">
                          Détecté le {new Date(disc.detected_at).toLocaleString('fr-FR')}
                        </p>
                        <span className="flex items-center gap-1 text-xs text-amber-600">
                          <Bell className="w-3 h-3" /> Responsables notifiés
                        </span>
                        {discComments.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <MessageSquare className="w-3 h-3" /> {discComments.length} commentaire{discComments.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {disc.validated_at && (
                        <p className="text-xs text-emerald-600 mt-0.5">
                          Validé le {new Date(disc.validated_at).toLocaleString('fr-FR')}
                        </p>
                      )}

                      {/* Expand button */}
                      <button onClick={() => toggleExpand(disc.id)}
                        className="mt-2 text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {isExpanded ? 'Masquer' : 'Commenter / voir les explications'}
                      </button>

                      {/* Comments section */}
                      {isExpanded && (
                        <div className="mt-3 bg-gray-50 rounded-xl p-4 space-y-3">
                          {discComments.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-2">Aucun commentaire pour l'instant</p>
                          ) : (
                            discComments.map((c) => (
                              <div key={c.id} className="bg-white rounded-lg p-3 border border-gray-100">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium text-gray-900">{c.author_name}</span>
                                  <span className="text-xs text-gray-400">
                                    {new Date(c.created_at).toLocaleString('fr-FR')}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-700">{c.comment}</p>
                              </div>
                            ))
                          )}

                          {/* Comment input */}
                          {canComment && disc.status !== 'valide' && disc.status !== 'rejete' && (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') submitComment(disc.id); }}
                                placeholder="Ajouter une explication…"
                                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                              />
                              <button onClick={() => submitComment(disc.id)}
                                disabled={!commentText.trim()}
                                className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-40 transition-colors flex items-center gap-1">
                                <Send className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Validation buttons — directors only */}
                    {canValidateThis && (
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={() => validateDiscrepancy(disc, 'valide')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors flex items-center gap-1">
                          <BadgeCheck className="w-4 h-4" /> Valider
                        </button>
                        <button onClick={() => validateDiscrepancy(disc, 'rejete')}
                          className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors flex items-center gap-1">
                          <Ban className="w-4 h-4" /> Rejeter
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        checks.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Aucun contrôle de conformité enregistré</p>
            <p className="text-sm mt-1">Les contrôles sont créés automatiquement à la clôture des tournées</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {checks.map((check) => {
              const cfg = FIN_STATUS_CONFIG[check.status] ?? FIN_STATUS_CONFIG.en_attente;
              const StatusIcon = cfg.Icon;
              const diff = check.expected_amount - check.reported_amount;
              return (
                <div key={check.id} className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cfg.style}`}>
                      <StatusIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{check.batch?.batch_code ?? '—'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.style}`}>{cfg.label}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {check.batch?.driver?.full_name ?? '—'} · {check.batch?.pot_type?.name ?? '—'}
                      </p>
                      <div className="mt-2 flex gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Attendu: </span>
                          <span className="font-semibold text-gray-900">{formatFCFA(check.expected_amount)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Rapporté: </span>
                          <span className="font-semibold text-gray-900">{formatFCFA(check.reported_amount)}</span>
                        </div>
                        {check.status === 'en_attente' && (
                          <div className={diff === 0 ? 'text-emerald-600' : 'text-red-600'}>
                            <span className="font-medium">Écart: {formatFCFA(Math.abs(diff))}</span>
                          </div>
                        )}
                      </div>
                      {check.comment && (
                        <p className="text-sm text-gray-600 mt-1 italic">"{check.comment}"</p>
                      )}
                      {check.checked_at && (
                        <p className="text-xs text-gray-400 mt-1">
                          Vérifié le {new Date(check.checked_at).toLocaleString('fr-FR')}
                        </p>
                      )}
                    </div>
                    {canManageFin && check.status === 'en_attente' && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => setCheckStatus(check, 'conforme', diff === 0 ? 'Montants conformes' : 'Conforme après vérification')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> Conforme
                        </button>
                        <button onClick={async () => {
                          const c = await promptDialog({
                            title: 'Non conforme',
                            message: `Un \u00e9cart de ${formatFCFA(Math.abs(diff))} a \u00e9t\u00e9 constat\u00e9. Ajoutez un commentaire justificatif.`,
                            placeholder: 'Commentaire (\u00e9cart non conforme)\u2026',
                            confirmLabel: 'Marquer non conforme',
                            cancelLabel: 'Annuler',
                            danger: true,
                            multiline: true,
                          });
                          setCheckStatus(check, 'non_conforme', c ?? 'Écart non justifié');
                        }}
                          className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1">
                          <XCircle className="w-4 h-4" /> Non conforme
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
