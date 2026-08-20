import { useEffect, useState, useMemo } from 'react';
import { supabase, SalesPoint, DeliveryBatch, Driver, Deposit, formatFCFA } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { useAuth } from '@/contexts/AuthContext';
import { cachePageData, getCachedPageData } from '@/lib/readCache';
import LeafletMap, { MapMarker, escapeHtml } from '@/components/LeafletMap';
import {
  MapPin, Package, CheckCircle2, Clock, Undo2, AlertTriangle, CloudOff,
  Filter, Truck, Navigation, Crosshair, ArrowRight
} from 'lucide-react';

interface DriverLocation {
  driver_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
  is_tracking: boolean;
  driver: { full_name: string; zone: string } | null;
}

type FilterMode = 'all' | 'delivered' | 'pending' | 'returned';

interface PointWithStats {
  point: SalesPoint;
  delivered: number;
  returned: number;
  netSold: number;
  lastDelivery?: string;
}

export default function MapPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { profile, loading: authLoading, offlineMode, manualOffline } = useAuth();
  const isOffline = offlineMode || manualOffline || !navigator.onLine;
  const [points, setPoints] = useState<SalesPoint[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterDriver, setFilterDriver] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [filterDateTo, setFilterDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [useDateFilter, setUseDateFilter] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<PointWithStats | null>(null);
  const [liveDrivers, setLiveDrivers] = useState<DriverLocation[]>([]);

  useEffect(() => {
    if (authLoading) return;
    loadData();
  }, [filterDriver, filterDateFrom, filterDateTo, useDateFilter, profile, authLoading, isOffline]);

  const fetchLiveDrivers = async () => {
    if (isOffline) {
      const cached = await getCachedPageData<DriverLocation[]>('map:live-drivers');
      setLiveDrivers(cached?.data ?? []);
      return;
    }
    const { data } = await supabase
      .from('driver_locations')
      .select('*, driver:drivers(full_name, zone)')
      .eq('is_tracking', true);
    const drivers = (data ?? []) as unknown as DriverLocation[];
    setLiveDrivers(drivers);
    await cachePageData('map:live-drivers', drivers);
  };

  // Subscribe to live driver locations
  useEffect(() => {
    fetchLiveDrivers();

    const channel = supabase
      .channel('driver_locations_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, fetchLiveDrivers)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const loadData = async () => {
    setLoading(true);

    if (isOffline) {
      const cached = await getCachedPageData<{points: SalesPoint[]; deposits: Deposit[]; returns: any[]; batches: DeliveryBatch[]; drivers: Driver[]}>('map-page');
      if (cached) {
        setPoints(cached.data.points);
        setDeposits(cached.data.deposits);
        setReturns(cached.data.returns);
        setBatches(cached.data.batches);
        setDrivers(cached.data.drivers);
      }
      setLoading(false);
      return;
    }

    const isDriver = profile?.role === 1;
    let driverId: string | null = null;

    if (isDriver) {
      const { data: d } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', profile!.id)
        .maybeSingle();
      driverId = d?.id ?? null;
    }

    let batchQuery = supabase.from('delivery_batches').select('*');
    if (useDateFilter) {
      const from = filterDateFrom <= filterDateTo ? filterDateFrom : filterDateTo;
      const to = filterDateFrom <= filterDateTo ? filterDateTo : filterDateFrom;
      batchQuery = batchQuery.gte('batch_date', from).lte('batch_date', to);
    }
    if (filterDriver || isDriver) batchQuery = batchQuery.eq('driver_id', filterDriver || driverId || '');
    const { data: batchData } = await batchQuery;
    setBatches(batchData ?? []);

    const batchIds = (batchData ?? []).map((b) => b.id);

    const [pointsRes, depsRes, retsRes, driversRes] = await Promise.all([
      supabase.from('sales_points').select('*').eq('is_active', true).order('name'),
      batchIds.length > 0
        ? supabase.from('deposits').select('*, sales_point:sales_points(*)').in('batch_id', batchIds)
        : Promise.resolve({ data: [] as any[] }),
      batchIds.length > 0
        ? supabase.from('returns').select('*, sales_point:sales_points(*)').in('batch_id', batchIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('drivers').select('*').order('full_name'),
    ]);

    setPoints(pointsRes.data ?? []);
    setDeposits(depsRes.data ?? []);
    setReturns(retsRes.data ?? []);
    setDrivers(driversRes.data ?? []);
    fetchLiveDrivers();
    await cachePageData('map-page', {
      points: pointsRes.data ?? [],
      deposits: depsRes.data ?? [],
      returns: retsRes.data ?? [],
      batches: batchData ?? [],
      drivers: driversRes.data ?? [],
    });
    setLoading(false);
  };

  useRealtimeSubscription('map-page-drivers', isOffline ? [] : ['drivers'], () => { loadData(); });

  // Compute stats per sales point
  const pointsWithStats: PointWithStats[] = useMemo(() => {
    return points.map((point) => {
      const pointDeposits = deposits.filter((d) => d.sales_point_id === point.id);
      const pointReturns = returns.filter((r) => r.sales_point_id === point.id);
      const delivered = pointDeposits.reduce((s, d) => s + d.quantity, 0);
      const returned = pointReturns.reduce((s: number, r: any) => s + r.quantity, 0);
      const lastDelivery = pointDeposits
        .map((d) => d.deposited_at)
        .sort((a, b) => b.localeCompare(a))[0];
      return {
        point,
        delivered,
        returned,
        netSold: delivered - returned,
        lastDelivery,
      };
    });
  }, [points, deposits, returns]);

  // Filter points based on mode
  const filteredPoints = useMemo(() => {
    return pointsWithStats.filter((p) => {
      if (!p.point.gps_lat || !p.point.gps_lng) return false;
      if (filterMode === 'delivered') return p.delivered > 0 && p.returned === 0;
      if (filterMode === 'pending') return p.delivered === 0;
      if (filterMode === 'returned') return p.returned > 0;
      return true;
    });
  }, [pointsWithStats, filterMode]);

  // Build markers
  const markers: MapMarker[] = useMemo(() => {
    return filteredPoints.map((p) => {
      let icon: MapMarker['icon'] = 'pending';
      if (p.returned > 0) icon = 'returned';
      else if (p.delivered > 0) icon = 'delivered';

      const popupHtml = `
        <div style="min-width:180px;">
          <strong style="font-size:14px;color:#111827;">${escapeHtml(p.point.name)}</strong><br/>
          <span style="color:#6b7280;font-size:12px;">${escapeHtml(p.point.district)}${p.point.arrondissement ? ', ' + escapeHtml(p.point.arrondissement) : ''}</span><br/>
          <hr style="margin:6px 0;border-color:#e5e7eb;"/>
          <div style="font-size:12px;color:#374151;">
            <div style="color:#059669;font-weight:600;">✓ ${p.delivered} pots déposés</div>
            <div style="color:#e11d48;">↩ ${p.returned} pots retournés</div>
            <div style="font-weight:600;margin-top:4px;">Net vendu: ${p.netSold} pots</div>
            ${p.lastDelivery ? `<div style="color:#9ca3af;margin-top:2px;">Dernier: ${new Date(p.lastDelivery).toLocaleString('fr-FR')}</div>` : ''}
          </div>
        </div>
      `;

      return {
        id: p.point.id,
        lat: p.point.gps_lat!,
        lng: p.point.gps_lng!,
        title: escapeHtml(p.point.name),
        popupHtml,
        icon,
      };
    });
  }, [filteredPoints]);

  // Driver markers (live GPS positions)
  const driverMarkers: MapMarker[] = useMemo(() => {
    return liveDrivers
      .filter((dl) => dl.lat != null && dl.lng != null && !isNaN(dl.lat) && !isNaN(dl.lng))
      .map((dl) => ({
        id: `driver-${dl.driver_id}`,
        lat: dl.lat,
        lng: dl.lng,
        title: escapeHtml(dl.driver?.full_name ?? 'Commercial'),
        icon: 'driver' as const,
        popupHtml: `
          <div style="min-width:160px;">
            <strong style="font-size:14px;color:#111827;">${escapeHtml(dl.driver?.full_name ?? 'Commercial')}</strong><br/>
            <span style="color:#6b7280;font-size:12px;">Zone: ${escapeHtml(dl.driver?.zone ?? '-')}</span><br/>
            <hr style="margin:6px 0;border-color:#e5e7eb;"/>
            <div style="font-size:12px;color:#374151;">
              <div style="color:#2563eb;font-weight:600;">Position en temps réel</div>
              ${dl.accuracy ? `<div style="color:#9ca3af;">Précision: ±${Math.round(dl.accuracy)} m</div>` : ''}
              <div style="color:#9ca3af;margin-top:2px;">MAJ: ${new Date(dl.recorded_at).toLocaleTimeString('fr-FR')}</div>
            </div>
          </div>
        `,
      }));
  }, [liveDrivers]);

  const allMarkers = [...markers, ...driverMarkers];

  // Stats summary
  const stats = useMemo(() => {
    const totalDelivered = pointsWithStats.reduce((s, p) => s + p.delivered, 0);
    const totalReturned = pointsWithStats.reduce((s, p) => s + p.returned, 0);
    const deliveredPoints = pointsWithStats.filter((p) => p.delivered > 0).length;
    const pendingPoints = pointsWithStats.filter((p) => p.delivered === 0).length;
    const returnedPoints = pointsWithStats.filter((p) => p.returned > 0).length;
    return { totalDelivered, totalReturned, deliveredPoints, pendingPoints, returnedPoints, totalPoints: pointsWithStats.length };
  }, [pointsWithStats]);

  const FILTER_BUTTONS: { mode: FilterMode; label: string; icon: typeof MapPin; color: string }[] = [
    { mode: 'all', label: 'Tous', icon: MapPin, color: 'text-gray-600' },
    { mode: 'delivered', label: 'Livrés', icon: CheckCircle2, color: 'text-emerald-600' },
    { mode: 'pending', label: 'En attente', icon: Clock, color: 'text-amber-600' },
    { mode: 'returned', label: 'Retours', icon: Undo2, color: 'text-rose-600' },
  ];

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
            {FILTER_BUTTONS.map((btn) => {
              const Icon = btn.icon;
              return (
                <button key={btn.mode} onClick={() => setFilterMode(btn.mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    filterMode === btn.mode ? 'bg-white shadow-sm ' + btn.color : 'text-gray-500'
                  }`}>
                  <Icon className="w-4 h-4" />
                  {btn.label}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={useDateFilter} onChange={(e) => setUseDateFilter(e.target.checked)}
              className="w-4 h-4 rounded text-amber-500 focus:ring-amber-200" />
            Période
          </label>
          {useDateFilter && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
              <span className="text-gray-400 text-sm">→</span>
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none" />
            </div>
          )}

          {(profile?.role ?? 0) >= 2 && (
            <select value={filterDriver} onChange={(e) => setFilterDriver(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-amber-500 outline-none">
              <option value="">Tous les commerciaux</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          )}

          <button onClick={loadData}
            className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors">
            <Navigation className="w-4 h-4" />
            Actualiser
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Points total', value: stats.totalPoints, color: 'text-gray-900', bg: 'bg-gray-50' },
          { label: 'Points livrés', value: stats.deliveredPoints, color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: 'En attente', value: stats.pendingPoints, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'Avec retours', value: stats.returnedPoints, color: 'text-rose-700', bg: 'bg-rose-50' },
          { label: 'Pots livrés', value: stats.totalDelivered, color: 'text-blue-700', bg: 'bg-blue-50' },
        ].map((c) => (
          <div key={c.label} className={`${c.bg} rounded-2xl p-4`}>
            <p className="text-xs text-gray-600">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Map + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-[500px] text-gray-400">Chargement de la carte…</div>
          ) : isOffline ? (
            <div className="flex flex-col items-center justify-center h-[500px] px-6 text-center text-gray-500">
              <CloudOff className="w-12 h-12 mb-3 text-amber-500" />
              <p className="font-medium text-gray-700">Vue de tournée hors ligne</p>
              <p className="text-sm mt-1">Les points, livraisons et retours enregistrés localement restent disponibles dans la liste à droite.</p>
              <p className="text-xs mt-3 text-gray-400">La carte nécessite Internet pour charger son fond cartographique.</p>
            </div>
          ) : allMarkers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[500px] text-gray-400">
              <MapPin className="w-12 h-12 mb-3 text-gray-300" />
              <p>Aucun point avec coordonnées GPS</p>
              <p className="text-sm mt-1">Ajoutez des coordonnées GPS aux points de vente pour les voir sur la carte</p>
            </div>
          ) : (
            <div className="h-[500px]">
              <LeafletMap markers={allMarkers} fitToMarkers={true} />
            </div>
          )}
          {/* Legend */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-600 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
              Livré
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow-sm" />
              En attente
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500 border-2 border-white shadow-sm" />
              Avec retours
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
              Commercial (live)
            </span>
          </div>
        </div>

        {/* Side panel: point list */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-h-[560px] overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
            <h3 className="font-semibold text-gray-900 text-sm">
              Points de livraison ({filteredPoints.length})
            </h3>
          </div>
          <div className="divide-y divide-gray-50">
            {filteredPoints.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400 text-sm">Aucun point à afficher</p>
            )}
            {filteredPoints.map((p) => {
              const isSelected = selectedPoint?.point.id === p.point.id;
              return (
                <button
                  key={p.point.id}
                  onClick={() => setSelectedPoint(isSelected ? null : p)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-amber-50' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      p.returned > 0 ? 'bg-rose-100' : p.delivered > 0 ? 'bg-emerald-100' : 'bg-amber-100'
                    }`}>
                      {p.returned > 0 ? <Undo2 className="w-4 h-4 text-rose-600" /> :
                        p.delivered > 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                        <Clock className="w-4 h-4 text-amber-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.point.name}</p>
                      <p className="text-xs text-gray-500">{p.point.district}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-emerald-600">{p.delivered} déposés</span>
                        {p.returned > 0 && <span className="text-rose-600">{p.returned} retours</span>}
                        <span className="text-gray-400">· net {p.netSold}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected point detail */}
      {selectedPoint && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-bold text-gray-900">{selectedPoint.point.name}</h3>
              <p className="text-sm text-gray-500">
                {selectedPoint.point.district}{selectedPoint.point.arrondissement ? ', ' + selectedPoint.point.arrondissement : ''}
                {selectedPoint.point.address ? ' · ' + selectedPoint.point.address : ''}
              </p>
            </div>
            <button onClick={() => setSelectedPoint(null)}
              className="text-xs text-gray-400 hover:text-gray-600">Fermer</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3">
              <p className="text-xs text-gray-600">Pots déposés</p>
              <p className="text-xl font-bold text-emerald-700">{selectedPoint.delivered}</p>
            </div>
            <div className="bg-rose-50 rounded-xl p-3">
              <p className="text-xs text-gray-600">Pots retournés</p>
              <p className="text-xl font-bold text-rose-700">{selectedPoint.returned}</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs text-gray-600">Net vendu</p>
              <p className="text-xl font-bold text-blue-700">{selectedPoint.netSold}</p>
            </div>
          </div>
          {selectedPoint.point.owner_name && (
            <p className="text-sm text-gray-600 mt-3">
              Propriétaire : {selectedPoint.point.owner_name}
              {selectedPoint.point.owner_phone ? ' · ' + selectedPoint.point.owner_phone : ''}
            </p>
          )}
          {selectedPoint.point.delivery_days.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedPoint.point.delivery_days.map((d) => (
                <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">{d}</span>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => onNavigate?.('sales-points')}
              className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-1.5">
              <ArrowRight className="w-4 h-4" /> Voir PDV
            </button>
            <button onClick={() => onNavigate?.('drivers')}
              className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors flex items-center gap-1.5">
              <ArrowRight className="w-4 h-4" /> Voir commerciaux
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
