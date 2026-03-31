import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Navigation, MapPin, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

// Fix leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const ambassadorIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const leadIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MapPoint {
  id: string;
  name: string;
  type: 'ambassador' | 'lead';
  city: string;
  state: string;
  phone?: string;
  lat: number;
  lng: number;
}

// Brazilian state capitals as fallback coordinates
const STATE_COORDS: Record<string, [number, number]> = {
  AC: [-9.97, -67.81], AL: [-9.65, -35.73], AP: [0.03, -51.06],
  AM: [-3.12, -60.02], BA: [-12.97, -38.51], CE: [-3.72, -38.52],
  DF: [-15.78, -47.93], ES: [-20.32, -40.34], GO: [-16.68, -49.26],
  MA: [-2.53, -44.28], MT: [-15.60, -56.10], MS: [-20.44, -54.65],
  MG: [-19.92, -43.94], PA: [-1.46, -48.50], PB: [-7.12, -34.86],
  PR: [-25.43, -49.27], PE: [-8.05, -34.87], PI: [-5.09, -42.80],
  RJ: [-22.91, -43.17], RN: [-5.79, -35.21], RS: [-30.03, -51.23],
  RO: [-8.76, -63.90], RR: [2.82, -60.67], SC: [-27.59, -48.55],
  SP: [-23.55, -46.63], SE: [-10.91, -37.07], TO: [-10.18, -48.33],
};

function getGoogleMapsRouteUrl(from: MapPoint, to: MapPoint) {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
}

function getWazeRouteUrl(to: MapPoint) {
  return `https://waze.com/ul?ll=${to.lat},${to.lng}&navigate=yes`;
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [points, map]);
  return null;
}

export function AmbassadorMap() {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFrom, setSelectedFrom] = useState<MapPoint | null>(null);

  useEffect(() => {
    fetchMapData();
  }, []);

  async function fetchMapData() {
    setLoading(true);
    try {
      // Fetch ambassadors (contacts with 'embaixador' classification)
      const { data: ambassadors } = await supabase
        .from('contacts')
        .select('id, full_name, city, state, phone, classifications')
        .or('classification.eq.embaixador,classifications.cs.{embaixador}');

      // Fetch leads with location data
      const { data: leads } = await supabase
        .from('leads')
        .select('id, lead_name, lead_city, lead_state, lead_phone')
        .not('lead_state', 'is', null);

      const mapPoints: MapPoint[] = [];

      // Add ambassadors
      ambassadors?.forEach(a => {
        if (a.state && STATE_COORDS[a.state]) {
          const [lat, lng] = STATE_COORDS[a.state];
          // Slight random offset to avoid overlap in same city
          mapPoints.push({
            id: a.id,
            name: a.full_name,
            type: 'ambassador',
            city: a.city || '',
            state: a.state,
            phone: a.phone || undefined,
            lat: lat + (Math.random() - 0.5) * 0.1,
            lng: lng + (Math.random() - 0.5) * 0.1,
          });
        }
      });

      // Add leads
      leads?.forEach(l => {
        if (l.lead_state && STATE_COORDS[l.lead_state]) {
          const [lat, lng] = STATE_COORDS[l.lead_state];
          mapPoints.push({
            id: l.id,
            name: l.lead_name || 'Lead',
            type: 'lead',
            city: l.lead_city || '',
            state: l.lead_state,
            phone: l.lead_phone || undefined,
            lat: lat + (Math.random() - 0.5) * 0.1,
            lng: lng + (Math.random() - 0.5) * 0.1,
          });
        }
      });

      setPoints(mapPoints);
    } catch (e) {
      console.error('Error fetching map data:', e);
    } finally {
      setLoading(false);
    }
  }

  const ambassadorCount = points.filter(p => p.type === 'ambassador').length;
  const leadCount = points.filter(p => p.type === 'lead').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-muted/30 rounded-lg">
        <p className="text-muted-foreground text-sm">Carregando mapa...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span>Embaixadores ({ambassadorCount})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span>Leads ({leadCount})</span>
        </div>
        {selectedFrom && (
          <div className="ml-auto text-muted-foreground">
            Rota de: <strong>{selectedFrom.name}</strong> — clique em outro ponto para traçar rota
          </div>
        )}
      </div>

      {/* Map */}
      <div className="rounded-lg overflow-hidden border" style={{ height: 500 }}>
        <MapContainer
          center={[-14.24, -51.93]}
          zoom={4}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points.length > 0 ? points : [{ lat: -14.24, lng: -51.93 } as any]} />

          {points.map(point => (
            <Marker
              key={point.id}
              position={[point.lat, point.lng]}
              icon={point.type === 'ambassador' ? ambassadorIcon : leadIcon}
            >
              <Popup>
                <div className="space-y-2 min-w-[200px]">
                  <div>
                    <p className="font-semibold text-sm">{point.name}</p>
                    <p className="text-xs text-gray-500">
                      {point.type === 'ambassador' ? '🏅 Embaixador' : '📋 Lead'}
                    </p>
                    <p className="text-xs">{point.city}{point.city && point.state ? ', ' : ''}{point.state}</p>
                    {point.phone && <p className="text-xs">{point.phone}</p>}
                  </div>

                  <div className="flex flex-col gap-1">
                    {selectedFrom && selectedFrom.id !== point.id ? (
                      <>
                        <a
                          href={getGoogleMapsRouteUrl(selectedFrom, point)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <Navigation className="h-3 w-3" /> Rota no Google Maps
                        </a>
                        <a
                          href={getWazeRouteUrl(point)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> Abrir no Waze
                        </a>
                        <button
                          onClick={() => {
                            const url = getGoogleMapsRouteUrl(selectedFrom, point);
                            navigator.clipboard.writeText(url);
                            toast.success('Link da rota copiado!');
                          }}
                          className="text-xs text-left text-green-600 hover:underline"
                        >
                          📋 Copiar link da rota
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setSelectedFrom(point);
                          toast.info(`Origem: ${point.name}. Clique em outro ponto.`);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline"
                      >
                        <MapPin className="h-3 w-3" /> Definir como origem da rota
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {selectedFrom && (
        <Button variant="outline" size="sm" onClick={() => setSelectedFrom(null)}>
          Limpar origem da rota
        </Button>
      )}
    </div>
  );
}
