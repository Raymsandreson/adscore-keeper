-- =============================================================================
-- O MODO AUTOS VIRA OPT-IN — e a fila para de prender solicitação em ENVIANDO
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- INCIDENTE (21/08/2026, ~1h depois de aplicar 20260821170000):
-- A coluna `modo` nasceu com `default 'AUTOS'`, então as 465 linhas existentes
-- viraram AUTOS de uma vez. Só que quem reabre solicitação no dia a dia —
-- jm_esc_reabrir_por_cnj(), chamada pelo fluxo de push de e-mail no minuto :35 —
-- NÃO define modo: ela reabre e o modo antigo fica. Às 16:35 saíram 13 pedidos
-- de autos a 150 créditos (R$ 1,50) cada, R$ 19,50, todos fadados a falhar,
-- porque a autenticação por certificado não está passando (ver abaixo).
--
-- O modo caro não pode ser o default de nada. Agora:
--   default 'PUBLICOS' (R$ 0,20)
--   todas as linhas existentes normalizadas para PUBLICOS — era o que elas
--   realmente eram; o AUTOS nelas foi só efeito do default
--   AUTOS só por jm_esc_reabrir_autos(n), com limite obrigatório
--
-- COLISÃO DE NOME, corrigida junto: a jm_esc_reabrir(p_limit, p_modo) criada em
-- 20260821170000 sobrecarregava a jm_esc_reabrir() que já existia (varredura
-- completa). Com todos os parâmetros tendo default, `select jm_esc_reabrir()`
-- passava a ter duas candidatas — e a minha reabriria TUDO em modo AUTOS:
-- 445 x R$ 1,50 = R$ 667,50 num comando que sempre foi inofensivo. Removida.
--
-- ESTADO DO CERTIFICADO (por que AUTOS está desligado): dois testes reais, dois
-- tribunais, duas falhas de autenticação —
--   TRT-16  0016527-69.2021.5.16.0018 ... SECRET_ERROR  (7 min)
--   TRT-3   0011298-84.2026.5.03.0093 ... LOGIN_ERROR  (50 min)
-- O certificado 302 está válido até 10/07/2027 e tem 74 tribunais configurados,
-- os dois incluídos. Enquanto isso não for resolvido no painel do Escavador,
-- reabrir em AUTOS é só queimar crédito.
--
-- ENVIANDO PRESO PARA SEMPRE (bug antigo, agravado pelo incidente): quem
-- confirma lê net._http_response, que guarda 30 minutos. Se a rotina não rodar
-- nessa janela, a linha fica ENVIANDO e nenhuma reabertura pega — jm_esc_reabrir()
-- só olha SUCESSO/ERRO/BLOQUEADO_SALDO. Eram 9 linhas assim, algumas desde
-- 17/08, e viraram 22 com o lote das 16:35. jm_esc_destravar() devolve para a
-- fila em modo PUBLICOS o que passou de 2h em ENVIANDO, e jm_esc_rotina chama
-- isso antes de confirmar.
--
-- REVERSÃO:
--   alter table jm_esc_solicitacoes alter column modo set default 'AUTOS';
--   drop function public.jm_esc_reabrir_autos(integer);
--   drop function public.jm_esc_destravar(integer);
--   jm_esc_rotina volta ao corpo de 20260811163000.
-- =============================================================================

alter table public.jm_esc_solicitacoes alter column modo set default 'PUBLICOS';

comment on column public.jm_esc_solicitacoes.modo is
  'PUBLICOS (padrao) = acervo publico, R$ 0,20/processo. AUTOS = autos completos com certificado, R$ 1,50/processo — so por opt-in explicito via jm_esc_reabrir_autos(n).';

update public.jm_esc_solicitacoes set modo = 'PUBLICOS' where modo = 'AUTOS';

drop function if exists public.jm_esc_reabrir(integer, text);

create or replace function public.jm_esc_reabrir_autos(p_limit integer default 5)
returns integer language plpgsql as $function$
declare v_n int;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'jm_esc_reabrir_autos exige limite explicito: cada processo custa 150 creditos (R$ 1,50)';
  end if;
  with alvo as (
    select id from public.jm_esc_solicitacoes
    where status in ('SUCESSO','ERRO')
    order by coalesce(concluido_em, criado_em)
    limit p_limit
  ), upd as (
    update public.jm_esc_solicitacoes s
       set status='A_ENVIAR', modo='AUTOS', motivo_erro=null, concluido_em=null
      from alvo a where a.id = s.id returning 1
  ) select count(*) into v_n from upd;
  return v_n;
end $function$;

comment on function public.jm_esc_reabrir_autos(integer) is
  'Unica porta para o modo AUTOS (R$ 1,50/processo). Limite obrigatorio e sem default perigoso. jm_esc_reabrir() e jm_esc_reabrir_por_cnj() continuam reabrindo em PUBLICOS (R$ 0,20).';

create or replace function public.jm_esc_destravar(p_horas integer default 2)
returns integer language plpgsql as $function$
declare v_n int;
begin
  with r as (
    update public.jm_esc_solicitacoes
       set status = 'A_ENVIAR', modo = 'PUBLICOS',
           motivo_erro = coalesce(motivo_erro, 'destravado: ENVIANDO sem confirmacao')
     where status = 'ENVIANDO'
       and criado_em < now() - make_interval(hours => greatest(p_horas, 1))
    returning 1
  ) select count(*) into v_n from r;
  return v_n;
end $function$;

comment on function public.jm_esc_destravar(integer) is
  'Devolve para a fila a solicitacao que ficou presa em ENVIANDO. Chamada pela jm_esc_rotina antes de confirmar.';

create or replace function public.jm_esc_rotina(p_lote integer default 15)
returns text language plpgsql as $function$
declare v_dest int; v_conf int; v_disp int; v_pend int; v_env int;
begin
  v_dest := public.jm_esc_destravar(2);
  v_conf := public.jm_esc_confirmar();
  perform public.jm_esc_colher_docs();
  v_disp := public.jm_esc_disparar(p_lote);
  select count(*) into v_pend from public.jm_esc_solicitacoes where status='PENDENTE';
  select count(*) into v_env  from public.jm_esc_solicitacoes where status='ENVIANDO';
  return format('destravadas=%s confirmadas=%s disparadas=%s pendentes=%s enviando=%s',
                v_dest, v_conf, v_disp, v_pend, v_env);
end $function$;
