-- Painel lateral do "Relacionamento Conosco": lista de contatos de um status
-- + detalhamento por estado / cidade / bairro / profissão.
--
-- Por que RPC e não agregação no cliente: `prospect` sozinho tem ~25k contatos
-- (a coluna legada contacts.classification veio com esse default), então baixar
-- as linhas pro browser pra contar seria inviável. Aqui volta só o agregado
-- + uma página de contatos.
--
-- Por que agrupar por chave normalizada: city/neighborhood/profession estão
-- gravados em formatos inconsistentes (ex.: "Desempregada"/"desempregada",
-- "Itapecuru-Mirim"/"Itapecuru mirim"). Sem normalizar, o mesmo valor aparece
-- várias vezes no detalhamento com a contagem quebrada.
--
-- Rollback:
--   DROP FUNCTION public.contact_classification_report(text,text,text,text,text,text,int,int);
--   DROP FUNCTION public.contact_classification_counts();
--   DROP FUNCTION public.contact_norm_key(text);
--   DROP INDEX public.idx_contacts_classifications_gin;

-- Chave de agrupamento: sem acento, sem caixa, sem pontuação/hífen.
CREATE OR REPLACE FUNCTION public.contact_norm_key(p text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    btrim(regexp_replace(lower(public.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g')),
    ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.contact_norm_key(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_classification_report(
  p_name         text,
  p_state        text DEFAULT NULL,
  p_city         text DEFAULT NULL,
  p_neighborhood text DEFAULT NULL,
  p_profession   text DEFAULT NULL,
  p_search       text DEFAULT NULL,
  p_limit        int  DEFAULT 60,
  p_offset       int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      c.id,
      c.full_name,
      c.phone,
      c.instagram_username,
      NULLIF(btrim(c.city), '')          AS city,
      NULLIF(btrim(c.state), '')         AS state,
      NULLIF(btrim(c.neighborhood), '')  AS neighborhood,
      NULLIF(btrim(c.profession), '')    AS profession,
      public.contact_norm_key(c.city)         AS city_key,
      public.contact_norm_key(c.state)        AS state_key,
      public.contact_norm_key(c.neighborhood) AS neighborhood_key,
      public.contact_norm_key(c.profession)   AS profession_key
    FROM public.contacts c
    WHERE c.deleted_at IS NULL
      -- status novo (array) OU coluna legada de status único
      AND (c.classification = p_name OR c.classifications @> ARRAY[p_name])
  ),
  -- Filtros chegam como CHAVE normalizada. '__none__' = "sem informação";
  -- NULL = dimensão não filtrada.
  filtered AS (
    SELECT * FROM base b
    WHERE (p_state        IS NULL OR (CASE WHEN p_state        = '__none__' THEN b.state_key        IS NULL ELSE b.state_key        = p_state        END))
      AND (p_city         IS NULL OR (CASE WHEN p_city         = '__none__' THEN b.city_key         IS NULL ELSE b.city_key         = p_city         END))
      AND (p_neighborhood IS NULL OR (CASE WHEN p_neighborhood = '__none__' THEN b.neighborhood_key IS NULL ELSE b.neighborhood_key = p_neighborhood END))
      AND (p_profession   IS NULL OR (CASE WHEN p_profession   = '__none__' THEN b.profession_key   IS NULL ELSE b.profession_key   = p_profession   END))
      AND (
        p_search IS NULL OR btrim(p_search) = '' OR
        concat_ws(' ', b.full_name, b.phone, b.city, b.state, b.neighborhood, b.profession, b.instagram_username)
          ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  facets AS (
    SELECT 'state' AS dim, state_key AS key, mode() WITHIN GROUP (ORDER BY upper(state)) AS label, count(*) AS n
      FROM filtered GROUP BY state_key
    UNION ALL
    SELECT 'city', city_key, mode() WITHIN GROUP (ORDER BY city), count(*)
      FROM filtered GROUP BY city_key
    UNION ALL
    SELECT 'neighborhood', neighborhood_key, mode() WITHIN GROUP (ORDER BY neighborhood), count(*)
      FROM filtered GROUP BY neighborhood_key
    UNION ALL
    SELECT 'profession', profession_key, mode() WITHIN GROUP (ORDER BY profession), count(*)
      FROM filtered GROUP BY profession_key
  ),
  facets_ranked AS (
    SELECT *, row_number() OVER (PARTITION BY dim ORDER BY n DESC, label NULLS LAST) AS rn
    FROM facets
  ),
  facets_json AS (
    SELECT dim, jsonb_agg(jsonb_build_object('key', key, 'label', label, 'count', n) ORDER BY rn) AS rows
    FROM facets_ranked WHERE rn <= 80 GROUP BY dim
  ),
  page AS (
    SELECT jsonb_agg(to_jsonb(f) ORDER BY f.full_name NULLS LAST) AS rows FROM (
      SELECT id, full_name, phone, instagram_username, city, state, neighborhood, profession
      FROM filtered ORDER BY full_name NULLS LAST
      LIMIT GREATEST(LEAST(COALESCE(p_limit, 60), 200), 1) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) f
  )
  SELECT jsonb_build_object(
    'total',    (SELECT count(*) FROM base),
    'filtered', (SELECT count(*) FROM filtered),
    'facets', jsonb_build_object(
      'state',        COALESCE((SELECT rows FROM facets_json WHERE dim = 'state'), '[]'::jsonb),
      'city',         COALESCE((SELECT rows FROM facets_json WHERE dim = 'city'), '[]'::jsonb),
      'neighborhood', COALESCE((SELECT rows FROM facets_json WHERE dim = 'neighborhood'), '[]'::jsonb),
      'profession',   COALESCE((SELECT rows FROM facets_json WHERE dim = 'profession'), '[]'::jsonb)
    ),
    'contacts', COALESCE((SELECT rows FROM page), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.contact_classification_report(text,text,text,text,text,text,int,int)
  TO anon, authenticated;

-- Contagem por status para o popup (1 chamada em vez de 1 COUNT por status).
CREATE OR REPLACE FUNCTION public.contact_classification_counts()
RETURNS TABLE (name text, contacts bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT cc.name,
         (SELECT count(*) FROM public.contacts c
           WHERE c.deleted_at IS NULL
             AND (c.classification = cc.name OR c.classifications @> ARRAY[cc.name])) AS contacts
  FROM public.contact_classifications cc
  ORDER BY cc.display_order;
$$;

GRANT EXECUTE ON FUNCTION public.contact_classification_counts() TO anon, authenticated;

-- Troca/remoção do status em massa, em UMA instrução.
-- p_to NULL = remover o status dos contatos (usado ao excluir a classificação).
-- Sem isso o cliente teria que emitir um UPDATE por contato — excluir 'prospect'
-- seriam ~25 mil requisições saindo do browser.
--
-- Rollback: DROP FUNCTION public.contact_classification_rewrite(text,text);
CREATE OR REPLACE FUNCTION public.contact_classification_rewrite(
  p_from text,
  p_to   text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_from IS NULL OR btrim(p_from) = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.contacts c
     SET classifications = CASE
           WHEN p_to IS NULL THEN array_remove(COALESCE(c.classifications, '{}'), p_from)
           ELSE COALESCE(
             (SELECT array_agg(DISTINCT x)
                FROM unnest(array_replace(COALESCE(c.classifications, '{}'), p_from, p_to)) x),
             '{}'
           )
         END,
         classification = CASE WHEN c.classification = p_from THEN p_to ELSE c.classification END,
         updated_at = now()
   WHERE c.deleted_at IS NULL
     AND (c.classification = p_from OR c.classifications @> ARRAY[p_from]);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contact_classification_rewrite(text,text) TO anon, authenticated;

-- Liberação de edição/exclusão dos status padrão (is_system = true).
-- Decisão do usuário em 06/08/2026: a gestão dos relacionamentos passa a ser
-- toda pelo popup, inclusive dos padrões. O aviso de impacto fica na UI.
--
-- Rollback:
--   DROP POLICY "Users can update classifications" ON public.contact_classifications;
--   DROP POLICY "Users can delete classifications" ON public.contact_classifications;
--   CREATE POLICY "Users can update non-system classifications" ON public.contact_classifications
--     FOR UPDATE USING (is_system = false);
--   CREATE POLICY "Users can delete non-system classifications" ON public.contact_classifications
--     FOR DELETE USING (is_system = false);
DROP POLICY IF EXISTS "Users can update non-system classifications" ON public.contact_classifications;
DROP POLICY IF EXISTS "Users can update classifications" ON public.contact_classifications;
CREATE POLICY "Users can update classifications"
  ON public.contact_classifications FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can delete non-system classifications" ON public.contact_classifications;
DROP POLICY IF EXISTS "Users can delete classifications" ON public.contact_classifications;
CREATE POLICY "Users can delete classifications"
  ON public.contact_classifications FOR DELETE USING (true);

-- contacts.classifications é filtrado por @> em toda consulta acima; sem GIN
-- vira seq scan em ~35k linhas a cada chamada.
-- ATENÇÃO: CONCURRENTLY não roda dentro de transação — aplicar em chamada isolada.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_classifications_gin
  ON public.contacts USING gin (classifications);
