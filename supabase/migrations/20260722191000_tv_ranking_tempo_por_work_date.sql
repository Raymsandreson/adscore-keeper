-- Telão /tv/atividades: tempo ativo/ocioso passa a agregar por work_date.
-- Aplicada no Supabase Externo (WhatsJUD, kmedldlepwiityjsdahz).
--
-- As CTEs `tempo` (ranking) e `resumo` (rodapé) somavam active_seconds/idle_seconds
-- filtrando por started_at — mas started_at é o 1º dia da linha e active_seconds é
-- o acumulado vitalício, então uma atv de dias atrás entrava com o total inteiro na
-- janela. Migração 20260722190000 criou work_date (uma fatia por dia); aqui o telão
-- passa a filtrar por ele.
--
-- Estratégia byte-safe: em vez de reescrever as ~130 linhas das funções (risco de
-- typo), lê a definição vigente via pg_get_functiondef e troca só os 2 predicados.
-- Assim tudo que já funciona (chat, passos, home_office, ordenação) fica intacto.
--
-- Rollback: re-trocar work_date de volta por started_at nas duas funções, ou
-- re-rodar a migração anterior que definiu tv_atividades_ranking.

do $$
declare
  d text;
begin
  -- Overload atual (3 args: p_since, p_team_id, p_grupo) — tem `tempo` e `resumo`.
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text)'::regprocedure) into d;
  d := replace(d,
    'where started_at >= p_since',
    'where work_date >= (p_since at time zone ''America/Sao_Paulo'')::date');
  d := replace(d,
    'where started_at >= now() - interval ''7 days''',
    'where work_date >= ((now() - interval ''7 days'') at time zone ''America/Sao_Paulo'')::date');
  execute d;

  -- Overload legado (2 args) — só o `resumo` usa started_at.
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid)'::regprocedure) into d;
  d := replace(d,
    'where started_at >= now() - interval ''7 days''',
    'where work_date >= ((now() - interval ''7 days'') at time zone ''America/Sao_Paulo'')::date');
  execute d;
end $$;
