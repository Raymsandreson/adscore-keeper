import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import municipios from '@/lib/geo/data/municipios.json';
import ufShapes from '@/lib/geo/data/uf-malhas.json';
import { buildCapitalReferences, createMunicipalityIndex, type MunicipalityRow } from '@/lib/geo';
import type { GeoIndex } from '@/hooks/useGeoIndex';

const index = createMunicipalityIndex(municipios as MunicipalityRow[]);
const geo: GeoIndex = {
  index,
  references: buildCapitalReferences(index),
  shapes: ufShapes as never,
};

// O carregamento dos assets é assíncrono no app; aqui ele é controlado para
// separar "ainda não chegou" de "chegou e não deu para desenhar".
const loaded = vi.hoisted(() => ({ value: null as GeoIndex | null }));
vi.mock('@/hooks/useGeoIndex', () => ({ useGeoIndex: () => loaded.value }));

import { LeadDistanceSuffix, LeadRegionThumb } from '../LeadRegionThumb';

describe('LeadRegionThumb', () => {
  it('enquanto os dados não chegam, mantém o pino do card', () => {
    loaded.value = null;
    const { container } = render(<LeadRegionThumb lead={{ city: 'Picos', state: 'PI' }} />);

    expect(container.querySelector('svg.lucide-map-pin')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('desenha a silhueta do estado do lead', () => {
    loaded.value = geo;
    render(<LeadRegionThumb lead={{ city: 'Picos', state: 'PI' }} />);

    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toMatch(/^PI · Picos, \d+ km de Teresina$/);
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    // Um ponto: o do lead. Sem alvo em outro estado, não há segundo círculo.
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
  });

  it('com referência em outro estado, desenha os dois estados e liga os pontos', () => {
    loaded.value = geo;
    render(<LeadRegionThumb lead={{ city: 'Santana do Araguaia', state: 'PA' }} />);

    const svg = screen.getByRole('img');
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    expect(svg.querySelector('line')).toBeTruthy();
  });

  it('lead sem localização cai no pino, não some', () => {
    loaded.value = geo;
    const { container } = render(<LeadRegionThumb lead={{}} />);
    expect(container.querySelector('svg.lucide-map-pin')).toBeTruthy();
  });

  it('respeita a preferência por visit_city', () => {
    loaded.value = geo;
    const lead = { city: 'Teresina', state: 'PI', visit_city: 'Picos', visit_state: 'PI' };

    const { rerender } = render(<LeadRegionThumb lead={lead} prefer="city" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Teresina');

    rerender(<LeadRegionThumb lead={lead} prefer="visit" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Picos');
  });
});

describe('LeadDistanceSuffix', () => {
  it('mostra a distância no interior', () => {
    loaded.value = geo;
    render(<LeadDistanceSuffix lead={{ city: 'Picos', state: 'PI' }} />);
    expect(screen.getByText(/· \d+ km de Teresina/)).toBeTruthy();
  });

  it('inclui a UF quando a referência é de outro estado', () => {
    loaded.value = geo;
    render(<LeadDistanceSuffix lead={{ city: 'Santana do Araguaia', state: 'PA' }} />);
    expect(screen.getByText(/· \d+ km de Palmas\/TO/)).toBeTruthy();
  });

  it('não polui o card de quem já está na capital', () => {
    loaded.value = geo;
    const { container } = render(<LeadDistanceSuffix lead={{ city: 'Teresina', state: 'PI' }} />);
    expect(container.textContent).toBe('');
  });

  it('nada a dizer sem localização', () => {
    loaded.value = geo;
    const { container } = render(<LeadDistanceSuffix lead={{}} />);
    expect(container.textContent).toBe('');
  });
});
