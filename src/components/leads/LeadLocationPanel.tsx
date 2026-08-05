import { useEffect, useMemo, useState } from 'react';
import { GeoJSON, MapContainer, Polyline, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, Handshake, Info, MapPinned } from 'lucide-react';
import type { LocatableLead, PartnerReference, UfShape } from '@/lib/geo';
import { formatKm } from '@/lib/geo/describeFraming';
import { fetchMunicipalityShape, shapesToGeoJson, ufsToGeoJson } from '@/lib/geo/ibgeMalhas';
import { haversineKm, UF_NAMES } from '@/lib/geo';
import type { LocationConfidence, LocationWarning } from '@/lib/geo';
import { useGeoIndex } from '@/hooks/useGeoIndex';
import { useLeadFraming } from '@/hooks/useLeadFraming';
import { usePartnerReferences } from '@/hooks/usePartnerReferences';
import { Badge } from '@/components/ui/badge';

/**
 * Raio em que um parceiro conta como "na região" do lead.
 *
 * Aferido em 05/08/2026 sobre os 5.756 leads localizáveis: 29,8% têm parceiro a
 * até 100 km e 43,4% não têm nenhum a menos de 400 km. 300 km é o corte que
 * ainda significa "dá para acionar" sem encher o mapa de marcador irrelevante.
 */
const NEARBY_PARTNER_KM = 300;

/** Teto de marcadores de parceiro — acima disso o mapa vira sopa de pontos. */
const MAX_PARTNER_MARKERS = 6;

/** Verde do parceiro: precisa se distinguir do lead (primária) e da capital (cinza). */
const PARTNER_COLOR = '#059669';

interface PartnerDistance {
  partner: PartnerReference;
  km: number;
}

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
  const partners = usePartnerReferences();
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

  /**
   * Parceiros ordenados por distância até o lead.
   *
   * Ficam fora de `computeFraming` de propósito: a regra de um ou dois estados é
   * das capitais e bases. Parceiro é camada por cima do enquadramento — se
   * entrasse no cálculo, um parceiro vizinho passaria a decidir qual estado o
   * mapa desenha.
   */
  const partnerView = useMemo(() => {
    const empty = { nearby: [] as PartnerDistance[], nearest: null as PartnerDistance | null, inState: [] as PartnerReference[] };
    if (!resolved) return empty;

    const { location } = resolved;

    if (!location.point) {
      // Sem ponto (só a UF é conhecida) não há distância a calcular, mas ainda
      // é útil saber quem temos no estado.
      return {
        ...empty,
        inState: location.uf ? partners.references.filter((partner) => partner.uf === location.uf) : [],
      };
    }

    const point = location.point;
    const ranked = partners.references
      .map((partner) => ({ partner, km: haversineKm(point, partner.point) }))
      .sort((a, b) => a.km - b.km);

    return {
      nearby: ranked.filter((entry) => entry.km <= NEARBY_PARTNER_KM).slice(0, MAX_PARTNER_MARKERS),
      nearest: ranked[0] ?? null,
      inState: [] as PartnerReference[],
    };
  }, [resolved, partners]);

  const layers = useMemo(() => {
    if (!geo || !resolved) return null;

    const { framing, location } = resolved;
    const leadUf = framing.ufs[0];

    const bounds = framing.ufs
      .filter((uf) => geo.shapes[uf])
      .reduce<[number, number][]>((acc, uf) => {
        const [minLng, minLat, maxLng, maxLat] = geo.shapes[uf].bbox;
        acc.push([minLat, minLng], [maxLat, maxLng]);
        return acc;
      }, []);

    // Parceiro perto pode estar num terceiro estado, fora do enquadramento. O
    // desenho continua sendo de um ou dois estados — só a moldura estica o
    // bastante para o marcador não ficar escondido fora da tela.
    for (const entry of partnerView.nearby) {
      bounds.push([entry.partner.point.lat, entry.partner.point.lng]);
    }

    return {
      leadStates: ufsToGeoJson([leadUf], geo.shapes),
      neighborStates: framing.ufs.length > 1 ? ufsToGeoJson(framing.ufs.slice(1), geo.shapes) : null,
      bounds,
      leadPoint: location.point,
      target: framing.mode === 'TWO_STATES' || framing.mode === 'ONE_STATE' ? framing.target : null,
    };
  }, [geo, resolved, partnerView]);

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

          {/* Ligação até o parceiro mais próximo — é a distância que decide se dá
              para acionar alguém na região. Só a do primeiro: uma linha por
              parceiro viraria teia. */}
          {layers.leadPoint && partnerView.nearby[0] && (
            <Polyline
              positions={[
                [layers.leadPoint.lat, layers.leadPoint.lng],
                [partnerView.nearby[0].partner.point.lat, partnerView.nearby[0].partner.point.lng],
              ]}
              pathOptions={{ color: PARTNER_COLOR, weight: 2, dashArray: '2 4', opacity: 0.9 }}
            />
          )}

          {partnerView.nearby.map((entry) => (
            <CircleMarker
              key={entry.partner.key}
              center={[entry.partner.point.lat, entry.partner.point.lng]}
              radius={6}
              pathOptions={{ color: '#fff', fillColor: PARTNER_COLOR, fillOpacity: 1, weight: 2 }}
            >
              <Tooltip>
                {entry.partner.name} — {entry.partner.city}/{entry.partner.uf}, {formatKm(entry.km)}
              </Tooltip>
            </CircleMarker>
          ))}

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

      {(partnerView.nearby.length > 0 || partnerView.nearest || partnerView.inState.length > 0) && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Handshake className="h-3.5 w-3.5" style={{ color: PARTNER_COLOR }} />
            {partnerView.nearby.length > 0
              ? `Parceiros na região (até ${NEARBY_PARTNER_KM} km)`
              : 'Parceiros'}
          </div>

          {partnerView.nearby.length > 0 ? (
            <ol className="space-y-0.5 text-xs text-muted-foreground">
              {partnerView.nearby.map((entry, position) => (
                <li key={entry.partner.key} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className={position === 0 ? 'font-medium text-foreground' : undefined}>
                      {entry.partner.name}
                    </span>
                    {' — '}
                    {entry.partner.city}/{entry.partner.uf}
                    {entry.partner.ufMismatch && ' (UF do cadastro diverge)'}
                  </span>
                  <span className="tabular-nums flex-shrink-0">{formatKm(entry.km)}</span>
                </li>
              ))}
            </ol>
          ) : partnerView.nearest ? (
            <p className="text-xs text-muted-foreground">
              Nenhum parceiro num raio de {NEARBY_PARTNER_KM} km. O mais próximo é{' '}
              <span className="text-foreground">{partnerView.nearest.partner.name}</span>, em{' '}
              {partnerView.nearest.partner.city}/{partnerView.nearest.partner.uf} —{' '}
              {formatKm(partnerView.nearest.km)}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sem cidade do lead não dá para medir distância. Em {UF_NAMES[partnerView.inState[0].uf]} temos{' '}
              {partnerView.inState.map((partner) => `${partner.name} (${partner.city})`).join(', ')}.
            </p>
          )}

          {partners.unresolved > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {partners.unresolved === 1
                ? '1 parceiro ficou fora do mapa: cidade não reconhecida no cadastro.'
                : `${partners.unresolved} parceiros ficaram fora do mapa: cidade não reconhecida no cadastro.`}
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
