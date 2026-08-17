import { useState, useEffect, useRef, useCallback } from 'react';

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export interface GeoError {
  code: number;
  message: string;
}

export type TrackingStatus = 'idle' | 'starting' | 'tracking' | 'error' | 'denied';

interface UseGeolocationOptions {
  enabled: boolean;
  intervalMs?: number;
  onUpdate?: (pos: GeoPosition) => void;
}

export function useGeolocation({ enabled, intervalMs = 15000, onUpdate }: UseGeolocationOptions) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [error, setError] = useState<GeoError | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const lastPosRef = useRef<GeoPosition | null>(null);

  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const handlePosition = useCallback((coords: GeolocationPosition['coords'], ts: number) => {
    const geo: GeoPosition = {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      heading: coords.heading,
      speed: coords.speed,
      timestamp: ts,
    };
    setPosition(geo);
    lastPosRef.current = geo;
    onUpdateRef.current?.(geo);
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    const geoErr: GeoError = { code: err.code, message: err.message };
    setError(geoErr);
    if (err.code === 1) setStatus('denied');
    else setStatus('error');
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setError({ code: 0, message: "La géolocalisation n'est pas supportée par ce navigateur." });
      return;
    }

    setStatus('starting');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('tracking');
        handlePosition(pos.coords, pos.timestamp);
      },
      handleError,
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );

    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setStatus('tracking');
          handlePosition(pos.coords, pos.timestamp);
        },
        handleError,
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
      );
    }, intervalMs);

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (intervalRef.current != null) clearInterval(intervalRef.current);
      watchIdRef.current = null;
      intervalRef.current = null;
    };
  }, [enabled, intervalMs, handlePosition, handleError]);

  return { position, status, error };
}
