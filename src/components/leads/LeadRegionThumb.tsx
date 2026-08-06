import { memo, useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { projectUfsCached } from '@/lib/geo';
import type { LocatableLead } from '@/lib/geo';
import { formatKm } from '@/lib/geo/describeFraming';
import { useGeoIndex } from '@/hooks/useGeoIndex';
import { useLeadFraming } from '@/hooks/useLeadFraming';
import { cn } from '@/lib/utils';

interface LeadRegionThumbProps {
  lead: LocatableLead;
  /** Lado do quadro, em px. 20 substitui o ícone na linha do card do kanban. */
  size?: number;
  /**
   * Qual endereço vale quando `city` e `visit_city` divergem. No card do kanban
   * é `'visit'`, para o desenho casar com o texto que já está ao lado.
   */
  prefer?: 'city' | 'visit';
  className?: string;
  /** Sem desenho possível, cai no pino de localização em vez de sumir. */
  fallbackIcon?: boolean;
}

/**
 * Silhueta do estado do lead com a posição marcada.
 *
 * Desenha em SVG a partir do asset embarcado — sem tile, sem Leaflet e sem
 * requisição — que é o que permite pôr um mapa em cada card do kanban sem
 * comprometer a rolagem. Quando a referência mais próxima é de outro estado,
 * desenha os dois e liga os pontos (regra do §3 do escopo).
 */
export const LeadRegionThumb = memo(function LeadRegionThumb({
  lead,
  size = 20,
  prefer = 'city',
  className,
  fallbackIcon = true,
}: LeadRegionThumbProps) {
  const geo = useGeoIndex();
  const resolved = useLeadFraming(lead, prefer);

  const drawing = useMemo(() => {
    if (!geo || !resolved) return null;

    const { framing, location } = resolved;
    const projected = projectUfsCached(framing.ufs, geo.shapes, size);
    if (projected.paths.length === 0) return null;

    return {
      projected,
      leadPoint: location.point ? projected.project(location.point) : null,
      targetPoint:
        framing.mode === 'TWO_STATES' && framing.target
          ? projected.project(framing.target.reference.point)
          : null,
      leadUf: framing.ufs[0],
    };
  }, [geo, resolved, size]);

  // Enquanto o asset carrega, e para lead sem localização reconhecida, mantém o
  // pino de sempre: o card não pode piscar nem perder altura por causa disto.
  if (!drawing || !resolved) {
    return fallbackIcon ? <MapPin className="h-3 w-3 flex-shrink-0" /> : null;
  }

  const { projected, leadPoint, targetPoint, leadUf } = drawing;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${projected.width} ${projected.height}`}
      className={cn('flex-shrink-0', className)}
      role="img"
      aria-label={resolved.short}
    >
      {projected.paths.map(({ uf, d }) => (
        <path
          key={uf}
          d={d}
          // Estado do lead sólido, vizinho apagado: lê-se "o lead está aqui, a
          // referência está lá".
          fill="currentColor"
          fillOpacity={uf === leadUf ? 0.28 : 0.12}
          stroke="currentColor"
          strokeOpacity={uf === leadUf ? 0.85 : 0.4}
          strokeWidth={0.75}
          strokeLinejoin="round"
        />
      ))}

      {leadPoint && targetPoint && (
        <line
          x1={leadPoint.x} y1={leadPoint.y}
          x2={targetPoint.x} y2={targetPoint.y}
          stroke="currentColor"
          strokeWidth={0.75}
          strokeDasharray="2 1.5"
          strokeOpacity={0.6}
        />
      )}

      {targetPoint && (
        <circle cx={targetPoint.x} cy={targetPoint.y} r={1.6} fill="currentColor" fillOpacity={0.6} />
      )}

      {leadPoint && (
        <circle
          cx={leadPoint.x} cy={leadPoint.y} r={2.2}
          className="text-primary"
          fill="currentColor"
        />
      )}
    </svg>
  );
});

/**
 * Distância até a referência mais próxima, como sufixo da linha de localização.
 * Nada é exibido quando o lead já está na capital ou quando não há ponto.
 */
export const LeadDistanceSuffix = memo(function LeadDistanceSuffix({
  lead,
  prefer = 'city',
  className,
}: {
  lead: LocatableLead;
  prefer?: 'city' | 'visit';
  className?: string;
}) {
  const resolved = useLeadFraming(lead, prefer);
  if (!resolved) return null;

  const { framing } = resolved;
  if (framing.mode !== 'ONE_STATE' && framing.mode !== 'TWO_STATES') return null;

  const target = framing.target!;
  const label =
    framing.mode === 'TWO_STATES'
      ? `${formatKm(target.km)} de ${target.reference.name}/${target.reference.uf}`
      : `${formatKm(target.km)} de ${target.reference.name}`;

  return (
    <span className={cn('flex-shrink-0 whitespace-nowrap opacity-80', className)} title={resolved.long}>
      · {label}
    </span>
  );
});
