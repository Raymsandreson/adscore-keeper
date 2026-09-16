import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CityContactsSuggestionDialog } from '@/components/leads/CityContactsSuggestionDialog';

// A busca é uma RPC do Externo; aqui interessa o que o card mostra da linha
// devolvida, não como ela é buscada.
const rows = vi.hoisted(() => ({ value: [] as any[] }));
vi.mock('@/integrations/supabase', () => ({
  ensureExternalSession: vi.fn(async () => {}),
  db: {
    rpc: vi.fn(async () => ({ data: rows.value, error: null })),
    from: vi.fn(() => ({ select: vi.fn(async () => ({ data: [] })) })),
  },
}));
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  ensureRemapCache: vi.fn(async () => {}),
  remapToCloudSync: (id: string) => id,
}));
vi.mock('@/lib/functionRouter', () => ({ cloudFunctions: { invoke: vi.fn() } }));
vi.mock('@/hooks/useContactClassifications', () => ({
  useContactClassifications: () => ({ classificationConfig: [] }),
}));
vi.mock('@/hooks/useProfilesList', () => ({ useProfilesList: () => [] }));
vi.mock('@/hooks/useContactsPendencies', () => ({
  useContactsPendencies: () => ({ byContact: {}, loading: false }),
}));
vi.mock('@/hooks/useContactsLinks', () => ({
  useContactsLinks: () => ({ byContact: {} }),
  EMPTY_CONTACT_LINKS: { leads: [], cases: [] },
}));
vi.mock('@/hooks/useKanbanBoards', () => ({ useKanbanBoards: () => ({ boards: [] }) }));

const BASE = {
  phone: '554599717808',
  instagram_username: null,
  classification: null,
  classifications: null,
  profession: null,
  complement: null,
};

function abrir() {
  render(
    <CityContactsSuggestionDialog
      trigger={{ city: 'Cascavel', state: 'PR' }}
      onClose={() => {}}
    />,
  );
}

describe('CityContactsSuggestionDialog — endereço no card', () => {
  it('mostra cidade/UF, bairro, rua e CEP de quem tem endereço completo', async () => {
    rows.value = [{
      ...BASE,
      id: 'c1',
      full_name: 'Luiz Antonio Dos Santos',
      city: 'Cascavel',
      state: 'PR',
      neighborhood: 'São Cristóvão',
      street: 'Rua dois',
      street_number: '61',
      cep: '85813106',
    }];
    abrir();
    await waitFor(() => {
      expect(
        screen.getByText('Cascavel/PR · São Cristóvão · Rua dois, 61 · 85813-106'),
      ).toBeInTheDocument();
    });
  });

  it('mostra a cidade e avisa o que falta quando o cadastro tem só cidade/UF', async () => {
    rows.value = [{
      ...BASE,
      id: 'c2',
      full_name: 'Jheniffer Aparecida dos Santos',
      city: 'Cascavel',
      state: 'PR',
      neighborhood: null,
      street: null,
      street_number: null,
      cep: null,
    }];
    abrir();
    await waitFor(() => expect(screen.getByText('Cascavel/PR')).toBeInTheDocument());
    expect(screen.getByText('· sem bairro e rua')).toBeInTheDocument();
  });

  it('mostra a cidade gravada mesmo quando difere da grafia da busca', async () => {
    rows.value = [{
      ...BASE,
      id: 'c3',
      full_name: 'José',
      city: 'Itapecuru-Mirim',
      state: 'MA',
      neighborhood: 'Centro',
      street: null,
      street_number: null,
      cep: null,
    }];
    abrir();
    await waitFor(() =>
      expect(screen.getByText('Itapecuru-Mirim/MA · Centro')).toBeInTheDocument(),
    );
  });
});
