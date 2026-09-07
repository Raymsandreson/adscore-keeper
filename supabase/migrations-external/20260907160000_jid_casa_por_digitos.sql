-- =============================================================================
-- Vínculo de grupo passa a casar por DÍGITOS, não por "tirar o @g.us".
--
-- O ERRO
-- A 20260907140000 normalizava o JID com split_part(group_jid, '@', 1),
-- acreditando que a única diferença entre as tabelas era o sufixo '@g.us'.
-- Não é. Grupo criado no formato legado tem hífen no meio:
--
--     whatsapp_groups_index   5521982930722-1446775117@g.us
--     dom_grupos_piloto       55219829307221446775117
--     whatsapp_messages.phone 55219829307221446775117
--
-- O webhook grava `phone` com `.replace(/\D/g, '')`, então come o hífen; o
-- índice de grupos guarda o JID cru. split_part resolve o '@g.us' e deixa o
-- hífen, e aí as duas chaves não casam.
--
-- MEDIDO em 07/09/2026:
--     grupos do piloto casando por split_part   1.101 de 1.149   (48 perdidos)
--     grupos do piloto casando por só-dígitos   1.149 de 1.149
--     grupos com JID legado no índice             792 de 30.195
--
-- POR QUE ISSO É PIOR QUE UM JOIN VAZIO
-- O join que falha não dá erro: devolve NULL. E NULL em `lead_id` é exatamente
-- a condição que faz a busca carimbar `acao_sugerida = 'vincular_caso'`. Ou
-- seja, 48 grupos JÁ VINCULADOS apareceriam com o botão "vincular a um caso",
-- convidando alguém a vincular de novo o que já estava vinculado. O bug se
-- disfarçava de funcionalidade — e foi assim que ele apareceu no teste: o
-- "Familia gold1p.x" voltou com escopo_status NULL em vez de
-- 'nao_classificado', porque ele é um dos 792 do formato legado.
--
-- A METÁFORA
-- Comparar telefone tirando só o DDI e deixando o traço. "86 9 4000-0545" e
-- "8694000545" são o mesmo número, e a string não sabe disso.
--
-- O CONSERTO
-- Uma função `jid_chave(text)`: só os dígitos. É a mesma conta que o webhook já
-- faz há meses para gravar `whatsapp_messages.phone`, então isto não inventa
-- uma terceira convenção — adota a que já é a de fato.
-- =============================================================================

create or replace function public.jid_chave(p_jid text)
returns text
language sql
immutable
as $$
  -- Mesma conta do webhook (whatsapp-webhook.ts: rawPhone.replace(/\D/g,'')).
  -- Adotar a convenção que já existe é melhor que criar a quarta.
  select nullif(regexp_replace(coalesce(p_jid, ''), '\D', '', 'g'), '');
$$;

comment on function public.jid_chave(text) is
  'JID de grupo -> so digitos. Unica chave que casa whatsapp_groups_index (com @g.us e hifen), lead_whatsapp_groups (misturada) e dom_grupos_piloto (so digitos).';

-- Índices para os dois joins da busca por texto livre. Sem eles, cada busca
-- varre lead_whatsapp_groups (2.382) e dom_grupos_piloto (1.149) por resultado
-- de grupo — barato hoje, caro quando a fila crescer.
create index if not exists idx_lead_whatsapp_groups_jid_chave
  on public.lead_whatsapp_groups (public.jid_chave(group_jid));

create index if not exists idx_dom_grupos_piloto_jid_chave
  on public.dom_grupos_piloto (public.jid_chave(group_jid));

-- A busca, com o join consertado. Só o bloco de texto livre muda; os ramos de
-- processo e de caso ficam idênticos aos de 20260907140000.
create or replace function public.busca_unificada(
  p_termo  text,
  p_limite integer default 30
)
returns table (
  tipo          text,
  id            uuid,
  titulo        text,
  subtitulo     text,
  group_jid     text,
  lead_id       uuid,
  case_id       uuid,
  process_id    uuid,
  escopo_status text,
  acao_sugerida text,
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

  -- 1) PROCESSO: 20 dígitos, com ou sem máscara.
  if length(v_digitos) = 20 then
    return query
      select 'processo'::text, p.id,
             coalesce(public.cnj_formatado(p.process_number), p.process_number),
             nullif(btrim(coalesce(p.title, '') ||
                    case when p.tribunal_sigla is null then '' else ' · ' || p.tribunal_sigla end), ''),
             null::text, p.lead_id, p.case_id, p.id, null::text, null::text, 1.0::real
        from public.lead_processes p
       where p.deleted_at is null
         and public.cnj_digitos(p.process_number) = v_digitos
       limit p_limite;
    return;
  end if;

  -- 2) CASO: "PREV 1802", "1802", "Caso 150".
  select k.familia, k.numero, k.sufixo into v_familia, v_numero, v_sufixo
    from public.busca_chave_caso(v_termo, true) k;

  if v_numero is not null then
    return query
      with alvo as (
        select 'caso'::text as tipo, c.id, c.case_number, c.title as titulo, c.lead_id, c.id as case_id
          from public.legal_cases c where c.deleted_at is null
        union all
        select 'cliente'::text, l.id, l.case_number, coalesce(l.lead_name, l.victim_name), l.id, null::uuid
          from public.leads l where l.deleted_at is null and l.case_number is not null
      ),
      chave as (
        select a.*, k.familia, k.numero, k.sufixo
          from alvo a, lateral public.busca_chave_caso(a.case_number, false) k
      )
      select ch.tipo, ch.id, coalesce(ch.case_number, '(sem numero)'), ch.titulo,
             null::text, ch.lead_id, ch.case_id, null::uuid, null::text, null::text,
             (case when ch.familia is not distinct from v_familia then 1.0 else 0.7 end)::real
        from chave ch
       where ch.numero = v_numero
         and (v_familia is null or ch.familia is null or ch.familia = v_familia)
         and (v_sufixo is null or ch.sufixo is not distinct from v_sufixo)
       order by 11 desc, ch.case_number
       limit p_limite;
    return;
  end if;

  -- 3) TEXTO LIVRE: nome do grupo + nome do cliente.
  v_tokens := array_remove(regexp_split_to_array(v_termo, '[[:space:]]+'), '');

  return query
    with grupos as (
      select s.group_jid, s.contact_name, s.instance_name
        from public.search_whatsapp_groups_by_tokens(v_tokens, null, null, p_limite) s
    ),
    chaveados as (
      select g.*, public.jid_chave(g.group_jid) as chave from grupos g
    )
    select 'grupo'::text, null::uuid, c.contact_name,
           nullif(btrim(coalesce(c.instance_name, '') ||
                  case when v.lead_id is null then '' else ' · vinculado' end), ''),
           c.group_jid, v.lead_id, null::uuid, null::uuid,
           pil.escopo_status,
           case when v.lead_id is null then 'vincular_caso' else null end,
           0.6::real
      from chaveados c
      left join lateral (
        select lg.lead_id from public.lead_whatsapp_groups lg
         where public.jid_chave(lg.group_jid) = c.chave
         limit 1
      ) v on true
      left join public.dom_grupos_piloto pil on public.jid_chave(pil.group_jid) = c.chave

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

-- =============================================================================
-- ROLLBACK
-- begin;
-- drop index if exists public.idx_dom_grupos_piloto_jid_chave;
-- drop index if exists public.idx_lead_whatsapp_groups_jid_chave;
-- drop function if exists public.jid_chave(text);
-- -- e recolar busca_unificada da 20260907140000 (a que usa split_part) —
-- -- lembrando que ela perde o vinculo de 48 grupos.
-- commit;
-- =============================================================================
