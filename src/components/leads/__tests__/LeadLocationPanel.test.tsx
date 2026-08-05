import type { ReactNode } from 'react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const loaded = vi.hoisted(() => ({ value: null as GeoIndex | null }));
vi.mock('@/hooks/useGeoIndex', () => ({ useGeoIndex: () => loaded.value }));

// O Leaflet precisa de layout real, que o jsdom não tem. Aqui interessa a lógica
// de camadas — quais polígonos e marcadores o painel decide desenhar.
type Wrapper = { children?: ReactNode };

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: Wrapper) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tiles" />,
  GeoJSON: ({ data }: { data: GeoJSON.FeatureCollection }) => (
    <div
      data-testid="geojson"
      data-ufs={data.features.map((f) => f.properties?.uf).join(',')}
    />
  ),
  Polyline: () => <div data-testid="polyline" />,
  CircleMarker: ({ children }: Wrapper) => <div data-testid="marker">{children}</div>,
  Tooltip: ({ children }: Wrapper) => <span>{children}</span>,
  useMap: () => ({ fitBounds: vi.fn() }),
}));

vi.mock('@/lib/geo/ibgeMalhas', async () => {
  const actual = await vi.importActual<typeof import('@/lib/geo/ibgeMalhas')>('@/lib/geo/ibgeMalhas');
  return { ...actual, fetchMunicipalityShape: vi.fn().mockResolvedValue(null) };
});

import { LeadLocationPanel } from '../LeadLocationPanel';

describe('LeadLocationPanel', () => {
  it('avisa que está carregando antes dos dados chegarem', () => {
    loaded.value = null;
    render(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI' }} />);
    expect(screen.getByText('Carregando mapa...')).toBeTruthy();
  });

  it('lead sem localização não mostra mapa', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{}} />);
    expect(screen.getByText(/Sem cidade ou estado/)).toBeTruthy();
    expect(screen.queryByTestId('map')).toBeNull();
  });

  it('desenha um estado quando a capital é do próprio estado', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI' }} />);

    const ufs = screen.getAllByTestId('geojson').map((n) => n.getAttribute('data-ufs'));
    expect(ufs).toEqual(['PI']);
    expect(screen.getByText(/Picos\/PI fica a \d+ km de Teresina/)).toBeTruthy();
    // Mesmo com um estado só, a linha até a capital tem de aparecer.
    expect(screen.getByTestId('polyline')).toBeTruthy();
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
  });

  it('desenha dois estados quando a referência é de outro', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Santana do Araguaia', state: 'PA' }} />);

    // Vizinho primeiro (fica por baixo), depois o estado do lead.
    expect(screen.getAllByTestId('geojson').map((n) => n.getAttribute('data-ufs'))).toEqual(['TO', 'PA']);
    expect(screen.getByTestId('polyline')).toBeTruthy();
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
  });

  it('lead na capital não ganha linha nem marcador de destino', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Teresina', state: 'PI' }} />);

    expect(screen.queryByTestId('polyline')).toBeNull();
    expect(screen.getAllByTestId('marker')).toHaveLength(1);
    expect(screen.getByText('Teresina/PI é a capital do estado.')).toBeTruthy();
  });

  it('lista as referências mais próximas com a vencedora em primeiro', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI' }} />);

    expect(screen.getByText('Referências mais próximas')).toBeTruthy();
    expect(screen.getByText('Teresina/PI')).toBeTruthy();
  });

  it('mostra a origem da posição usada', () => {
    loaded.value = geo;
    const { rerender } = render(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI' }} />);
    expect(screen.getByText('Centro do município')).toBeTruthy();

    rerender(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI', lead_lat: -7.05, lead_lng: -41.52 }} />);
    expect(screen.getByText('Coordenada do lead')).toBeTruthy();
  });

  it('destaca cadastro inconsistente em vez de escolher sozinho', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Colíder', state: 'MA' }} />);

    expect(screen.getByText(/"Colíder" não existe em MA — consta em MT/)).toBeTruthy();
  });

  it('explica quando a cidade é bairro ou abreviação', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Botafogo', state: 'RJ' }} />);

    expect(screen.getByText(/"Botafogo" não é um município reconhecido/)).toBeTruthy();
    expect(screen.getAllByTestId('geojson').map((n) => n.getAttribute('data-ufs'))).toEqual(['RJ']);
  });

  it('prefere os campos de visita, que são os editados nesta aba', () => {
    loaded.value = geo;
    render(
      <LeadLocationPanel
        lead={{ city: 'Teresina', state: 'PI', visit_city: 'Picos', visit_state: 'PI' }}
      />,
    );

    expect(screen.getByText(/Picos\/PI fica a/)).toBeTruthy();
  });

  it('preenche o município quando o IBGE tem a malha', async () => {
    loaded.value = geo;
    const { fetchMunicipalityShape } = await import('@/lib/geo/ibgeMalhas');
    (fetchMunicipalityShape as Mock).mockResolvedValueOnce({
      bbox: [-42, -8, -41, -7],
      rings: [[[-42, -7], [-41, -7], [-41, -8], [-42, -7]]],
    });

    render(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI' }} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('geojson')).toHaveLength(2);
    });
  });

  it('deixa claro que a distância é em linha reta', () => {
    loaded.value = geo;
    render(<LeadLocationPanel lead={{ city: 'Picos', state: 'PI' }} />);
    expect(screen.getByText(/Distâncias em linha reta/)).toBeTruthy();
  });
});
