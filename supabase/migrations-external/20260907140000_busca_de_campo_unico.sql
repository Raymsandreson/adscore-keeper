-- =============================================================================
-- Busca de campo único: o mesmo campo acha processo, caso, grupo e cliente.
--
-- POR QUE
-- Hoje a busca global (`GlobalDatabaseSearch.tsx`) compara TEXTO com `ilike`.
-- Isso quebra em dois lugares, e os dois foram medidos em 07/09/2026.
--
--   1. PROCESSO. `lead_processes` tem 2.710 linhas: 1.330 com o CNJ mascarado
--      (0000972-16.2026.5.22.0003) e ZERO com os 20 dígitos puros. Como a busca
--      faz `process_number ilike '%<termo>%'`, quem cola o número puro — que é o
--      formato que sai de sistema de tribunal — não acha nada. Prova, com uma
--      linha real do banco:
--
--          guardado:                        5004604-66.2026.4.04.7013
--          digitando com máscara         -> 1 achado
--          digitando 50046046620264047013 -> 0 achados
--          comparando por dígitos        -> 1 achado
--
--      Não é caso de borda: é 100% das linhas com CNJ.
--
--   2. CÓDIGO DO CASO. A detecção era `^(?:caso[\s-]*)?(\d{1,8})$`, que pega
--      "caso 369" e "369" mas não "PREV 1802". E comparava por `ilike`, então
--      "1802" casava com "11802" e "18020". O dado explica por que dói:
--
--                            com prefixo   só número
--          legal_cases (1.984)    1.805          81
--          leads       (1.769)      450       1.279
--
--      O MESMO caso está "PREV 1802" numa tabela e "1802" na outra. Comparar
--      string nunca vai casar os dois; comparar (família, número) casa.
--
-- A METÁFORA
-- Procurar alguém pelo jeito que o nome foi escrito na etiqueta, em vez de pelo
-- CPF. "José da Silva" e "Jose Silva" são a mesma pessoa e a etiqueta não sabe.
-- O CNJ tem um "CPF": os 20 dígitos. O caso tem: (família, número).
--
-- O QUE JÁ EXISTIA E FOI REUSADO, EM VEZ DE REESCRITO
--   `cnj_digitos(text)`     tira a máscara
--   `cnj_valido(text)`      confere o dígito verificador por módulo 97 (ISO 7064)
--   `search_whatsapp_groups_by_tokens(...)`  casa todos os tokens em AND, com
--                           unaccent, e já devolve DISTINCT ON (group_jid)
--   `dom_normalizar_nome_grupo(text)`  (migration 20260907120000)
--
-- A ARMADILHA DO JID — três tabelas, três formatos, uma delas misturada:
--   whatsapp_groups_index  30.195 linhas, 30.195 com '@g.us'
--   lead_whatsapp_groups    2.382 linhas,  1.300 com '@g.us'   <- MISTURADA
--   dom_grupos_piloto       1.149 linhas,      0 com '@g.us'
-- Join sem normalizar perde o vínculo de metade dos grupos e o resultado
-- aparece como "grupo sem caso" — que é justamente a linha que ganha o botão
-- "vincular a um caso". Ou seja: o bug se disfarçaria de funcionalidade.
-- Por isso todo join aqui passa por split_part(group_jid, '@', 1).
--
-- DUAS REGRAS QUE FICAM EXPLÍCITAS NO SQL
--   - A busca varre TODOS os grupos, inclusive os em quarentena. A fonte é
--     `whatsapp_groups_index`, que não tem coluna de escopo — então isso vale
--     por construção, não por alguém lembrar de não filtrar. O escopo volta no
--     resultado só para a UI mostrar o selo SEM esconder a linha.
--   - Grupo sem caso vinculado volta com acao_sugerida = 'vincular_caso'.
--
-- E UMA DECISÃO QUE PARECE ERRO E NÃO É
-- A busca por processo NÃO exige `cnj_valido`. Busca tem que achar o que está
-- guardado, inclusive o que está errado — quem quer consertar um CNJ com
-- dígito verificador furado precisa antes conseguir achá-lo. Validar é
-- trabalho do auto-vínculo (que decide GRAVAR), não da busca (que só mostra).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A chave do caso: (família, número, sufixo)
--
-- p_estrito = true  -> o texto INTEIRO tem que ser o código (o que o usuário
--                      digitou). "PREV 1802" sim; "PREV 1802 Izolete" não, isso
--                      é busca por texto livre.
-- p_estrito = false -> pega o código do começo e ignora o resto (o que está
--                      guardado em case_number, que vem sujo).
--
-- Recusa em vez de adivinhar, nos dois modos: CNJ (20 dígitos) e qualquer
-- bloco de 6+ dígitos viram NULL. Sem isso o NUP 13621.214680/2024-67 vira
-- "caso 13621" e devolve a ficha de outra pessoa — testado, era o que
-- acontecia antes desta guarda.
-- -----------------------------------------------------------------------------
create or replace function public.busca_chave_caso(
  p_txt     text,
  p_estrito boolean default false
)
returns table (familia text, numero integer, sufixo text)
language sql
immutable
as $$
  with bruto as (
    select
      coalesce(p_txt, '') as t,
      public.dom_normalizar_nome_grupo(p_txt) as n
  ),
  guardado as (
    select b.*,
      (length(public.cnj_digitos(b.t)) = 20 or b.t ~ '[0-9]{6,}') as recusa
    from bruto b
  ),
  achado as (
    select g.recusa,
      case when g.recusa then null else regexp_match(
        g.n,
        case when p_estrito
          then '^(PREV|CASO|FAMILIA|LEAD|SM|DG)?[[:space:]\-_|.]*([0-9]{1,5})(\.[0-9]{1,2})?[[:space:]]*$'
          else '^(PREV|CASO|FAMILIA|LEAD|SM|DG)?[[:space:]\-_|.]*([0-9]{1,5})(\.[0-9]{1,2})?'
        end
      ) end as m
    from guardado g
  )
  select a.m[1], a.m[2]::integer, ltrim(a.m[3], '.')
    from achado a
   where a.m is not null and a.m[2] is not null;
$$;

comment on function public.busca_chave_caso(text, boolean) is
  'Texto -> (familia, numero, sufixo) do codigo do caso. Zero linhas quando nao reconhece. Recusa CNJ e bloco de 6+ digitos em vez de adivinhar.';


-- -----------------------------------------------------------------------------
-- 2. O índice que faz a busca por processo não varrer a tabela
--
-- `cnj_digitos` é IMMUTABLE, então dá para indexar a expressão. Sem isso todo
-- CNJ digitado vira seq scan em lead_processes.
--
-- Índice comum, não CONCURRENTLY: são 2.710 linhas (milissegundos), e
-- CONCURRENTLY nem roda dentro da transação da migration. CONCURRENTLY é para
-- tabela grande — se um dia esta virar uma, o índice se cria fora daqui.
-- -----------------------------------------------------------------------------
create index if not exists idx_lead_processes_cnj_digitos
  on public.lead_processes (public.cnj_digitos(process_number))
  where deleted_at is null;


-- -----------------------------------------------------------------------------
-- 3. A busca
-- -----------------------------------------------------------------------------
create or replace function public.busca_unificada(
  p_termo  text,
  p_limite integer default 30
)
returns table (
  tipo          text,      -- 'processo' | 'caso' | 'grupo' | 'cliente'
  id            uuid,
  titulo        text,
  subtitulo     text,
  group_jid     text,
  lead_id       uuid,
  case_id       uuid,
  process_id    uuid,
  escopo_status text,
  acao_sugerida text,      -- 'vincular_caso' quando o grupo nao tem caso
  score         real
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_termo    text := btrim(coalesce(p_termo, ''));
  v_digitos  text := public.cnj_digitos(v_termo);
  v_familia  text;
  v_numero   integer;
  v_sufixo   text;
  v_tokens   text[];
begin
  if length(v_termo) < 2 then
    return;
  end if;

  -- ---- 1) PROCESSO: 20 dígitos, com ou sem máscara -------------------------
  if length(v_digitos) = 20 then
    return query
      select 'processo'::text,
             p.id,
             coalesce(public.cnj_formatado(p.process_number), p.process_number),
             nullif(btrim(coalesce(p.title, '') ||
                    case when p.tribunal_sigla is null then '' else ' · ' || p.tribunal_sigla end), ''),
             null::text, p.lead_id, p.case_id, p.id,
             null::text, null::text,
             1.0::real
        from public.lead_processes p
       where p.deleted_at is null
         and public.cnj_digitos(p.process_number) = v_digitos
       limit p_limite;
    return;
  end if;

  -- ---- 2) CASO: "PREV 1802", "1802", "Caso 150" -----------------------------
  select k.familia, k.numero, k.sufixo
    into v_familia, v_numero, v_sufixo
    from public.busca_chave_caso(v_termo, true) k;

  if v_numero is not null then
    return query
      with alvo as (
        -- legal_cases e leads na mesma consulta de propósito: o mesmo caso está
        -- "PREV 1802" numa e "1802" na outra, e quem procura não sabe (nem
        -- deveria precisar saber) em qual das duas ele foi cadastrado.
        select 'caso'::text as tipo, c.id, c.case_number, c.title as titulo,
               c.lead_id, c.id as case_id
          from public.legal_cases c where c.deleted_at is null
        union all
        select 'cliente'::text, l.id, l.case_number, coalesce(l.lead_name, l.victim_name),
               l.id, null::uuid
          from public.leads l where l.deleted_at is null and l.case_number is not null
      ),
      chave as (
        select a.*, k.familia, k.numero, k.sufixo
          from alvo a, lateral public.busca_chave_caso(a.case_number, false) k
      )
      select ch.tipo, ch.id,
             coalesce(ch.case_number, '(sem numero)'),
             ch.titulo,
             null::text, ch.lead_id, ch.case_id, null::uuid,
             null::text, null::text,
             -- Casar família exata vale mais que casar só o número: quem digita
             -- "PREV 1802" quer o PREV antes do CASO de mesmo número.
             (case when ch.familia is not distinct from v_familia then 1.0 else 0.7 end)::real
        from chave ch
       where ch.numero = v_numero
         -- Família ausente de um dos lados casa com qualquer uma: é o caso dos
         -- 1.279 leads que guardam só o número.
         and (v_familia is null or ch.familia is null or ch.familia = v_familia)
         -- Sem sufixo digitado, "183" traz 183 e 183.1. Com sufixo, exato.
         and (v_sufixo is null or ch.sufixo is not distinct from v_sufixo)
       order by 11 desc, ch.case_number
       limit p_limite;
    return;
  end if;

  -- ---- 3) TEXTO LIVRE: nome do grupo + nome do cliente ----------------------
  v_tokens := array_remove(regexp_split_to_array(v_termo, '[[:space:]]+'), '');

  return query
    with grupos as (
      select s.group_jid, s.contact_name, s.instance_name
        from public.search_whatsapp_groups_by_tokens(v_tokens, null, null, p_limite) s
    ),
    -- A normalização do JID acontece aqui, uma vez, e não em cada join abaixo.
    -- whatsapp_groups_index sempre tem '@g.us', lead_whatsapp_groups tem em
    -- pouco mais da metade das linhas e dom_grupos_piloto nunca tem.
    chaveados as (
      select g.*, split_part(g.group_jid, '@', 1) as jid_nu from grupos g
    )
    select 'grupo'::text,
           null::uuid,
           c.contact_name,
           nullif(btrim(coalesce(c.instance_name, '') ||
                  case when v.lead_id is null then '' else ' · vinculado' end), ''),
           c.group_jid,
           v.lead_id,
           null::uuid,
           null::uuid,
           pil.escopo_status,
           case when v.lead_id is null then 'vincular_caso' else null end,
           0.6::real
      from chaveados c
      left join lateral (
        select lg.lead_id from public.lead_whatsapp_groups lg
         where split_part(lg.group_jid, '@', 1) = c.jid_nu
         limit 1
      ) v on true
      left join public.dom_grupos_piloto pil on pil.group_jid = c.jid_nu

    union all

    select 'cliente'::text, l.id, coalesce(l.lead_name, l.victim_name),
           nullif(btrim(coalesce(l.case_number, '') ||
                  case when l.lead_phone is null then '' else ' · ' || l.lead_phone end), ''),
           null::text, l.id, null::uuid, null::uuid, null::text, null::text, 0.5::real
      from public.leads l
     where l.deleted_at is null
       and not exists (
         select 1 from unnest(v_tokens) t
          where unaccent(lower(coalesce(l.lead_name, '') || ' ' || coalesce(l.victim_name, '')))
                not ilike '%' || unaccent(lower(t)) || '%'
       )
     limit p_limite;
end $$;

comment on function public.busca_unificada(text, integer) is
  'Busca de campo unico: detecta CNJ (20 digitos, com ou sem mascara), codigo de caso (familia+numero) ou texto livre. Varre TODOS os grupos, inclusive nao_classificado.';

grant execute on function public.busca_unificada(text, integer) to authenticated;
grant execute on function public.busca_chave_caso(text, boolean) to authenticated;


-- =============================================================================
-- ROLLBACK
--
-- begin;
-- drop function if exists public.busca_unificada(text, integer);
-- drop function if exists public.busca_chave_caso(text, boolean);
-- drop index if exists public.idx_lead_processes_cnj_digitos;
-- commit;
--
-- Nada aqui altera dado: são duas funções e um índice. A UI continua chamando
-- o que chamava antes até a Etapa 2b, então reverter não deixa tela quebrada.
-- =============================================================================
