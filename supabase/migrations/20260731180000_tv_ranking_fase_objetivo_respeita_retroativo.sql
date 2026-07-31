-- Telão /tv/atividades — FASE e OBJETIVO passam a respeitar o passo RETROATIVO.
--
-- Bug (evidência 31/07/2026, Externo): João Pedro apareceu com 0 PASSOS e
-- 9 FASES / 9 OBJETIVOS no mesmo dia. Os 24 passos dele do dia foram gravados
-- com metadata.retroactive = true; a CTE `passos` filtra retroativo desde a
-- 20260721191000, mas `inst_last` — base de `objetivos` e `fases` — lia
-- user_activity_log SEM filtro de retroativo e SEM filtro de período. Resultado:
-- o mesmo clique que não vale passo fechava objetivo e fase normalmente, que são
-- justamente os critérios de desempate mais altos do ranking.
--
-- Correção (uma CTE, nada mais): `inst_last` só considera passo NÃO-retroativo
-- DENTRO do período. Consequências pretendidas:
--   - instância fechada só com passos retroativos não credita objetivo nem fase;
--   - o dono do objetivo/fase é o último que deu passo de verdade no período
--     (antes podia ser alguém que mexeu na instância semanas atrás);
--   - instância sem nenhum passo real no período não credita ninguém.
--
-- Byte-safe: lê a definição vigente da 4-arg e injeta o filtro por replace
-- pontual, validando que casou (conta ocorrências de 'retroactive' antes/depois).
-- Assinatura inalterada. Idempotente: se já tiver o filtro, sai sem tocar.
--
-- Rollback: re-rodar a 20260724150000_tv_ranking_fases_objetivos.sql (ela
-- reconstrói inst_last a partir da definição vigente na época) ou aplicar o
-- replace inverso, removendo as duas linhas do filtro em inst_last.
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $mig$
declare
  d text;
  n_antes int;
  n_depois int;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;

  select count(*) into n_antes from regexp_matches(d, 'retroactive', 'g');

  d := replace(d,
$old$inst_last as (
  select ual.entity_id as instance_id,
    (array_agg(ual.user_id order by ual.created_at desc))[1] as cloud_user
  from user_activity_log ual
  where ual.action_type = 'checklist_item_checked'
  group by ual.entity_id
),$old$,
$new$inst_last as (
  select ual.entity_id as instance_id,
    (array_agg(ual.user_id order by ual.created_at desc))[1] as cloud_user
  from user_activity_log ual
  where ual.action_type = 'checklist_item_checked'
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
    and ual.created_at >= p_since
  group by ual.entity_id
),$new$);

  select count(*) into n_depois from regexp_matches(d, 'retroactive', 'g');

  if n_depois = n_antes then
    raise notice '[tv_ranking_fase_objetivo_respeita_retroativo] filtro já presente ou inst_last mudou — nada aplicado';
    return;
  end if;

  if n_depois <> n_antes + 1 then
    raise exception 'replace de inst_last inesperado (antes=%, depois=%)', n_antes, n_depois;
  end if;

  execute d;
end
$mig$;
