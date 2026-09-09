-- =============================================================================
-- A busca nas conversas parou de funcionar por crescimento, não por bug.
--
-- O QUE QUEBROU
-- A versão de 07/09/2026 (20260907170304) media 200 ms varrendo o recorte da
-- fila: 77 grupos, 54.769 mensagens. Em 09/09/2026 o mesmo recorte é 149 grupos
-- e 115.948 mensagens, e a mesma função leva 40 s — medido com EXPLAIN ANALYZE.
-- O banco corta em 8 s (statement_timeout do papel `authenticated`), então toda
-- busca voltava "canceling statement due to statement timeout". Como a tela
-- disparava uma consulta POR TECLA, digitar "imposto de renda" empilhava 15
-- erros vermelhos.
--
-- Dois custos empilhados, ambos medidos no banco real:
--
--   1. `unaccent(message_text)` roda POR LINHA e é dicionário, não função
--      barata. Mesmo recorte, mesmo termo: 12,6 s com unaccent, 0,5 s sem.
--      A forma de dois argumentos (regdictionary) não salva: 17,5 s.
--   2. O plano lia 33 mil páginas do heap em disco — a varredura por
--      `idx_whatsapp_messages_phone` toca uma página por mensagem do grupo.
--      Com cache frio isso sozinho já dá 8 s.
--
-- Nenhum dos dois se conserta reescrevendo SQL: os dois vêm de ler 116 mil
-- mensagens inteiras para achar 10. O conserto é não ler.
--
-- O CONSERTO, E POR QUE ELE TEM DUAS COLUNAS
-- Índice GIN de trigrama sobre o texto SEM acento. A primeira tentativa
-- indexou SÓ o texto e não resolveu: o índice acha os candidatos em 198 ms,
-- mas eles são 145 mil na tabela inteira, e o Postgres precisa reler 98.620
-- páginas do heap para conferir cada um — o filtro dos grupos da fila só entra
-- DEPOIS, no join. Resultado medido: "bom dia" em 28,5 s. Trigrama é busca
-- aproximada, então a releitura do heap é obrigatória; a única saída é o índice
-- devolver menos candidatos.
--
-- Por isso o índice é (phone, texto): a interseção "deste grupo" ∩ "com este
-- termo" acontece DENTRO do índice, e o heap só é tocado no que sobra —
-- 13.527 páginas em vez de 98.620. Mesmo termo, mesmo dado: 1,48 s.
--
-- `f_unaccent` existe porque índice de expressão exige IMMUTABLE, e o
-- `unaccent(text)` de um argumento é apenas STABLE. `btree_gin` existe porque
-- `phone` é igualdade, e GIN só indexa igualdade com essa extensão.
--
-- MEDIDO DEPOIS DE APLICAR (09/09/2026, dados reais, cache frio)
--   'acordo' ............. 0,48 s
--   'pericia' ............ 1,13 s
--   'bom dia' ............ 1,44 s   (pior caso: 14.059 mensagens casam)
--   'imposto de renda' ... 2,07 s   (era 40,4 s)
-- Todos com folga sob o corte de 8 s. Termo longo custa mais que termo curto:
-- são mais trigramas para cruzar em cada um dos ~173 grupos da fila.
--
-- CUSTO ASSUMIDO (autorizado pelo dono em 09/09/2026)
--   - disco: +285 MB (índices da tabela foram de 668 MB para 953 MB);
--   - escrita: cada mensagem recebida passa a manter o índice (GIN tem lista
--     de pendências, o custo por INSERT é pequeno, mas não é zero);
--   - o índice cobre a tabela inteira (1,46 milhão de linhas com texto), então
--     serve qualquer busca futura em mensagem, não só a da fila.
--
-- ROTA DE FUGA
--   drop index concurrently if exists public.idx_wam_grupo_texto_trgm;
--   -- e restaurar o corpo da função de 20260907170304 (só leitura, 1 minuto).
--   -- f_unaccent e btree_gin podem ficar: não custam nada parados.
-- =============================================================================

-- ── 1. unaccent que pode virar índice ────────────────────────────────────────
create extension if not exists btree_gin with schema public;

create or replace function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = public, pg_catalog
as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

comment on function public.f_unaccent(text) is
  'unaccent() envelopado como IMMUTABLE para poder virar indice. Usa a forma de dois argumentos (regdictionary) porque a de um argumento e apenas STABLE.';

grant execute on function public.f_unaccent(text) to authenticated, anon, service_role;

-- ── 2. O índice ──────────────────────────────────────────────────────────────
-- RODE À PARTE, fora de migration: CONCURRENTLY não vive dentro de transação.
-- E não vive dentro do statement_timeout de 2 min do papel `postgres` também —
-- a primeira tentativa morreu aos 211 MB e deixou índice INVÁLIDO, que ocupa
-- disco e não serve para nada. Suba o timeout, crie, e devolva o timeout:
--
--   alter role postgres set statement_timeout = '30min';
--
--   create index concurrently if not exists idx_wam_grupo_texto_trgm
--     on public.whatsapp_messages
--     using gin (phone, public.f_unaccent(message_text) public.gin_trgm_ops)
--     where message_text is not null;
--
--   alter role postgres reset statement_timeout;
--
-- Leva ~10 min e fica em 282 MB. Confira `indisvalid` antes de comemorar:
--   select indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid
--    where c.relname = 'idx_wam_grupo_texto_trgm';
--
-- Aplicado em 09/09/2026 com autorização do dono, índice válido.

-- ── 3. A função que passa a usar o índice ────────────────────────────────────
create or replace function public.buscar_nas_conversas_da_fila(
  p_termo  text,
  p_limite integer default 50
)
returns table (
  group_jid     text,
  group_name    text,
  quem_falou    text,
  direcao       text,
  quando        timestamptz,
  trecho        text,
  message_id    uuid,
  pendencia_id  uuid,
  intencao      text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_termo  text := lower(public.f_unaccent(btrim(coalesce(p_termo, ''))));
  v_padrao text;
begin
  -- Abaixo de 3 letras o trigrama não tem o que procurar e o ILIKE viraria
  -- varredura de 1,46 milhão de linhas. Devolver nada é melhor que derrubar o
  -- banco — a tela já pede 3 letras, isto é a trava do lado de cá.
  if length(v_termo) < 3 then
    return;
  end if;

  -- `%` e `_` são curingas do ILIKE. Sem escapar, procurar "50%" devolve
  -- qualquer mensagem que comece com 50, e "_" casa com qualquer letra.
  v_padrao := '%' || replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with fila as (
    select distinct on (p.group_jid)
           p.group_jid, p.group_name, p.id as pendencia_id, p.intencao
      from public.dom_respostas_pendentes p
     where p.status = 'pendente'
     order by p.group_jid, p.criado_em desc
  ),
  candidatos as (
    -- O LATERAL não é enfeite e o `offset 0` menos ainda.
    --
    -- Sem eles o planejador achata isto num hash join, usa só a condição de
    -- texto no índice e volta a reler 98 mil páginas do heap (28,5 s medidos).
    -- Ele faz isso porque estima 176 linhas onde vêm 145 mil — estimativa de
    -- seletividade de trigrama é chute. O `offset 0` é a cerca que impede o
    -- achatamento: com ela, `phone = <grupo>` entra no Index Cond junto com o
    -- texto, e a interseção acontece dentro do índice.
    --
    -- Projeção estreita de propósito: aqui podem cair milhares de linhas (um
    -- "bom dia" casa com 14 mil), e carregar message_text e metadata nessa
    -- altura é o que fazia o plano antigo ler o heap inteiro.
    --
    -- A chave de dedup sai do SUFIXO do external_message_id em vez do jsonb:
    -- `558695590127:3AA22DDE...` é `instância:messageid`, e o messageid é o
    -- mesmo em todas as instâncias da casa que estão no grupo. Conferido em
    -- 5.000 linhas: 4.980 têm messageid no metadata e 4.980 de 4.980 batem com
    -- o sufixo; e no termo 'imposto de renda' as duas chaves reduzem as mesmas
    -- 24 linhas brutas às mesmas 4 mensagens. Sem dedup, a mesma frase volta
    -- uma vez por instância nossa que está no grupo.
    select f.group_jid, x.id, x.created_at, x.chave
      from fila f
      cross join lateral (
        select m.id, m.created_at,
               coalesce(nullif(split_part(m.external_message_id, ':', 2), ''), m.id::text) as chave
          from public.whatsapp_messages m
         where m.phone = f.group_jid
           and m.message_text is not null
           and public.f_unaccent(m.message_text) ilike v_padrao
         offset 0
      ) x
  ),
  unicos as (
    select distinct on (c.chave) c.id, c.group_jid, c.created_at
      from candidatos c
     order by c.chave, c.created_at
  ),
  topo as (
    select u.id, u.group_jid, u.created_at
      from unicos u
     order by u.created_at desc
     limit greatest(coalesce(p_limite, 50), 1)
  )
  -- Só agora o texto e o jsonb são abertos, e só das linhas que vão para a
  -- tela. Montar o trecho antes do limite é pagar por resultado que ninguém vê.
  select f.group_jid, f.group_name,
         coalesce(nullif(m.metadata -> 'message' ->> 'senderName', ''), m.contact_name) as quem_falou,
         m.direction, m.created_at,
         -- Trecho em volta do termo, não o começo da mensagem: numa mensagem
         -- longa o que interessa raramente está nos primeiros 120 caracteres.
         case
           when position(v_termo in lower(public.f_unaccent(m.message_text))) > 60
             then '…' || substr(regexp_replace(m.message_text, '\s+', ' ', 'g'),
                    position(v_termo in lower(public.f_unaccent(m.message_text))) - 60, 200) || '…'
           else left(regexp_replace(m.message_text, '\s+', ' ', 'g'), 200)
         end as trecho,
         m.id, f.pendencia_id, f.intencao
    from topo t
    join public.whatsapp_messages m on m.id = t.id
    join fila f on f.group_jid = t.group_jid
   order by m.created_at desc;
end;
$fn$;

comment on function public.buscar_nas_conversas_da_fila(text, integer) is
  'Busca texto nas mensagens dos grupos com rascunho pendente, pelo indice idx_wam_grupo_texto_trgm. Deduplica pelo sufixo do external_message_id (a mesma mensagem e gravada uma vez por instancia). Abaixo de 3 letras nao consulta.';

grant execute on function public.buscar_nas_conversas_da_fila(text, integer) to authenticated;

-- ── 4. Conferido em dados reais (09/09/2026, depois de aplicar) ──────────────
--   'imposto de renda'  → 4 mensagens, as mesmas 4 que a regra antiga achava
--                         (24 linhas brutas, 0 divergências entre as duas
--                          regras de casamento e entre as duas chaves de dedup)
--   'PERÍCIA' e 'pericia' → 50 e 50: acento e maiúscula não mudam o resultado
--   'pe', '   ', null, '%%%' → 0 linhas, sem consultar o banco
--                              (o '%%%' prova que curinga não vaza para o ILIKE)
--   chamada como papel `authenticated` → 4 linhas, permissão ok
