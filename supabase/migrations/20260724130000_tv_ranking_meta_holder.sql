-- Telão /tv/atividades — recorde do período agora vem do SERVIDOR com o DONO.
--
-- `tv_atividades_ranking(...).meta` deixa de ser só o número e passa a devolver
-- { passos, nome } — o recorde individual de passos do período E quem o detém,
-- já filtrado por time/grupo (o filtro do ranking também vale pra `meta`). Isso
-- permite aposentar o recorde calculado no cliente (localStorage), que vazava
-- entre times: ao trocar de time, o balde reiniciava com o ranking ANTERIOR
-- (ainda não recarregado) e fixava um dono de outro time.
--
-- Byte-safe: lê a definição vigente da 4-arg e troca só (1) a CTE `meta` (de
-- max(passos) → linha top: passos+nome) e (2) a chave de saída `meta`. Todo o
-- resto (ranking, resumo, filtros, ordenação) fica intacto.
--
-- Rollback: re-rodar a migração 20260724120000 (meta como número), ou trocar as
-- duas expressões de volta. O front trata meta como objeto após esta migração.
--
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $$
declare
  d text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;

  -- (1) CTE meta: número → linha do recordista (passos + nome).
  d := replace(d,
    'meta as (' || E'\n' || '  select coalesce(max(passos), 0)::int as passos from meta_by_name' || E'\n' || ')',
    'meta as (' || E'\n' || '  select passos, nome from meta_by_name order by passos desc, nome asc limit 1' || E'\n' || ')');

  -- (2) Saída: número → objeto { passos, nome } (0/null quando não há histórico).
  d := replace(d,
    '''meta'', (select passos from meta),',
    '''meta'', coalesce((select jsonb_build_object(''passos'', passos, ''nome'', nome) from meta), jsonb_build_object(''passos'', 0, ''nome'', null)),');

  execute d;
end $$;
