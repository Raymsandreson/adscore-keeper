-- ============================================================================
-- A data do próximo contato entra no contexto — e a atividade apagada sai dele
--
-- POR QUE
-- O Dom terminava toda resposta com "qualquer novidade a gente avisa", que é
-- verdadeiro e não ajuda ninguém a esperar. Quando a equipe JÁ programou a
-- volta, dizer a data é o que transforma espera em previsão.
--
-- MAS SÓ QUANDO A DATA VALE. Medido nesta base em 07/09/2026: das 8.179 fichas
-- com atividade nos últimos 180 dias, o prazo da atividade mais recente está no
-- FUTURO em 10,6% (869) e JÁ VENCEU em 79,6% (6.511). Prometer uma data vencida
-- é pior que não prometer nada: o cliente confere. Por isso o
-- `case when a.deadline >= current_date`, que devolve NULO quando a data não
-- serve — e o texto volta a terminar com "qualquer novidade a gente avisa".
--
-- Isto é detector, não filtro (regra 8 do CLAUDE.md): o prazo vencido continua
-- inteiro em `lead_activities` e continua sendo problema da esteira de
-- atividades. O que esta função faz é não repetir o problema na boca do
-- atendente.
--
-- DE QUEBRA, UM DEFEITO REAL
-- A subquery de `ultima_atividade` não filtrava `deleted_at`. Atividade apagada
-- podia ser a mais recente e virar o contexto da resposta — o Dom falando com o
-- cliente a partir de uma anotação que a equipe removeu.
--
-- COMO, E POR QUE ASSIM
-- A função tem 10.460 caracteres. Reescrevê-la à mão para mudar seis linhas é
-- convite a erro de transcrição numa RPC que alimenta TODAS as respostas do
-- Dom. Então o próprio Postgres reescreve: lê a definição de si mesmo, troca o
-- trecho, e executa. Se o trecho não for encontrado, levanta exceção e NADA
-- muda — o silêncio aqui seria o pior resultado possível.
--
-- ROTA DE FUGA: `dom_contexto_processual_legacy` guarda a versão anterior,
-- criada ANTES de qualquer alteração. Rollback:
--   select pg_get_functiondef('dom_contexto_processual_legacy(text)'::regprocedure);
--   -- trocar o nome de volta e executar.
-- Remover a legacy só depois de 24h confirmando que nada mais a chama.
--
-- VERIFICADO ao aplicar: Caso 341 (Walter) passou a devolver
-- prazo_contato = 2026-09-17, que existia em lead_activities e nunca chegava ao
-- modelo.
-- ============================================================================

-- 1. A cópia de segurança, ANTES de mexer.
do $mig$
declare def text; copia text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  if def is null then raise exception 'dom_contexto_processual não existe'; end if;

  copia := replace(def,
                   'FUNCTION public.dom_contexto_processual(',
                   'FUNCTION public.dom_contexto_processual_legacy(');
  if copia = def then raise exception 'não achei o nome da função para copiar'; end if;
  execute copia;
end $mig$;

-- 2. Só agora a alteração.
do $mig$
declare def text; novo text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  novo := regexp_replace(
    def,
    '(''quando'',\s*a\.created_at)(\s*\)\s*from lead_activities a\s*join g on g\.lead_id = a\.lead_id\s*)order by a\.created_at desc',
    E'\\1,\n               ''prazo_contato'', case when a.deadline >= current_date then a.deadline end\\2where a.deleted_at is null\n      order by a.created_at desc'
  );

  if novo = def then
    raise exception 'trecho de ultima_atividade não encontrado — função NÃO alterada';
  end if;
  execute novo;
end $mig$;

comment on function public.dom_contexto_processual(text) is
  'Contexto do Dom. ultima_atividade.prazo_contato = deadline da atividade, e SÓ quando ela ainda não venceu (nulo se vencida ou ausente): data no passado é promessa quebrada antes de ser feita. Ignora atividade com deleted_at.';
