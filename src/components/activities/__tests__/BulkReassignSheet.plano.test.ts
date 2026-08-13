import { describe, it, expect } from 'vitest';
import { montarPlano, resumoCarga, diaDaAtividade } from '../BulkReassignSheet';
import type { LeadActivity } from '@/hooks/useLeadActivities';

const DEST = 'dest-uuid';
const OUTRO = 'outro-uuid';

const atv = (over: Partial<LeadActivity>): LeadActivity => ({
  id: 'a1',
  lead_id: 'lead-1',
  lead_name: 'Lead 1',
  title: 'Ligar para o cliente',
  description: null,
  activity_type: 'tarefa',
  status: 'pendente',
  priority: 'normal',
  assigned_to: OUTRO,
  assigned_to_name: 'Outro',
  deadline: null,
  notification_date: null,
  completed_at: null,
  completed_by: null,
  completed_by_name: null,
  notes: null,
  what_was_done: null,
  next_steps: null,
  current_status_notes: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  contact_id: null,
  contact_name: null,
  matrix_quadrant: null,
  case_id: null,
  case_title: null,
  process_id: null,
  process_title: null,
  is_system: null,
  ...over,
});

describe('montarPlano — pré-checagem do índice dedup', () => {
  it('move o caso simples', () => {
    const p = montarPlano([atv({})], DEST, new Set());
    expect(p.mover.map(a => a.id)).toEqual(['a1']);
    expect(p.puladas).toHaveLength(0);
  });

  it('pula quando o destino já tem pendente igual (colisão externa)', () => {
    const ocupadas = new Set(['lead-1|ligar para o cliente|tarefa']);
    const p = montarPlano([atv({})], DEST, ocupadas, 'Fulana');
    expect(p.mover).toHaveLength(0);
    expect(p.puladas[0].motivo).toContain('Fulana');
  });

  it('normaliza título como o índice: lower(btrim(title))', () => {
    const ocupadas = new Set(['lead-1|ligar para o cliente|tarefa']);
    const p = montarPlano([atv({ title: '  LIGAR Para O Cliente ' })], DEST, ocupadas);
    expect(p.mover).toHaveLength(0);
    expect(p.puladas).toHaveLength(1);
  });

  it('não confunde leads nem tipos diferentes', () => {
    const ocupadas = new Set(['lead-1|ligar para o cliente|tarefa']);
    const p = montarPlano(
      [atv({ id: 'outro-lead', lead_id: 'lead-2' }), atv({ id: 'outro-tipo', activity_type: 'prazo' })],
      DEST,
      ocupadas,
    );
    expect(p.mover.map(a => a.id).sort()).toEqual(['outro-lead', 'outro-tipo']);
  });

  it('duas selecionadas iguais: fica a mais antiga, a outra é pulada', () => {
    const p = montarPlano(
      [
        atv({ id: 'nova', created_at: '2026-02-01T00:00:00Z' }),
        atv({ id: 'antiga', created_at: '2026-01-01T00:00:00Z' }),
      ],
      DEST,
      new Set(),
    );
    expect(p.mover.map(a => a.id)).toEqual(['antiga']);
    expect(p.puladas.map(x => x.a.id)).toEqual(['nova']);
  });

  it('em_andamento e atividade sem lead não entram no índice — vão sempre', () => {
    const ocupadas = new Set(['lead-1|ligar para o cliente|tarefa']);
    const p = montarPlano(
      [
        atv({ id: 'andamento', status: 'em_andamento' }),
        atv({ id: 'sem-lead', lead_id: null }),
      ],
      DEST,
      ocupadas,
    );
    expect(p.mover.map(a => a.id).sort()).toEqual(['andamento', 'sem-lead']);
    expect(p.puladas).toHaveLength(0);
  });

  it('concluída fica de fora (registra quem executou)', () => {
    const p = montarPlano([atv({ id: 'feita', status: 'concluida' })], DEST, new Set());
    expect(p.mover).toHaveLength(0);
    expect(p.concluidas.map(a => a.id)).toEqual(['feita']);
  });

  it('a que já é do destino não vira update nem colisão consigo mesma', () => {
    const p = montarPlano([atv({ id: 'ja-dele', assigned_to: DEST })], DEST, new Set());
    expect(p.mover).toHaveLength(0);
    expect(p.puladas).toHaveLength(0);
    expect(p.jaSao.map(a => a.id)).toEqual(['ja-dele']);
  });
});

describe('diaDaAtividade', () => {
  it('deadline manda, notification_date é reserva', () => {
    expect(diaDaAtividade({ deadline: '2026-08-20', notification_date: '2026-08-10' })).toBe('2026-08-20');
    expect(diaDaAtividade({ deadline: null, notification_date: '2026-08-10' })).toBe('2026-08-10');
    expect(diaDaAtividade({ deadline: null, notification_date: null })).toBeNull();
  });

  it('corta datetime legado sem deslocar o dia por fuso', () => {
    expect(diaDaAtividade({ deadline: '2026-08-20T12:00:00.000Z', notification_date: null })).toBe('2026-08-20');
  });
});

describe('resumoCarga — quanto o destino fica com no dia', () => {
  const carga = new Map([['2026-08-13', 4], ['2026-08-20', 1]]);

  it('modo manter: uma linha por dia envolvido, somando à carga existente', () => {
    const linhas = resumoCarga(
      [
        atv({ id: 'a', deadline: '2026-08-20' }),
        atv({ id: 'b', deadline: '2026-08-13' }),
        atv({ id: 'c', deadline: '2026-08-13' }),
      ],
      carga, 'manter', null,
    );
    expect(linhas).toEqual([
      { dia: '2026-08-13', jaTem: 4, entram: 2 },
      { dia: '2026-08-20', jaTem: 1, entram: 1 },
    ]);
  });

  it('modo hoje/outro: tudo cai num dia só', () => {
    const linhas = resumoCarga(
      [atv({ id: 'a', deadline: '2026-08-20' }), atv({ id: 'b', deadline: null })],
      carga, 'hoje', '2026-08-13',
    );
    expect(linhas).toEqual([{ dia: '2026-08-13', jaTem: 4, entram: 2 }]);
  });

  it('dia sem carga registrada começa em zero', () => {
    const linhas = resumoCarga([atv({ deadline: '2026-09-01' })], carga, 'manter', null);
    expect(linhas).toEqual([{ dia: '2026-09-01', jaTem: 0, entram: 1 }]);
  });

  it('sem data fica em linha própria, no fim e sem carga', () => {
    const linhas = resumoCarga(
      [atv({ id: 'a', deadline: null, notification_date: null }), atv({ id: 'b', deadline: '2026-08-13' })],
      carga, 'manter', null,
    );
    expect(linhas.map(l => l.dia)).toEqual(['2026-08-13', null]);
    expect(linhas[1]).toEqual({ dia: null, jaTem: 0, entram: 1 });
  });
});
