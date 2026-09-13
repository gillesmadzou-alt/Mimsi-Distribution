import { supabase } from './supabase';

// Rayon de proximité GPS pour considérer qu'un livreur est « sur » un point
// de vente (marge pour le bruit habituel du GPS mobile en zone urbaine).
// Confirmé avec l'utilisateur le 13/09/2026.
export const SALES_POINT_RADIUS_M = 50;

interface HistoryPing {
  lat: number;
  lng: number;
  recorded_at: string;
}

export interface TourneeVisit {
  salesPointId: string;
  salesPointName: string;
  depositedAt: string;
  minutesSincePrevious: number | null;
  dwellMinutes: number | null;
}

export interface TourneeSuivi {
  batchCode: string;
  driverName: string;
  visits: TourneeVisit[];
  historyAvailable: boolean;
}

// Distance en mètres entre deux points GPS (formule de Haversine).
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Temps passé sur un point de vente : plus ancien et plus récent ping GPS
// à moins de SALES_POINT_RADIUS_M du point, dans la fenêtre de recherche
// donnée (entre la livraison précédente et cette livraison + une marge).
function computeDwellMinutes(
  pings: HistoryPing[],
  pointLat: number,
  pointLng: number,
  windowStart: Date,
  windowEnd: Date,
): number | null {
  const inRadius = pings.filter((p) => {
    const t = new Date(p.recorded_at);
    if (t < windowStart || t > windowEnd) return false;
    return distanceMeters(p.lat, p.lng, pointLat, pointLng) <= SALES_POINT_RADIUS_M;
  });
  if (inRadius.length === 0) return null;
  const times = inRadius.map((p) => new Date(p.recorded_at).getTime());
  return Math.round((Math.max(...times) - Math.min(...times)) / 60000);
}

/**
 * Calcule le rapport de suivi (a posteriori) d'une tournée : temps passé
 * sur chaque point de vente et temps écoulé depuis la livraison précédente.
 * Le temps passé n'est disponible que si driver_location_history contient
 * des pings sur la période de la tournée (table alimentée à partir du
 * déploiement de la migration 20260913080000 — rien pour les tournées
 * antérieures, `historyAvailable` l'indique).
 */
export async function computeTourneeSuivi(batchId: string): Promise<TourneeSuivi | { error: string }> {
  const { data: batch, error: batchError } = await supabase
    .from('delivery_batches')
    .select('batch_code, driver_id, created_at, driver:drivers(full_name)')
    .eq('id', batchId)
    .maybeSingle();
  if (batchError || !batch) return { error: 'Tournée introuvable.' };

  const { data: deposits, error: depositsError } = await supabase
    .from('deposits')
    .select('sales_point_id, deposited_at, sales_point:sales_points(name, gps_lat, gps_lng)')
    .eq('batch_id', batchId)
    .order('deposited_at', { ascending: true });
  if (depositsError) return { error: 'Impossible de charger les livraisons de cette tournée.' };
  if (!deposits || deposits.length === 0) return { error: 'Aucune livraison enregistrée pour cette tournée.' };

  const driverName = (batch.driver as unknown as { full_name: string } | null)?.full_name ?? '—';
  const tourneeStart = new Date(batch.created_at);
  const lastDeposit = new Date(deposits[deposits.length - 1].deposited_at);
  const searchEnd = new Date(lastDeposit.getTime() + 15 * 60000); // +15 min de marge

  const { data: history, error: historyError } = await supabase
    .from('driver_location_history')
    .select('lat, lng, recorded_at')
    .eq('driver_id', batch.driver_id)
    .gte('recorded_at', tourneeStart.toISOString())
    .lte('recorded_at', searchEnd.toISOString())
    .order('recorded_at', { ascending: true });

  const pings: HistoryPing[] = historyError ? [] : ((history as HistoryPing[]) ?? []);
  const historyAvailable = !historyError && pings.length > 0;

  let previousTime = tourneeStart;
  const visits: TourneeVisit[] = deposits.map((d) => {
    const sp = d.sales_point as unknown as { name: string; gps_lat: number | null; gps_lng: number | null } | null;
    const depositedAt = new Date(d.deposited_at);
    const minutesSincePrevious = Math.round((depositedAt.getTime() - previousTime.getTime()) / 60000);
    const dwellMinutes =
      sp?.gps_lat != null && sp?.gps_lng != null
        ? computeDwellMinutes(pings, sp.gps_lat, sp.gps_lng, previousTime, new Date(depositedAt.getTime() + 15 * 60000))
        : null;
    previousTime = depositedAt;
    return {
      salesPointId: d.sales_point_id,
      salesPointName: sp?.name ?? 'Point de vente',
      depositedAt: d.deposited_at,
      minutesSincePrevious,
      dwellMinutes,
    };
  });

  return { batchCode: batch.batch_code, driverName, visits, historyAvailable };
}
