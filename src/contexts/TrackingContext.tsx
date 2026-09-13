import { createContext, useContext, useEffect, useRef, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useGeolocation, GeoPosition, TrackingStatus } from '@/hooks/useGeolocation';

interface TrackingContextValue {
  position: GeoPosition | null;
  status: TrackingStatus;
  isMandatory: boolean;
  isBlocked: boolean;
}

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const isDriver = profile?.role === 1;
  const driverIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDriver || !profile) return;
    supabase
      .from('drivers')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) driverIdRef.current = data.id;
      });
  }, [isDriver, profile?.id]);

  const sendLocation = useCallback(async (pos: GeoPosition) => {
    const driverId = driverIdRef.current;
    if (!driverId) return;
    const recordedAt = new Date(pos.timestamp).toISOString();
    await supabase.from('driver_locations').upsert({
      driver_id: driverId,
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      heading: pos.heading,
      speed: pos.speed,
      recorded_at: recordedAt,
      is_tracking: true,
    });
    // Historique append-only (table distincte, jamais écrasée) pour le
    // rapport de suivi a posteriori (temps par point de vente / entre
    // livraisons) — voir src/lib/tourneeSuivi.ts. Erreur ignorée si la
    // migration driver_location_history n'est pas encore déployée.
    await supabase.from('driver_location_history').insert({
      driver_id: driverId,
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      heading: pos.heading,
      speed: pos.speed,
      recorded_at: recordedAt,
    }).then(() => {}, () => {});
  }, []);

  const { position, status } = useGeolocation({
    enabled: isDriver,
    intervalMs: 15000,
    onUpdate: sendLocation,
  });

  // Mark tracking as stopped when driver logs out or unmounts
  useEffect(() => {
    if (!isDriver) return;
    return () => {
      const driverId = driverIdRef.current;
      if (driverId) {
        supabase
          .from('driver_locations')
          .update({ is_tracking: false, recorded_at: new Date().toISOString() })
          .eq('driver_id', driverId);
      }
    };
  }, [isDriver]);

  const isBlocked = isDriver && (status === 'denied' || status === 'error');

  return (
    <TrackingContext.Provider value={{ position, status, isMandatory: isDriver, isBlocked }}>
      {children}
    </TrackingContext.Provider>
  );
}

export function useTracking() {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}
