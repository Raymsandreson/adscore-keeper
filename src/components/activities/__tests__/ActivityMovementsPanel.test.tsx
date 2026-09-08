/**
 * A aba Histórico da atividade passa a mostrar por quantas mãos ela passou.
 *
 * As linhas do teste são cópia fiel do `lead_activity_audit_log` da atividade
 * 07252a98 (Externo, lido em 08/09/2026): nasceu por rotina, ganhou dono, e
 * depois circulou entre José, Luana, Gisele e Vanessa. Antes disso a ficha não
 * mostrava nada disso — a tabela era só escrita, nenhuma tela lia.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- o fake client do Supabase é um Proxy encadeável; tipá-lo aqui não acrescenta segurança ao teste. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { fakeClient, DATA } = vi.hoisted(() => {
  const DATA: { audit: any[]; profiles: any[] } = { audit: [], profiles: [] };
  const chain = (table: string) => {
    const resultado = () => ({
      data: table === 'lead_activity_audit_log' ? DATA.audit : DATA.profiles,
      error: null,
    });
    const proxy: any = new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return (ok: any, no: any) => Promise.resolve(resultado()).then(ok, no);
        if (prop === 'catch') return (no: any) => Promise.resolve(resultado()).catch(no);
        if (prop === 'finally') return (fn: any) => Promise.resolve(resultado()).finally(fn);
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };
  const fakeClient = { from: (table: string) => chain(table) };
  return { fakeClient, DATA };
});

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/integrations/supabase', () => ({
  db: fakeClient,
  externalSupabase: fakeClient,
  authClient: fakeClient,
  supabase: fakeClient,
  ensureExternalSession: async () => {},
}));

import { ActivityHandoffSummary, ActivityMovementsPanel } from '../ActivityMovementsPanel';

const evento = (over: Record<string, unknown>) => ({
  id: String(over.id),
  action: 'update',
  actor_id: null,
  actor_name: null,
  actor_kind: 'system',
  activity_title: 'AGENDAMENTO DE PERÍCIA',
  old_status: 'pendente',
  new_status: 'pendente',
  changes: {},
  ...over,
});

const CADEIA_REAL = [
  evento({ id: '1', action: 'insert', old_status: null, changes: null, created_at: '2026-08-24T12:15:38-03:00' }),
  evento({
    id: '2', created_at: '2026-08-25T15:06:25-03:00',
    changes: { assigned_to_old_name: 'Jose Francisco Campos de Oliveira', assigned_to_new: 'ext-luana', assigned_to_new_name: 'Luana Barros' },
  }),
  evento({
    id: '3', created_at: '2026-09-01T10:50:36-03:00', actor_id: 'ext-keliane', actor_name: 'Keliane Sousa Amorim Araújo', actor_kind: 'user',
    changes: { assigned_to_old_name: 'Luana Barros', assigned_to_new: 'ext-gisele', assigned_to_new_name: 'Gisele Borges dos Santos' },
  }),
  evento({
    id: '4', created_at: '2026-09-03T14:25:51-03:00', actor_id: 'ext-vanessa', actor_name: 'Vanessa Miranda Macêdo', actor_kind: 'user',
    old_status: 'pendente', new_status: 'concluida',
    changes: { status_old: 'pendente', status_new: 'concluida' },
  }),
];

describe('ActivityMovementsPanel', () => {
  it('mostra a cadeia de repasses com data, quem entregou e quem recebeu', async () => {
    DATA.audit = CADEIA_REAL;
    DATA.profiles = [];
    render(<ActivityMovementsPanel activityId="07252a98" activityCreatedAt="2026-08-24T12:15:38-03:00" />);

    expect(await screen.findByText('Atividade criada')).toBeInTheDocument();
    expect(screen.getByText('Passou de Jose Francisco Campos de Oliveira para Luana Barros')).toBeInTheDocument();
    expect(screen.getByText('Passou de Luana Barros para Gisele Borges dos Santos')).toBeInTheDocument();
    expect(screen.getByText('Situação: Pendente → Concluída')).toBeInTheDocument();
    // Data e autor do repasse ficam na mesma linha do evento.
    expect(screen.getByText(/01\/09\/2026 às \d{2}:50/)).toBeInTheDocument();
    expect(screen.getByText('por Keliane Sousa Amorim Araújo')).toBeInTheDocument();
    // 2 repasses, contados no cabeçalho.
    expect(screen.getByText('2 repasses')).toBeInTheDocument();
  });

  it('separa rotina do sistema de alteração sem usuário identificado', async () => {
    DATA.audit = [
      evento({ id: '1', action: 'insert', changes: null, created_at: '2026-09-01T09:00:00-03:00' }),
      evento({ id: '2', actor_id: 'anon-uuid', created_at: '2026-09-01T09:10:00-03:00' }),
    ];
    render(<ActivityMovementsPanel activityId="a1" activityCreatedAt="2026-09-01T09:00:00-03:00" />);

    expect(await screen.findByText('por rotina do sistema')).toBeInTheDocument();
    expect(screen.getByText('por sem identificação')).toBeInTheDocument();
  });

  it('avisa quando a atividade é anterior ao registro de repasses', async () => {
    DATA.audit = [evento({ id: '1', action: 'insert', changes: null, created_at: '2026-08-01T09:00:00-03:00' })];
    render(<ActivityMovementsPanel activityId="a2" activityCreatedAt="2026-08-01T09:00:00-03:00" />);

    expect(await screen.findByText(/21\/08\/2026/)).toBeInTheDocument();
  });

  it('não inventa histórico quando não há evento gravado', async () => {
    DATA.audit = [];
    render(<ActivityMovementsPanel activityId="a3" activityCreatedAt="2026-09-05T09:00:00-03:00" />);

    expect(await screen.findByText('Nenhuma movimentação registrada para esta atividade.')).toBeInTheDocument();
  });
});

describe('ActivityHandoffSummary (rodapé da ficha)', () => {
  it('mostra a cadeia de responsáveis junto de "Criado por"', async () => {
    DATA.audit = CADEIA_REAL;
    DATA.profiles = [];
    render(<ActivityHandoffSummary activityId="07252a98" />);

    expect(await screen.findByText('Repassada 2 vezes:')).toBeInTheDocument();
    expect(screen.getByText('Jose Francisco Campos de Oliveira')).toBeInTheDocument();
    expect(screen.getAllByText('Luana Barros').length).toBeGreaterThan(0);
    expect(screen.getByText('Gisele Borges dos Santos')).toBeInTheDocument();
    expect(screen.getByText('por Keliane Sousa Amorim Araújo')).toBeInTheDocument();
  });

  it('não desenha nada quando a atividade nunca foi repassada', async () => {
    DATA.audit = [evento({ id: '1', action: 'insert', changes: null, created_at: '2026-09-05T09:00:00-03:00' })];
    render(
      <div>
        <div data-testid="resumo">
          <ActivityHandoffSummary activityId="a4" />
        </div>
        {/* O painel ao lado prova que o carregamento terminou — sem ele, o
            resumo vazio passaria só por ainda estar em loading. */}
        <ActivityMovementsPanel activityId="a4" activityCreatedAt="2026-09-05T09:00:00-03:00" />
      </div>,
    );

    expect(await screen.findByText('Atividade criada')).toBeInTheDocument();
    expect(screen.getByTestId('resumo').textContent).toBe('');
  });
});
