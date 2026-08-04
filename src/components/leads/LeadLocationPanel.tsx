import { useEffect, useMemo, useState } from 'react';
import { GeoJSON, MapContainer, Polyline, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, Info, MapPinned } from 'lucide-react';
import type { LocatableLead, UfShape } from '@/lib/geo';
import { formatKm } from '@/lib/geo/describeFraming';
import { fetchMunicipalityShape, shapesToGeoJson, ufsToGeoJson } from '@/lib/geo/ibgeMalhas';
import { UF_NAMES } from '@/lib/geo';
import type { LocationConfidence, LocationWarning } from '@/lib/geo';
import { useGeoIndex } from '@/hooks/useGeoIndex';
import { useLeadFraming } from '@/hooks/useLeadFraming';
import { Badge } from '@/components/ui/badge';

const CONFIDENCE_LABEL: Record<LocationConfidence, string> = {
  coordinate: 'Coordenada do lead',
  municipality: 'Centro do município',
  inferred: 'Cidade sem UF — inferida',
  uf: 'Só o estado',
  none: 'Sem localização',
};

/** Texto de cada inconsistência de cadastro que a resolução detectou. */
function warningText(warning: LocationWarning): string {
  switch (warning.type) {
    case 'no_data':
      return 'Lead sem cidade ou estado no cadastro.';
    case 'uf_mismatch':
      return `"${warning.city}" não existe em ${warning.informedUf} — consta em ${warning.possibleUfs.join(', ')}. Corrija o cadastro para o mapa ficar correto.`;
    case 'ambiguous_city':
      return `"${warning.city}" existe em ${warning.possibleUfs.join(', ')}. Informe o estado.`;
    case 'unknown_city':
      return `"${warning.city}" não é um município reconhecido — pode ser bairro ou abreviação.`;
    case 'municipality_without_center':
      return `${warning.city}/${warning.uf} é município novo e ainda não tem malha publicada pelo IBGE.`;
    case 'city_visit_divergence':
      return `Cadastro tem "${warning.city}" e visita em "${warning.visitCity}".`;
  }
}

function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();

  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
  }, [bounds, map]);

  return null;
}

interface LeadLocationPanelProps {
  lead: LocatableLead;
  /** A aba edita os campos de visita, então é o que manda no desenho. */
  prefer?: 'city' | 'visit';
}

/**
 * Mapa da região do lead na ficha: estado (ou dois), município destacado,
 * posição do lead, referência mais próxima e a distância entre eles.
 *
 * É a versão completa do que o card mostra em miniatura — aqui com tiles, para
 * dar contexto de relevo e vizinhança.
 */
export function LeadLocationPanel({ lead, prefer = 'visit' }: LeadLocationPanelProps) {
  const geo = useGeoIndex();
  const resolved = useLeadFraming(lead, prefer);
  const [municipalityShape, setMunicipalityShape] = useState<UfShape | null>(null);

  const ibgeCode = resolved?.location.municipality?.ibgeCode ?? null;

  useEffect(() => {
    if (!ibgeCode) {
      setMunicipalityShape(null);
      return;
    }

    let active = true;
    setMunicipalityShape(null);
    fetchMunicipalityShape(ibgeCode).then((shape) => {
      if (active) setMunicipalityShape(shape);
    });

    return () => {
      active = false;
    };
  }, [ibgeCode]);

  const layers = useMemo(() => {
    if (!geo || !resolved) return null;

    const { framing, location } = resolved;
    const leadUf = framing.ufs[0];

    return {
      leadStates: ufsToGeoJson([leadUf], geo.shapes),
      neighborStates: framing.ufs.length > 1 ? ufsToGeoJson(framing.ufs.slice(1), geo.shapes) : null,
      bounds: framing.ufs
        .filter((uf) => geo.shapes[uf])
        .reduce<[number, number][]>((acc, uf) => {
          const [minLng, minLat, maxLng, maxLat] = geo.shapes[uf].bbox;
          acc.push([minLat, minLng], [maxLat, maxLng]);
          return acc;
        }, []),
      leadPoint: location.point,
      target: framing.mode === 'TWO_STATES' || framing.mode === 'ONE_STATE' ? framing.target : null,
    };
  }, [geo, resolved]);

  if (!resolved || !layers) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <MapPinned className="mx-auto mb-2 h-5 w-5 opacity-60" />
        {geo ? 'Sem cidade ou estado para localizar este lead.' : 'Carregando mapa...'}
      </div>
    );
  }

  const { framing, location } = resolved;
  const place = location.municipality
    ? `${location.municipality.name}/${location.municipality.uf}`
    : location.uf
      ? UF_NAMES[location.uf]
      : '';

  // Em STATE_ONLY o parágrafo principal já nomeia a cidade não reconhecida;
  // repetir a mesma frase logo abaixo só faz o painel parecer confuso.
  const visibleWarnings =
    framing.mode === 'STATE_ONLY'
      ? location.warnings.filter((warning) => warning.type !== 'unknown_city')
      : location.warnings;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MapPinned className="h-4 w-4 text-primary" />
          {place}
        </div>
        <Badge variant="outline" className="text-[11px] font-normal">
          {CONFIDENCE_LABEL[location.confidence]}
        </Badge>
      </div>

      <div className="h-72 w-full overflow-hidden rounded-md border">
        <MapContainer
          // Dentro de um dialog que rola, capturar a roda do mouse faz o usuário
          // dar zoom sem querer ao tentar rolar a ficha.
          scrollWheelZoom={false}
          center={[-14.235, -51.9253]}
          zoom={4}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitToBounds bounds={layers.bounds.length ? (layers.bounds as LatLngBoundsExpression) : null} />

          {layers.neighborStates && (
            <GeoJSON
              key={`neighbor-${framing.ufs.join('-')}`}
              data={layers.neighborStates}
              style={{ color: '#94a3b8', weight: 1, fillColor: '#94a3b8', fillOpacity: 0.08, dashArray: '4 3' }}
            />
          )}

          <GeoJSON
            key={`lead-${framing.ufs[0]}`}
            data={layers.leadStates}
            style={{ color: '#64748b', weight: 1.5, fillColor: '#64748b', fillOpacity: 0.08 }}
          />

          {municipalityShape && (
            <GeoJSON
              key={`mun-${ibgeCode}`}
              data={shapesToGeoJson([{ uf: location.municipality!.uf, shape: municipalityShape }])}
              style={{ color: 'hsl(var(--primary))', weight: 2, fillColor: 'hsl(var(--primary))', fillOpacity: 0.25 }}
            />
          )}

          {layers.leadPoint && layers.target && (
            <Polyline
              positions={[
                [layers.leadPoint.lat, layers.leadPoint.lng],
                [layers.target.reference.point.lat, layers.target.reference.point.lng],
              ]}
              pathOptions={{ color: 'hsl(var(--primary))', weight: 2, dashArray: '6 5', opacity: 0.8 }}
            />
          )}

          {layers.target && (
            <CircleMarker
              center={[layers.target.reference.point.lat, layers.target.reference.point.lng]}
              radius={5}
              pathOptions={{ color: '#475569', fillColor: '#475569', fillOpacity: 0.9, weight: 1 }}
            >
              <Tooltip>
                {layers.target.reference.name}/{layers.target.reference.uf} — {formatKm(layers.target.km)}
              </Tooltip>
            </CircleMarker>
          )}

          {layers.leadPoint && (
            <CircleMarker
              center={[layers.leadPoint.lat, layers.leadPoint.lng]}
              radius={7}
              pathOptions={{ color: '#fff', fillColor: 'hsl(var(--primary))', fillOpacity: 1, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -6]}>
                {place}
              </Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      <p className="text-sm">{resolved.long}</p>

      {framing.alternatives.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Referências mais próximas</div>
          <ol className="space-y-0.5 text-xs text-muted-foreground">
            {framing.alternatives.map((alternative, position) => (
              <li key={alternative.reference.key} className="flex items-center justify-between gap-2">
                <span className={position === 0 ? 'font-medium text-foreground' : undefined}>
                  {alternative.reference.name}/{alternative.reference.uf}
                  {alternative.reference.kind !== 'capital' && ' (base)'}
                </span>
                <span className="tabular-nums">{formatKm(alternative.km)}</span>
              </li>
            ))}
          </ol>
          {framing.tie && (
            <p className="text-[11px] text-muted-foreground">
              As duas primeiras estão praticamente à mesma distância.
            </p>
          )}
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <ul className="space-y-1">
          {visibleWarnings.map((warning, position) => {
            const critical = warning.type === 'uf_mismatch' || warning.type === 'ambiguous_city';
            const Icon = critical ? AlertTriangle : Info;
            return (
              <li
                key={`${warning.type}-${position}`}
                className={`flex items-start gap-1.5 text-[11px] ${critical ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}`}
              >
                <Icon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>{warningText(warning)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">
        Distâncias em linha reta. Por estrada costumam ser 20% a 40% maiores.
      </p>
    </div>
  );
}

export default LeadLocationPanel;
