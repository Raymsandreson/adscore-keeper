-- =============================================================================
-- Régua do processo ADMINISTRATIVO (INSS). Decisão jurídica de 06/08/2026.
--
-- A régua judicial (12 estações, marco_ordem_canonica) NÃO serve aqui: o
-- administrativo não é uma fila que só anda para frente. No histórico, um
-- requerimento sai de "Concluída" e volta para "Pendente" 103×, para
-- "Exigência" 50×, para "Em Análise" 27×. A regra judicial de "maior ordem
-- vence" mostraria como concluído o que voltou atrás.
--
-- SOLUÇÃO: ancorar a régua no RESULTADO, não no status.
--   resultado (deferido/indeferido) é terminal e não regride;
--   current_status oscila e vira ALERTA lateral, não estação.
-- Medido: 21 requerimentos têm resultado e status regredido (indeferido com
-- status Exigência 10, Protocolado 6, Pendente 3, Em Análise 2). Pela régua
-- do resultado eles ficam corretamente no desfecho.
--
-- ESTAÇÕES (2, mais o desfecho tripartido):
--   1 protocolado — requerimento existe. Note que isto é atingido por 100%:
--     a tabela é alimentada pelo e-mail do INSS, então só enxerga o que já foi
--     protocolado. Onboarding ficou FORA da régua por decisão do usuário — é
--     responsabilidade do funil do lead, que já mede aquilo.
--   2 concedido | indeferido | encerrado
--       encerrado = Cancelada (37) ou arquivado_decurso (1): terminal, mas nem
--       concessão nem indeferimento. Não inventar desfecho que não houve.
--
-- ALERTAS (não são estação — são o que gera ação da equipe):
--   em_exigencia + dias_em_exigencia  — 268 requerimentos, o maior grupo
--   concluida_sem_resultado           — 16 casos em que o INSS encerrou e o
--                                       resultado não foi capturado. Buraco de
--                                       captura, não estado do requerimento.
--
-- NÃO cria tabela nem duplica dado: tudo é derivado de inss_admin_processes.
-- Sem sync, sem drift, sem backfill.
--
-- security_invoker = on: a view respeita o RLS de quem consulta. As policies de
-- inss_admin_processes foram corrigidas de TO public para TO authenticated em
-- 06/08/2026 (a chave anon lia os 839 requerimentos com cpf_segurado).
--
-- ROLLBACK: drop view public.inss_requerimento_status;
-- =============================================================================

create or replace view public.inss_requerimento_status
with (security_invoker = on) as
select
  i.id,
  i.requerimento_number,
  i.case_id,
  i.lead_id,
  i.benefit_type,
  i.servico,
  i.protocol_date,
  i.created_at,

  -- 'Em Análise' e 'Em análise' são o mesmo estado com caixa diferente (28 + 7).
  initcap(lower(trim(i.current_status))) as status_normalizado,

  case
    when i.resultado = 'deferido'   then 'concedido'
    when i.resultado = 'indeferido' then 'indeferido'
    when i.resultado is not null
      or lower(trim(i.current_status)) = 'cancelada' then 'encerrado'
    else 'protocolado'
  end as marco_atual,

  case
    when i.resultado is not null
      or lower(trim(i.current_status)) = 'cancelada' then 2
    else 1
  end::smallint as marco_ordem,

  (i.resultado is not null
     or lower(trim(i.current_status)) = 'cancelada') as tem_desfecho,

  -- Alerta 1: exigência pendente. exigencia_since é timestamptz.
  (lower(trim(i.current_status)) = 'exigência') as em_exigencia,
  case
    when lower(trim(i.current_status)) = 'exigência' and i.exigencia_since is not null
    then (current_date - i.exigencia_since::date)
  end as dias_em_exigencia,

  -- Alerta 2: INSS encerrou e não capturamos o resultado.
  (lower(trim(i.current_status)) = 'concluída' and i.resultado is null)
    as concluida_sem_resultado,

  i.resultado,
  i.despacho,
  i.last_email_at
from public.inss_admin_processes i
where i.deleted_at is null;

comment on view public.inss_requerimento_status is
  'Régua do processo administrativo INSS (06/08/2026). Ancorada no resultado, não no '
  'current_status — o status do INSS oscila e volta atrás, o resultado não. Estações: '
  '1 protocolado, 2 concedido|indeferido|encerrado. Exigência e "concluída sem resultado" '
  'são alertas, não estações. Derivada de inss_admin_processes, sem duplicar dado.';
