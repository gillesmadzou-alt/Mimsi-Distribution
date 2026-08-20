import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Fix default marker icons (Leaflet's bundler issue)
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  popupHtml?: string;
  color?: string;
  icon?: 'default' | 'delivered' | 'pending' | 'returned' | 'low-stock' | 'driver';
}

interface LeafletMapProps {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  className?: string;
  onMarkerClick?: (id: string) => void;
  fitToMarkers?: boolean;
}

function createColoredIcon(color: string): L.DivIcon {
  const colors: Record<string, string> = {
    emerald: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    blue: '#3b82f6',
    violet: '#8b5cf6',
    rose: '#f43f5e',
    gray: '#6b7280',
  };
  const c = colors[color] ?? '#6b7280';
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:${escapeHtml(c)};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

const ICON_COLORS: Record<string, string> = {
  delivered: 'emerald',
  pending: 'amber',
  returned: 'rose',
  'low-stock': 'red',
  driver: 'blue',
  default: 'gray',
};

export default function LeafletMap({
  markers,
  center = [-4.2634, 15.2429], // Brazzaville default
  zoom = 12,
  className = '',
  onMarkerClick,
  fitToMarkers = true,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Fix size after render
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();

    const validMarkers = markers.filter((m) => m.lat != null && m.lng != null && !isNaN(m.lat) && !isNaN(m.lng));

    validMarkers.forEach((marker) => {
      const colorKey = marker.icon ?? 'default';
      const color = ICON_COLORS[colorKey] ?? marker.color ?? 'gray';
      const icon = createColoredIcon(color);

      const m = L.marker([marker.lat, marker.lng], { icon })
        .bindPopup(marker.popupHtml ?? `<strong>${escapeHtml(marker.title)}</strong>`);

      if (onMarkerClick) {
        m.on('click', () => onMarkerClick(marker.id));
      }

      markerLayerRef.current!.addLayer(m);
    });

    // Fit bounds
    if (fitToMarkers && validMarkers.length > 0) {
      const bounds = L.latLngBounds(validMarkers.map((m) => [m.lat, m.lng] as [number, number]));
      if (validMarkers.length === 1) {
        mapRef.current.setView([validMarkers[0].lat, validMarkers[0].lng], 15);
      } else {
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
  }, [markers, fitToMarkers, onMarkerClick]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full rounded-2xl overflow-hidden z-0 ${className}`}
      style={{ minHeight: '400px' }}
    />
  );
}
