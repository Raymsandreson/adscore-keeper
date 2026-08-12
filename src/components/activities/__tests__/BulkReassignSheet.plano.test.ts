import { describe, it, expect } from 'vitest';
import { montarPlano } from '../BulkReassignSheet';
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
