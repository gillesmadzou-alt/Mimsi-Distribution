import { useEffect, useState, useCallback } from 'react';
import { supabase, AuditLog } from '@/lib/supabase';
import { useOfflineFetch } from '@/hooks/useCachedFetch';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import {
  Search, Shield, Edit2, Trash2, Plus, LogIn, LogOut, Check,
  X, ArrowRight, Truck, MapPin, Route, Wallet, Undo2, Package,
  ShieldCheck, CalendarOff, ChefHat, Barcode, Recycle, RefreshCw,
  UserCog, FileText, Wheat, Bell, Users, ScrollText, Ban, CloudOff
} from 'lucide-react';

const ACTION_LABELS: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  login: 'Connexion',
  logout: 'Déconnexion',
  validate: 'Validation',
  reject: 'Rejet',
  approve: 'Approbation',
};

const ACTION_ICONS: Record<string, typeof Edit2> = {
  create: Plus,
  update: Edit2,
  delete: Trash2,
  login: LogIn,
  logout: LogOut,
  validate: Check,
  reject: Ban,
  approve: Check,
};

interface EntityMeta {
  label: string;
  icon: typeof Truck;
  page?: string;
}

const ENTITY_MAP: Record<string, EntityMeta> = {
  driver: { label: 'Commercial', icon: Truck, page: 'drivers' },
  sales_point: { label: 'Point de vente', icon: MapPin, page: 'sales-points' },
  batch: { label: 'Tournée', icon: Route, page: 'batches' },
  deposit: { label: 'Dépôt / Encaissement', icon: ScrollText, page: 'journal' },
  return: { label: 'Retour & Invendus', icon: Undo2, page: 'returns' },
  stock: { label: 'Stock', icon: Package, page: 'stock' },
  receivable: { label: 'Créance', icon: Wallet, page: 'receivables' },
  compliance: { label: 'Conformité', icon: ShieldCheck, page: 'compliance' },
  leave: { label: 'Congé & Absence', icon: CalendarOff, page: 'leave' },
  baker: { label: 'Pétrisseur', icon: ChefHat, page: 'production' },
  kneader: { label: 'Pétrisseur', icon: Wheat, page: 'production' },
  production_record: { label: 'Enregistrement de production', icon: ChefHat, page: 'production' },
  dough_delivery: { label: 'Livraison de pâte', icon: Wheat, page: 'production' },
  barcode: { label: 'Code à barres', icon: Barcode, page: 'barcodes' },
  consignment: { label: 'Consigne', icon: Recycle, page: 'consignments' },
  restock: { label: 'Réapprovisionnement', icon: RefreshCw, page: 'restock' },
  user: { label: 'Utilisateur', icon: UserCog, page: 'users' },
  personnel_change_request: { label: 'Demande personnel', icon: FileText, page: 'approvals' },
  notification: { label: 'Notification', icon: Bell },
  sales_points_enriched: { label: 'Point de vente enrichi', icon: MapPin, page: 'sales-points' },
  qr_code: { label: 'QR Code', icon: Barcode, page: 'barcodes' },
  stock_handover: { label: 'Transfert de stock', icon: Package, page: 'stock' },
  receivable_payment: { label: 'Paiement de créance', icon: Wallet, page: 'receivables' },
  driver_location: { label: 'Position GPS commercial', icon: Truck },
  audit_log: { label: 'Journal des actions', icon: Shield },
  profile: { label: 'Profil utilisateur', icon: Users, page: 'users' },
};

function translateEntity(type: string): string {
  return ENTITY_MAP[type]?.label ?? type;
}

function translateAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

interface AuditLogPageProps {
  onNavigate?: (page: string) => void;
}

export default function AuditLogPage({ onNavigate }: AuditLogPageProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const { fetchWithCache, isOffline } = useOfflineFetch();

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const result = await fetchWithCache('audit_logs', async () => {
      let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
      if (filterEntity) q = q.eq('entity_type', filterEntity);
      const { data } = await q;
      return data ?? [];
    });
    setLogs(result.data ?? []);
    setLoading(false);
  }, [fetchWithCache, filterEntity]);

  useEffect(() => { loadLogs(); }, [filterEntity, loadLogs]);

  useRealtimeSubscription('audit-log-page', isOffline ? [] : ['audit_logs'], () => { loadLogs(); });

  const filtered = search
    ? logs.filter((l) => {
        const s = search.toLowerCase();
        return (
          translateAction(l.action).toLowerCase().includes(s) ||
          translateEntity(l.entity_type).toLowerCase().includes(s) ||
          l.entity_type.toLowerCase().includes(s) ||
          (l.entity_label ?? '').toLowerCase().includes(s) ||
          (l.performed_by_name ?? '').toLowerCase().includes(s)
        );
      })
    : logs;

  const entityTypes = Object.keys(ENTITY_MAP).sort();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par action, entité, personne…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
        </div>
        <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
          <option value="">Toutes les rubriques</option>
          {entityTypes.map((t) => <option key={t} value={t}>{translateEntity(t)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Chargement…</div>
      ) : isOffline && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CloudOff className="w-12 h-12 mb-3 text-gray-300" />
          <p className="text-sm">Aucune donnée hors ligne. Connectez-vous à Internet au moins une fois pour charger le journal d'audit.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Aucune entrée dans le journal</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
          {filtered.map((log) => {
            const Icon = ACTION_ICONS[log.action] ?? Edit2;
            const entityMeta = ENTITY_MAP[log.entity_type];
            const EntityIcon = entityMeta?.icon ?? FileText;
            const canNavigate = entityMeta?.page && onNavigate;
            return (
              <div key={log.id} className="px-5 py-3 flex items-start gap-4">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{translateAction(log.action)}</span>
                    {canNavigate ? (
                      <button
                        onClick={() => onNavigate!(entityMeta!.page! as any)}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors group"
                      >
                        <EntityIcon className="w-3 h-3" />
                        {translateEntity(log.entity_type)}
                        <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        <EntityIcon className="w-3 h-3" />
                        {translateEntity(log.entity_type)}
                      </span>
                    )}
                    {log.entity_label && <span className="text-xs text-gray-500">· {log.entity_label}</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {log.performed_by_name ?? '—'} · {new Date(log.created_at).toLocaleString('fr-FR')}
                  </p>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <p className="text-xs text-gray-500 mt-1 font-mono bg-gray-50 rounded px-2 py-1">
                      {JSON.stringify(log.details)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
