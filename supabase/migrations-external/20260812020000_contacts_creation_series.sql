-- Série de cadastros de contatos por período (dia/semana/mês/ano) — card
-- "Cadastros por período" da tela de Contatos & Transmissão.
--
-- Por que RPC e não contar no cliente: a lista da tela carrega no máximo 1000
-- contatos (os mais novos). Para "últimos 5 dias" isso costuma bastar, mas
-- julho/2026 sozinho tem 8.632 cadastros — contar no browser daria um gráfico
-- errado e calado. Aqui o Postgres agrega e volta 5 linhas.
--
-- Por que a checagem de lead olha as DUAS fontes: dos 10.037 contatos com lead,
-- 8.273 existem só em `contact_leads` e 936 só em `contacts.lead_id` (legado).
-- Olhar uma fonte só perderia a maior parte.
--
-- Os filtros repetem os da tela para o gráfico falar dos MESMOS contatos que a
-- lista mostra (inclusive busca e profissão, que a tela aplica no cliente).
--
-- Rollback:
--   DROP FUNCTION public.contacts_creation_series(text,int,text,text,text,text,text,text,text,text,text,text);
--   DROP INDEX public.idx_contacts_created_at;

CREATE OR REPLACE FUNCTION public.contacts_creation_series(
  p_bucket         text DEFAULT 'day',    -- day | week | month | year
  p_buckets        int  DEFAULT 5,
  p_tz             text DEFAULT 'America/Sao_Paulo',
  p_state          text DEFAULT NULL,
  p_city           text DEFAULT NULL,
  p_source         text DEFAULT NULL,     -- contacts.action_source
  p_created_by     text DEFAULT NULL,     -- uuid em texto
  p_classification text DEFAULT NULL,     -- 'none' = sem status
  p_group          text DEFAULT NULL,     -- with_group | without_group
  p_lead_linked    text DEFAULT NULL,     -- linked | not_linked
  p_profession     text DEFAULT NULL,     -- '__none__' = sem profissão
  p_search         text DEFAULT NULL
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
      coalesce(NULLIF(btrim(p_tz), ''), 'America/Sao_Paulo')  AS tz
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
        p_classification IS NULL
        OR (p_classification =  'none' AND c.classification IS NULL)
        OR (p_classification <> 'none' AND (c.classification = p_classification
                                            OR c.classifications @> ARRAY[p_classification]))
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

GRANT EXECUTE ON FUNCTION public.contacts_creation_series(text,int,text,text,text,text,text,text,text,text,text,text)
  TO anon, authenticated;

-- A janela é sempre "os últimos N períodos" e a lista da tela já ordena por
-- created_at DESC — sem índice as duas viram seq scan em ~35k linhas.
CREATE INDEX IF NOT EXISTS idx_contacts_created_at
  ON public.contacts (created_at DESC)
  WHERE deleted_at IS NULL;
