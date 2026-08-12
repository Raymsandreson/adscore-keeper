-- Cadastros por período: o filtro de relacionamento agora aceita COMBINAÇÃO.
--
-- A tela passou a permitir marcar vários relacionamentos ("parceiro" + "cliente")
-- em dois modos: 'any' (qualquer um dos marcados) e 'all' (todos ao mesmo tempo).
-- A RPC recebia um único `p_classification` — sem isto, as barras contariam um
-- recorte diferente do que a lista mostra, calado.
--
-- `p_classification` (singular) continua aceito: enquanto o front novo não é
-- publicado, a versão em produção segue chamando por ele.
--
-- Por que DROP + CREATE e não CREATE OR REPLACE: os dois parâmetros novos mudam
-- a assinatura. Manter a antiga viva deixaria duas sobrecargas e toda chamada
-- por nome (o que o supabase-js faz) voltaria "function is not unique".
--
-- Rollback (volta à versão de 20260812020000):
--   DROP FUNCTION public.contacts_creation_series(text,int,text,text,text,text,text,text,text,text,text,text,text[],text);
--   e reaplicar 20260812020000_contacts_creation_series.sql

DROP FUNCTION IF EXISTS public.contacts_creation_series(text,int,text,text,text,text,text,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.contacts_creation_series(
  p_bucket              text   DEFAULT 'day',    -- day | week | month | year
  p_buckets             int    DEFAULT 5,
  p_tz                  text   DEFAULT 'America/Sao_Paulo',
  p_state               text   DEFAULT NULL,
  p_city                text   DEFAULT NULL,
  p_source              text   DEFAULT NULL,     -- contacts.action_source
  p_created_by          text   DEFAULT NULL,     -- uuid em texto
  p_classification      text   DEFAULT NULL,     -- legado; 'none' = sem status
  p_group               text   DEFAULT NULL,     -- with_group | without_group
  p_lead_linked         text   DEFAULT NULL,     -- linked | not_linked
  p_profession          text   DEFAULT NULL,     -- '__none__' = sem profissão
  p_search              text   DEFAULT NULL,
  p_classifications     text[] DEFAULT NULL,     -- vários; {none} = sem status
  p_classification_mode text   DEFAULT 'any'     -- any = união | all = interseção
)
RETURNS TABLE (bucket_start timestamptz, total bigint, with_lead bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      CASE lower(coalesce(p_bucket, 'day'))
        WHEN 'week'  THEN 'week'
        WHEN 'month' THEN 'month'
        WHEN 'year'  THEN 'year'
        ELSE 'day'
      END AS unit,
      GREATEST(LEAST(coalesce(p_buckets, 5), 24), 1)          AS n,
      coalesce(NULLIF(btrim(p_tz), ''), 'America/Sao_Paulo')  AS tz,
      -- Lista efetiva: o parâmetro novo manda; sem ele, cai no singular legado.
      coalesce(
        NULLIF(p_classifications, ARRAY[]::text[]),
        CASE WHEN p_classification IS NULL THEN NULL ELSE ARRAY[p_classification] END
      ) AS cls,
      (lower(coalesce(p_classification_mode, 'any')) = 'all') AS cls_all
  ),
  -- A grade vem sempre completa: dia sem cadastro precisa aparecer como zero,
  -- senão o gráfico "pula" o dia e engana a leitura de ritmo.
  grid AS (
    SELECT generate_series(
             date_trunc(p.unit, now() AT TIME ZONE p.tz) - ((p.n - 1) || ' ' || p.unit)::interval,
             date_trunc(p.unit, now() AT TIME ZONE p.tz),
             ('1 ' || p.unit)::interval
           ) AS bstart
    FROM params p
  ),
  base AS (
    SELECT
      date_trunc(p.unit, c.created_at AT TIME ZONE p.tz) AS bstart,
      (c.lead_id IS NOT NULL OR EXISTS (
         SELECT 1 FROM public.contact_leads cl WHERE cl.contact_id = c.id
       )) AS has_lead
    FROM public.contacts c
    CROSS JOIN params p
    WHERE c.deleted_at IS NULL
      AND c.created_at >= ((SELECT min(bstart) FROM grid) AT TIME ZONE p.tz)
      AND (p_state  IS NULL OR c.state  = p_state)
      AND (p_city   IS NULL OR c.city   = p_city)
      AND (p_source IS NULL OR c.action_source = p_source)
      AND (p_created_by IS NULL OR c.created_by = p_created_by::uuid)
      AND (
        p.cls IS NULL
        -- 'none' é exclusivo na tela: ausência não combina com presença.
        OR ('none' = ANY(p.cls) AND c.classification IS NULL)
        OR (
          NOT ('none' = ANY(p.cls))
          AND CASE WHEN p.cls_all
            THEN (SELECT bool_and(coalesce(c.classification = x, false)
                                  OR coalesce(c.classifications @> ARRAY[x], false))
                    FROM unnest(p.cls) x)
            ELSE (SELECT bool_or (coalesce(c.classification = x, false)
                                  OR coalesce(c.classifications @> ARRAY[x], false))
                    FROM unnest(p.cls) x)
          END
        )
      )
      AND (
        p_group IS NULL
        OR (p_group = 'with_group'    AND c.whatsapp_group_id IS NOT NULL)
        OR (p_group = 'without_group' AND c.whatsapp_group_id IS NULL)
      )
      AND (
        p_lead_linked IS NULL
        OR (p_lead_linked = 'linked'
            AND EXISTS (SELECT 1 FROM public.contact_leads cl WHERE cl.contact_id = c.id))
        OR (p_lead_linked = 'not_linked'
            AND NOT EXISTS (SELECT 1 FROM public.contact_leads cl WHERE cl.contact_id = c.id))
      )
      AND (
        p_profession IS NULL
        OR (p_profession =  '__none__' AND NULLIF(btrim(c.profession), '') IS NULL)
        OR (p_profession <> '__none__' AND NULLIF(btrim(c.profession), '') = p_profession)
      )
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR concat_ws(' ', c.full_name, c.phone, c.email, c.city, c.state, c.neighborhood)
             ILIKE '%' || btrim(p_search) || '%'
      )
  )
  SELECT
    (g.bstart AT TIME ZONE (SELECT tz FROM params))::timestamptz AS bucket_start,
    count(b.bstart)                    AS total,
    count(*) FILTER (WHERE b.has_lead) AS with_lead
  FROM grid g
  LEFT JOIN base b ON b.bstart = g.bstart
  GROUP BY g.bstart
  ORDER BY g.bstart;
$$;

GRANT EXECUTE ON FUNCTION public.contacts_creation_series(text,int,text,text,text,text,text,text,text,text,text,text,text[],text)
  TO anon, authenticated;

-- Combinação ("parceiro E cliente") e união passam por contains no array; sem
-- GIN, cada variação vira seq scan nos ~28k contatos.
CREATE INDEX IF NOT EXISTS idx_contacts_classifications_gin
  ON public.contacts USING gin (classifications)
  WHERE deleted_at IS NULL;

-- Valores de relacionamento REALMENTE em uso, com a contagem de contatos.
--
-- `contact_classification_counts` só sabe dos nomes cadastrados em
-- `contact_classifications` — e a base divergiu: 1.658 contatos usam 'cliente'
-- (a tabela tem 'cliente', mas o filtro antigo da tela oferecia 'client', que
-- não existe em nenhum contato), enquanto 'lead' (309) e 'interno' (18) estão
-- gravados nos contatos sem linha na tabela. O filtro precisa oferecer o que
-- de fato dá resultado, senão a pessoa marca e vê zero.
--
-- Junta as duas fontes por contato: o array novo e a coluna legada — em 42
-- contatos elas divergem, e o filtro da tela também olha as duas.
--
-- Rollback: DROP FUNCTION public.contact_classification_values();
CREATE OR REPLACE FUNCTION public.contact_classification_values()
RETURNS TABLE (name text, contacts bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.name, count(DISTINCT v.id) AS contacts
  FROM (
    SELECT c.id,
           unnest(
             coalesce(c.classifications, ARRAY[]::text[])
             || CASE WHEN c.classification IS NULL THEN ARRAY[]::text[] ELSE ARRAY[c.classification] END
           ) AS name
    FROM public.contacts c
    WHERE c.deleted_at IS NULL
  ) v
  WHERE v.name IS NOT NULL AND btrim(v.name) <> ''
  GROUP BY v.name
  ORDER BY count(DISTINCT v.id) DESC, v.name;
$$;

GRANT EXECUTE ON FUNCTION public.contact_classification_values() TO anon, authenticated;
