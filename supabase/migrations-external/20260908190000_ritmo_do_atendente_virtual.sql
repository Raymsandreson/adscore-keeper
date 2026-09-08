-- =============================================================================
-- O atendente virtual responde no ritmo de gente: devagar ao chegar, rápido no
-- meio da conversa.
-- Aplicar no Supabase EXTERNO (WhatsJUD, kmedldlepwiityjsdahz).
--
-- O PROBLEMA
-- ----------
-- O atraso do modo automático era uma constante de código: cinco minutos, na
-- primeira mensagem e na décima. Duas coisas erradas nisso.
--
-- 1. É relógio, não pessoa. Quem chega numa conversa parada demora — estava em
--    outra coisa, precisa ler, lembrar do caso. Quem JÁ ESTÁ na conversa
--    responde rápido, o celular está na mão. Responder sempre com o mesmo
--    intervalo exato é a assinatura de uma máquina.
--
-- 2. O número não mandava no relógio. O rascunho só nasce na rodada do
--    `dom_rascunho_tick`, que rodava de 5 em 5 minutos: isso somava de 0 a 5
--    minutos ANTES de o atraso começar a contar. O cliente sentia de 5 a 11
--    minutos (média ~8), e não os 5 escritos no código. Pior: dentro desse
--    ruído, a diferença entre "3 min" e "2 min" some — configurar um ritmo que
--    a máquina não consegue cumprir é escrever número decorativo.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   1. Três colunas de configuração em `wjia_command_shortcuts`, ao lado das
--      irmãs que já moram lá (`human_reply_pause_minutes`,
--      `response_delay_seconds`). Editáveis na tela de configuração do agente.
--   2. O `dom_rascunho_tick` passa de 5 em 5 para 2 em 2 minutos.
--
-- POR QUE 2 EM 2, E NÃO 1 EM 1
-- -----------------------------
-- Medido nas 24h anteriores a 08/09/2026, em 297 execuções da `dom-rascunho`:
-- mediana 4,6s, p90 11,4s, pior caso 38,8s. Um cron de minuto em minuto deixaria
-- 21s de margem no pior caso — rodadas encostando uma na outra em dia ruim. De 2
-- em 2 a margem é de 3x, e o cliente passa a sentir de 3 a 6 minutos (média
-- ~4,5) em vez de 5 a 11.
--
-- O CUSTO NÃO É 5x. As invocações da função vão de 288 para 720 por dia, mas a
-- função pula todo grupo cuja última mensagem já foi decidida ANTES de chamar
-- qualquer modelo: rodada em grupo parado é só leitura de banco. O número de
-- chamadas de modelo — a única linha cara — não muda, porque ele depende de
-- quantas mensagens novas chegaram, não de quantas vezes olhamos.
--
-- ROLLBACK
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'dom_rascunho_tick'),
--     schedule := '*/5 * * * *');
--   alter table public.wjia_command_shortcuts
--     drop column if exists auto_delay_first_minutes,
--     drop column if exists auto_delay_next_minutes,
--     drop column if exists auto_conversation_window_minutes;
--   (a `dom-rascunho` cai nos padrões do código — 3 / 2 / 180 — se as colunas
--    sumirem do select? NÃO: o select nomeia as colunas e falharia. Reverter o
--    schema exige redeployar a versão anterior da função. Por isso o rollback
--    de verdade, para desligar o comportamento, é pôr os dois atrasos no mesmo
--    número: `update wjia_command_shortcuts set auto_delay_first_minutes = 5,
--    auto_delay_next_minutes = 5 where id = 'd6ad8eee-...'` — volta ao fixo de
--    cinco minutos sem tocar em código nem em schema, em menos de um minuto.)
-- =============================================================================

alter table public.wjia_command_shortcuts
  add column if not exists auto_delay_first_minutes         integer not null default 3,
  add column if not exists auto_delay_next_minutes          integer not null default 2,
  add column if not exists auto_conversation_window_minutes integer not null default 180;

comment on column public.wjia_command_shortcuts.auto_delay_first_minutes is
  'Modo automatico: minutos de espera na PRIMEIRA resposta de uma conversa parada. E a janela de revisao — silencio aprova.';
comment on column public.wjia_command_shortcuts.auto_delay_next_minutes is
  'Modo automatico: minutos de espera nas respostas seguintes, enquanto a conversa segue quente. Quem ja esta na conversa responde rapido.';
comment on column public.wjia_command_shortcuts.auto_conversation_window_minutes is
  'Quanto tempo depois da ultima fala do agente a conversa ainda conta como a mesma. Passou disso, a proxima volta ao atraso de chegada. Padrao 180 (3h).';

-- -----------------------------------------------------------------------------
-- O tick fica mais rápido.
--
-- `alter_job` por nome, e não `unschedule` + `schedule`: assim o comando (que
-- carrega a chave de chamada da função) não precisa ser reescrito aqui, e uma
-- chave a menos no repositório é uma chave a menos para vazar.
-- -----------------------------------------------------------------------------
select cron.alter_job(
  (select jobid from cron.job where jobname = 'dom_rascunho_tick'),
  schedule := '*/2 * * * *'
);
