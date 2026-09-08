/**
 * Fixtures copiadas de linhas reais do `lead_activity_audit_log` (Externo,
 * consultadas em 08/09/2026) — inclusive a atividade 07252a98, que passou por
 * quatro mãos entre 24/08 e 03/09/2026.
 *
 * Datas com `-03:00` de propósito: o vitest.config fixa TZ em America/Sao_Paulo.
 */
import { describe, it, expect } from 'vitest';
import {
  actorText,
  auditCoverageNotice,
  buildActivityHistory,
  describeActivityAuthor,
  describeAuditRow,
  type ActivityAuditRow,
} from '@/lib/activityHistory';

const row = (over: Partial<ActivityAuditRow>): ActivityAuditRow => ({
  id: 'evt-1',
  action: 'update',
  actor_id: '81fc8558-7b52-4a24-9871-73958472fb9f',
  actor_name: 'Gisele Borges dos Santos',
  actor_kind: 'user',
  activity_title: 'Falar com o cliente',
  old_status: 'pendente',
  new_status: 'pendente',
  changes: {},
  created_at: '2026-09-01T10:50:36-03:00',
  ...over,
});

describe('describeAuditRow', () => {
  it('descreve a criação da atividade', () => {
    const e = describeAuditRow(row({ action: 'insert', old_status: null, new_status: 'pendente', changes: null }));
    expect(e.kind).toBe('created');
    expect(e.text).toBe('Atividade criada');
    expect(e.status).toBe('pendente');
  });

  it('descreve o repasse com quem entregou, quem recebeu e a situação do momento', () => {
    const e = describeAuditRow(row({
      changes: {
        assigned_to_old: 'aaa', assigned_to_new: 'bbb',
        assigned_to_old_name: 'Luana Barros', assigned_to_new_name: 'Gisele Borges dos Santos',
      },
    }));
    expect(e.kind).toBe('handoff');
    expect(e.text).toBe('Passou de Luana Barros para Gisele Borges dos Santos');
    expect(e.from).toBe('Luana Barros');
    expect(e.to).toBe('Gisele Borges dos Santos');
    expect(e.status).toBe('pendente');
    expect(e.actor).toBe('Gisele Borges dos Santos');
  });

  it('registra quando a atividade ganhou dono sem ter um antes', () => {
    const e = describeAuditRow(row({
      changes: { assigned_to_old: null, assigned_to_new: 'bbb', assigned_to_new_name: 'Jose Francisco Campos de Oliveira' },
    }));
    expect(e.text).toBe('Passou a ser de Jose Francisco Campos de Oliveira');
  });

  it('registra quando a atividade ficou SEM responsável', () => {
    const e = describeAuditRow(row({
      changes: { assigned_to_old: 'aaa', assigned_to_new: null, assigned_to_old_name: 'Luana Barros' },
    }));
    expect(e.text).toBe('Saiu de Luana Barros e ficou sem responsável');
    expect(e.to).toBeNull();
  });

  it('resolve o nome do responsável pelo uuid quando o audit não guardou o nome', () => {
    const e = describeAuditRow(
      row({ changes: { assigned_to_old: 'ext-1', assigned_to_new: 'ext-2' } }),
      (id) => (id === 'ext-1' ? 'Luana Barros' : id === 'ext-2' ? 'José Francisco' : null),
    );
    expect(e.text).toBe('Passou de Luana Barros para José Francisco');
  });

  it('descreve mudança de situação', () => {
    const e = describeAuditRow(row({
      old_status: 'pendente', new_status: 'concluida',
      changes: { status_old: 'pendente', status_new: 'concluida' },
    }));
    expect(e.kind).toBe('status');
    expect(e.text).toBe('Situação: Pendente → Concluída');
  });

  it('não some com o evento quando o trigger não registrou qual campo mudou', () => {
    // 62% dos updates chegam com changes vazio (o trigger só compara status,
    // assunto, responsável e co-assessores).
    const e = describeAuditRow(row({ changes: {} }));
    expect(e.kind).toBe('edited');
    expect(e.text).toBe('Atividade editada');
    expect(e.actor).toBe('Gisele Borges dos Santos');
  });

  it('separa rotina de servidor (sem actor_id) de sessão sem identificação', () => {
    const rotina = describeAuditRow(row({ actor_id: null, actor_name: null, actor_kind: 'system' }));
    expect(rotina.actorKind).toBe('routine');
    expect(actorText(rotina.actor, rotina.actorKind)).toBe('rotina do sistema');

    const anonima = describeAuditRow(row({
      actor_id: 'e3642889-05e4-4bea-9e6e-2d7916599866', actor_name: null, actor_kind: 'system',
    }));
    expect(anonima.actorKind).toBe('unidentified');
    expect(actorText(anonima.actor, anonima.actorKind)).toBe('sem identificação');
  });

  it('descreve exclusão e restauração', () => {
    expect(describeAuditRow(row({ action: 'soft_delete' })).kind).toBe('deleted');
    expect(describeAuditRow(row({ action: 'restore' })).text).toBe('Atividade restaurada');
  });
});

describe('buildActivityHistory', () => {
  it('devolve a cadeia de repasses em ordem cronológica', () => {
    const eventos = buildActivityHistory([
      row({ id: '3', created_at: '2026-09-01T10:50:36-03:00', changes: { assigned_to_old_name: 'Jose Francisco Campos de Oliveira', assigned_to_new_name: 'Gisele Borges dos Santos', assigned_to_new: 'b' } }),
      row({ id: '1', created_at: '2026-08-24T12:15:38-03:00', action: 'insert', changes: null }),
      row({ id: '2', created_at: '2026-08-25T16:15:01-03:00', changes: { assigned_to_old_name: 'Luana Barros', assigned_to_new_name: 'Jose Francisco Campos de Oliveira', assigned_to_new: 'a' } }),
    ]);
    expect(eventos.map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(eventos.map((e) => e.kind)).toEqual(['created', 'handoff', 'handoff']);
    expect(eventos[2].text).toBe('Passou de Jose Francisco Campos de Oliveira para Gisele Borges dos Santos');
  });
});

describe('describeActivityAuthor', () => {
  it('diz qual robô criou, em vez de traço', () => {
    const a = describeActivityAuthor({ action_source: 'system', action_source_detail: 'Robô do INSS', created_by: null });
    expect(a).toEqual({ label: 'Robô do INSS', robot: true, known: true });
  });

  it('marca a IA quando o carimbo é created_by_ai', () => {
    const a = describeActivityAuthor({ created_by_ai: true, action_source: 'dom-rascunho', created_by: null });
    expect(a.robot).toBe(true);
    expect(a.label).toBe('IA');
  });

  it('mostra a pessoa quando o nome foi resolvido', () => {
    const a = describeActivityAuthor({ action_source: 'manual', created_by: 'ext-1' }, 'Luana Barros');
    expect(a).toEqual({ label: 'Luana Barros', robot: false, known: true });
  });

  it('não inventa autor quando o banco não registrou nenhum', () => {
    const a = describeActivityAuthor({ action_source: 'manual', created_by: null }, null);
    expect(a).toEqual({ label: 'autor não registrado', robot: false, known: false });
  });
});

describe('auditCoverageNotice', () => {
  it('avisa que atividade anterior a 18/07/2026 não tem histórico gravado', () => {
    const nota = auditCoverageNotice('2026-06-10T09:00:00-03:00', { hasHandoff: false });
    expect(nota).toContain('18/07/2026');
  });

  it('avisa que repasse anterior a 21/08/2026 não foi registrado', () => {
    const nota = auditCoverageNotice('2026-08-01T09:00:00-03:00', { hasHandoff: false });
    expect(nota).toContain('21/08/2026');
  });

  it('não avisa nada quando já houve repasse registrado', () => {
    expect(auditCoverageNotice('2026-08-01T09:00:00-03:00', { hasHandoff: true })).toBeNull();
  });

  it('não avisa nada para atividade criada depois do audit completo', () => {
    expect(auditCoverageNotice('2026-09-01T09:00:00-03:00', { hasHandoff: false })).toBeNull();
  });
});
