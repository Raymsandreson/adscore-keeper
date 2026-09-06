-- =============================================================================
-- A fila do Escavador para de correr atrás do próprio rabo.
--
-- O DEFEITO
-- `jm_esc_rotina` roda a cada 20 min, nesta ordem:
--     destravar(2) → confirmar() → colher_docs() → disparar(15)
--
-- E o `destravar` decidia pelo carimbo errado:
--     where status = 'ENVIANDO'
--       and criado_em < now() - make_interval(hours => 2)
--
-- `criado_em` é quando a LINHA foi criada, não quando a consulta foi ENVIADA.
-- Uma linha criada em 17/08 é sempre "mais velha que 2 horas". Então:
--
--   1. destravar (roda PRIMEIRO) arranca a linha de ENVIANDO e devolve para
--      A_ENVIAR — mesmo tendo sido disparada 20 minutos antes;
--   2. confirmar não acha mais nada em ENVIANDO e fecha zero;
--   3. disparar pega as 15 de menor id, que são exatamente essas, e manda de
--      novo.
--
-- Vinte minutos depois, tudo igual. Quem devia destravar o que travou estava
-- desarmando o que acabou de sair, antes de alguém conferir se chegou.
--
-- MEDIDO EM 05/09/2026, 23h50:
--   15 linhas em ENVIANDO desde 17/08, todas com escavador_id nulo e
--   motivo_erro 'destravado: ENVIANDO sem confirmacao'
--   `jm_esc_rotina(0)` devolvia: destravadas=15 confirmadas=0 disparadas=0
--   487 linhas em A_ENVIAR, nenhuma andando. Último SUCESSO às 16:00.
--
-- E o `disparar` ordena por id. Como essas 15 têm os menores ids, elas
-- consumiam a fila inteira: as 403 enfileiradas em 05/09 (ids 599-1001) nunca
-- seriam alcançadas. Cabeça de fila entupida trava todo mundo atrás.
--
-- Custo do loop: zero. As 15 voltam 422 NUMERO_CNJ_INVALIDO com creditos null
-- — o Escavador não cobra por CNJ que ele nem aceita. Foi desperdício de
-- rodada, não de dinheiro.
--
-- O CONSERTO, EM DUAS PARTES
--
--   1. `enviado_em` — o carimbo certo. O `disparar` grava a hora do envio e o
--      `destravar` passa a comparar com ela. Uma linha disparada há 20 minutos
--      deixa de ser tratada como abandonada, e o `confirmar` ganha a chance de
--      fechar (as respostas ficam 30 min em net._http_response — a janela
--      passa a caber).
--
--   2. `tentativas` — o teto. Hoje uma linha que falha sempre volta para a
--      cabeça da fila e bloqueia todo mundo atrás dela, para sempre. Depois de
--      TETO_TENTATIVAS disparos sem confirmação ela vira ERRO e sai da frente.
--      Ficar tentando eternamente não é resiliência: é uma fila parada com
--      cara de fila andando.
--
-- POR QUE ISTO SOZINHO JÁ RESOLVE AS 15
-- Com o carimbo certo, elas são disparadas, o `confirmar` lê o 422 na rodada
-- seguinte e as marca ERRO — que é o que deveria ter acontecido em 17/08.
-- Saem da cabeça da fila por decisão, não por desistência.
--
-- ROLLBACK (menos de 1 minuto):
--   reaplicar 20260811163000_jm_esc_rotina.sql (jm_esc_disparar) e a versão
--   anterior de jm_esc_destravar. As colunas podem ficar: são aditivas e
--   ninguém mais lê.
-- =============================================================================

-- 1. Os dois campos que faltavam ---------------------------------------------
alter table public.jm_esc_solicitacoes
  add column if not exists enviado_em  timestamptz,
  add column if not exists tentativas  integer not null default 0;

comment on column public.jm_esc_solicitacoes.enviado_em is
  'Quando a consulta foi ENVIADA. O destravar mede por aqui, nao por criado_em: medir pela criacao da linha fazia toda linha antiga ser destravada 20 min depois de sair, antes de o confirmar poder fecha-la.';
comment on column public.jm_esc_solicitacoes.tentativas is
  'Quantos disparos ja foram feitos. Ao bater o teto a linha vira ERRO e sai da cabeca da fila, em vez de bloquear todo mundo atras.';

create index if not exists idx_jm_esc_fila
  on public.jm_esc_solicitacoes (status, id)
  where status = 'A_ENVIAR';

-- 2. Disparar grava a hora e conta a tentativa -------------------------------
create or replace function public.jm_esc_disparar(p_limit integer default 10)
returns integer
language plpgsql
as $function$
declare
  v_rec  record;
  v_n    int := 0;
  v_body jsonb;
  -- Três disparos sem confirmação bastam para separar tropeço de defeito.
  -- Com a janela de 2h do destravar, isso dá ~6h antes de desistir.
  c_teto constant int := 3;
begin
  for v_rec in
    select id, processo_cnj, modo
      from public.jm_esc_solicitacoes
     where status = 'A_ENVIAR'
       and tentativas < c_teto
     order by id
     limit p_limit
  loop
    v_body := case when v_rec.modo = 'AUTOS'
      then jsonb_build_object('autos',1,'utilizar_certificado',1,'ignorar_atualizados',1)
      else jsonb_build_object('documentos_publicos',1,'ignorar_atualizados',1)
    end;
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('acao','solicitar','cnj',v_rec.processo_cnj,'body',v_body),
      timeout_milliseconds := 30000);
    update public.jm_esc_solicitacoes
       set status     = 'ENVIANDO',
           enviado_em = now(),
           tentativas = tentativas + 1
     where id = v_rec.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

-- 3. Destravar mede pelo ENVIO, e desiste ao bater o teto --------------------
create or replace function public.jm_esc_destravar(p_horas integer default 2)
returns integer
language plpgsql
as $function$
declare
  v_n int;
  c_teto constant int := 3;
begin
  -- ENVIANDO é estado de trânsito: quem confirma lê net._http_response, que
  -- guarda 30 min. Se a rotina não rodar nessa janela (ou a resposta não
  -- casar), a linha ficaria ENVIANDO para sempre — jm_esc_reabrir() só pega
  -- SUCESSO/ERRO. Por isso o destravar existe.
  --
  -- O que mudou: `coalesce(enviado_em, criado_em)`. Antes media por criado_em,
  -- e linha velha era destravada 20 minutos depois de sair — o confirmar nunca
  -- pegava. `coalesce` cobre as linhas anteriores a esta migration, que não
  -- têm enviado_em.
  --
  -- E quem já tentou demais sai da fila em vez de voltar para a cabeça dela.
  with r as (
    update public.jm_esc_solicitacoes
       set status = case when tentativas >= c_teto then 'ERRO' else 'A_ENVIAR' end,
           modo   = case when tentativas >= c_teto then modo else 'PUBLICOS' end,
           motivo_erro = case
             when tentativas >= c_teto
             then format('desisti apos %s disparos sem confirmacao', tentativas)
             else coalesce(motivo_erro, 'destravado: ENVIANDO sem confirmacao')
           end,
           concluido_em = case when tentativas >= c_teto then now() else concluido_em end
     where status = 'ENVIANDO'
       and coalesce(enviado_em, criado_em) < now() - make_interval(hours => greatest(p_horas, 1))
    returning 1
  ) select count(*) into v_n from r;
  return v_n;
end $function$;
