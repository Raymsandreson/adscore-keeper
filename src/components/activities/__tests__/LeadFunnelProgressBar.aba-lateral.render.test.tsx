/**
 * Prova de tela: clicar na barra abre a ABA LATERAL com TODAS as fases do POP
 * numa lista só — e o recolhimento por nível funciona.
 *
 * O teste irmão (`LeadFunnelProgressBar.aba-lateral.test.ts`) tranca o desenho
 * do arquivo; este aqui monta o componente de verdade, com o banco mockado, e
 * confere o comportamento: as três fases aparecem juntas (sem "aba" por marco),
 * "Marcos" recolhe os passos e "Passos" traz de volta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const BOARD = {
  id: 'board-1',
  name: 'POP Previdenciário',
  board_type: 'workflow',
  stages: [
    { id: 'f1', name: 'Administrativo' },
    { id: 'f2', name: 'Judicial' },
    { id: 'f3', name: 'Execução' },
  ],
};

const INSTANCIAS = [
  {
    id: 'inst-1', lead_id: 'lead-1', board_id: 'board-1', stage_id: 'f1',
    checklist_template_id: 'tpl-1', is_completed: false, is_readonly: false,
    items: [
      { id: 'p1', label: 'Protocolar requerimento', checked: true },
      { id: 'p2', label: 'Acompanhar exigência', checked: false },
    ],
  },
  {
    id: 'inst-2', lead_id: 'lead-1', board_id: 'board-1', stage_id: 'f2',
    checklist_template_id: 'tpl-2', is_completed: false, is_readonly: false,
    items: [{ id: 'p3', label: 'Distribuir ação', checked: false }],
  },
];

// O POP de verdade (checklist_templates) precisa ter os mesmos passos: a barra
// sincroniza a instância com o template, e passo que não existe mais no POP some
// da lista (só fica o que já tinha sido marcado, como histórico).
const TEMPLATES = [
  { id: 'tpl-1', name: 'Requerimento', items: [
    { id: 'p1', label: 'Protocolar requerimento' },
    { id: 'p2', label: 'Acompanhar exigência' },
  ] },
  { id: 'tpl-2', name: 'Ação judicial', items: [
    { id: 'p3', label: 'Distribuir ação' },
  ] },
];

vi.mock('@/integrations/supabase/external-client', () => {
  const resultado = (tabela: string) => {
    if (tabela === 'kanban_boards') return { data: BOARD, error: null };
    if (tabela === 'leads') return { data: { status: 'f1', lead_status: 'open', board_id: 'outro', lead_name: 'Cliente X' }, error: null };
    if (tabela === 'checklist_stage_links') {
      return { data: [
        { stage_id: 'f1', checklist_template_id: 'tpl-1', display_order: 0 },
        { stage_id: 'f2', checklist_template_id: 'tpl-2', display_order: 0 },
      ], error: null };
    }
    if (tabela === 'checklist_templates') return { data: TEMPLATES, error: null };
    return { data: [], error: null };
  };
  const builder = (tabela: string) => {
    const alvo = resultado(tabela);
    const chain: any = new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'maybeSingle') return async () => (Array.isArray(alvo.data) ? { data: alvo.data[0] ?? null, error: null } : alvo);
        if (prop === 'single') return async () => alvo;
        if (prop === 'then') return (res: any) => Promise.resolve(alvo).then(res);
        return () => chain;
      },
      apply: () => chain,
    });
    return chain;
  };
  return {
    externalSupabase: {
      from: (tabela: string) => builder(tabela),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

vi.mock('@/hooks/useChecklists', () => ({
  useChecklists: () => ({
    createLeadInstances: vi.fn(async () => {}),
    fetchLeadInstances: vi.fn(async () => INSTANCIAS),
  }),
  CHECKLIST_TYPES: [{ value: 'documentos', label: 'Documentos', icon: '📄' }],
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'u1' } }) }));

// Sem régua de marcos: o POP administrativo cai no percentual por passos, que é
// o caminho que não depende de dado de processo.
vi.mock('@/hooks/useProcessoMarcos', () => ({
  useProcessoMarcos: () => ({ marcos: [], atual: null, cumpridos: 0, previstos: 0, percentual: null }),
  FONTE_LABEL: {},
}));

vi.mock('@/components/activities/PopCatchUpSheet', () => ({ PopCatchUpSheet: () => null }));

import { LeadFunnelProgressBar } from '../LeadFunnelProgressBar';

describe('LeadFunnelProgressBar: a aba lateral mostra o POP inteiro', () => {
  beforeEach(() => vi.clearAllMocks());

  it('abre no clique da barra com as três fases juntas e recolhe por nível', async () => {
    render(<LeadFunnelProgressBar leadId="lead-1" boardId="board-1" processId="proc-1" origemDoPop="processo" />);

    // A barra fica na atividade; os passos ainda não estão na tela.
    await waitFor(() => expect(screen.getByTitle(/Percentual por passos marcados/)).toBeTruthy());
    expect(screen.queryByText('Protocolar requerimento')).toBeNull();

    fireEvent.click(screen.getByTitle(/Percentual por passos marcados/));

    // TODAS as fases, empilhadas — não uma "aba" por marco. ("Administrativo"
    // sai duas vezes: no título da aba, que diz a fase atual, e na lista.)
    await waitFor(() => expect(screen.getAllByText('Administrativo').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('Judicial')).toBeTruthy();
    expect(screen.getByText('Execução')).toBeTruthy();
    // E os passos das DUAS fases que têm objetivo, ao mesmo tempo.
    expect(screen.getByText('Protocolar requerimento')).toBeTruthy();
    expect(screen.getByText('Distribuir ação')).toBeTruthy();

    // "Marcos": só as fases, passos recolhidos.
    fireEvent.click(screen.getByRole('button', { name: /Marcos/ }));
    await waitFor(() => expect(screen.queryByText('Protocolar requerimento')).toBeNull());
    expect(screen.getByText('Judicial')).toBeTruthy();

    // "Objetivos": objetivos à vista, passos ainda não.
    fireEvent.click(screen.getByRole('button', { name: /Objetivos/ }));
    await waitFor(() => expect(screen.getByText('Requerimento')).toBeTruthy());
    expect(screen.queryByText('Protocolar requerimento')).toBeNull();

    // "Passos": tudo de volta.
    fireEvent.click(screen.getByRole('button', { name: /^Passos$/ }));
    await waitFor(() => expect(screen.getByText('Protocolar requerimento')).toBeTruthy());
  });
});
