-- =============================================================================
-- Escavador passa a rodar uma vez por dia, à meia-noite (decisão do usuário).
-- Substitui o agendamento de 10 em 10 minutos o dia inteiro.
--
-- FUSO — a pegadinha: o servidor roda em UTC. '0 0 * * *' colocaria a varredura
-- às 21h do dia anterior em Brasília, em pleno expediente, que é justamente o
-- horário que se quer evitar. Meia-noite BRT = 03:00 UTC.
--
-- DOIS CRONS, e não um, porque o ciclo do Escavador não fecha numa tacada:
--
--   jm-esc-reabrir  03:00 UTC (00:00 BRT)
--     devolve todos para A_ENVIAR. É ESTE que define o custo — cada execução
--     vale uma varredura completa: 329 x R$ 0,20 = R$ 65,80 por noite.
--
--   jm-esc-rotina   */10 das 03:00 às 08:50 UTC (00h–05h50 BRT)
--     dispara em lotes, confirma o que voltou, colhe os documentos. Roda de
--     graça: só gasta enquanto houver A_ENVIAR e para sozinho ao esvaziar.
--     Fora dessa janela não roda — o dia de trabalho não é afetado.
--
-- Por que o escoamento precisa de várias execuções e não de um disparo único:
-- a resposta do 'solicitar' volta assíncrona, e a confirmação tem que ler
-- net._http_response antes de expirar (~6h). Um disparo de 329 às 00h não
-- teria quem confirmasse. 36 execuções x lote 15 = 540 slots, folga sobre 329.
--
-- CUSTO DESTE AGENDAMENTO: ~R$ 1.974/mês. Com o saldo de R$ 910,69 de
-- 11/08/2026, isso dura cerca de 14 dias. Registrado aqui porque um cron que
-- gasta não avisa quando o saldo acaba — ele só para de trazer dado, e as
-- solicitações passam a voltar BLOQUEADO_SALDO em silêncio.
--
-- O DataJud continua rodando de 30 em 30 minutos a custo zero. Não é
-- redundante: é a rede que segura o acompanhamento se o saldo do Escavador
-- acabar — com 8+ dias de atraso, mas sem buraco.
--
-- REVERSÃO: select cron.unschedule('jm-esc-reabrir'), cron.unschedule('jm-esc-rotina');
-- =============================================================================

create or replace function public.jm_esc_reabrir()
returns integer language plpgsql as $function$
declare v_n integer;
begin
  with r as (
    update public.jm_esc_solicitacoes
       set status = 'A_ENVIAR', concluido_em = null, motivo_erro = null
     where status in ('SUCESSO', 'ERRO', 'BLOQUEADO_SALDO')
    returning 1
  )
  select count(*) into v_n from r;

  -- Processo novo entra na fila junto.
  insert into public.jm_esc_solicitacoes (processo_cnj, status, criado_em)
  select p.processo_cnj, 'A_ENVIAR', now()
  from public.jm_processos p
  where p.processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
    and not exists (select 1 from public.jm_esc_solicitacoes s
                     where s.processo_cnj = p.processo_cnj);
  return v_n;
end $function$;

comment on function public.jm_esc_reabrir() is
  'Devolve a fila do Escavador para A_ENVIAR. E ESTE cron que define o custo: cada execucao vale uma varredura completa (329 x R$ 0,20 = R$ 65,80).';

select cron.unschedule('jm-esc-rotina');
select cron.schedule('jm-esc-reabrir', '0 3 * * *',      $$select public.jm_esc_reabrir()$$);
select cron.schedule('jm-esc-rotina',  '*/10 3-8 * * *', $$select public.jm_esc_rotina(15)$$);
