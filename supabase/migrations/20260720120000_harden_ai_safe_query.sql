-- Endurece public.ai_safe_query — executor SQL somente-leitura usado pelo
-- gerador de relatórios por IA (seção Relatórios).
--
-- Motivação (evidência): a versão anterior declarava v_allowed_tables mas NUNCA
-- o usava, e só bloqueava palavras-chave por regex (burlável por função volátil
-- dentro de um SELECT). Aqui a garantia real vira transação READ ONLY no nível
-- do banco: qualquer escrita (INSERT/UPDATE/DDL/função volátil que grave) é
-- recusada pelo próprio Postgres, mesmo sob SECURITY DEFINER.
--
-- Este objeto vive no Supabase Externo (kmedldlepwiityjsdahz). A função é órfã
-- (nenhum código a chamava antes), então endurecê-la não afeta fluxo existente.

CREATE OR REPLACE FUNCTION public.ai_safe_query(p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_clean_sql text;
  v_result jsonb;
  v_blocked_keywords text[] := ARRAY[
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE',
    'CREATE', 'GRANT', 'REVOKE', 'EXECUTE', 'CALL', 'COPY', 'MERGE',
    'REINDEX', 'VACUUM', 'CLUSTER', 'LOCK', 'DO'
  ];
  v_kw text;
  v_upper_sql text;
BEGIN
  -- Normaliza: tira espaços e ';' final (impede statement chaining).
  v_clean_sql := TRIM(TRAILING ';' FROM TRIM(p_sql));
  v_upper_sql := UPPER(v_clean_sql);

  -- 1) Bloqueia palavras-chave de modificação (defesa em profundidade).
  FOREACH v_kw IN ARRAY v_blocked_keywords LOOP
    IF v_upper_sql ~ ('\m' || v_kw || '\M') THEN
      RETURN jsonb_build_object(
        'error', 'forbidden_keyword',
        'keyword', v_kw,
        'message', format('Apenas leitura permitida. Palavra bloqueada: %s', v_kw)
      );
    END IF;
  END LOOP;

  -- 2) Deve começar com SELECT ou WITH.
  IF NOT (v_upper_sql ~ '^(SELECT|WITH)\s') THEN
    RETURN jsonb_build_object(
      'error', 'must_be_select',
      'message', 'A consulta precisa começar com SELECT ou WITH'
    );
  END IF;

  -- 3) Bloqueia esquemas/tabelas de sistema e segredos.
  IF v_upper_sql ~ '\m(AUTH\.|VAULT\.|SECRETS|PG_CATALOG\.|PG_SHADOW|PG_AUTHID|PG_USER\M|INFORMATION_SCHEMA\.)' THEN
    RETURN jsonb_build_object(
      'error', 'sensitive_blocked',
      'message', 'Acesso negado a esquemas de sistema/segredos (auth, vault, pg_catalog, information_schema)'
    );
  END IF;

  -- 4) Força um LIMIT de segurança se a consulta não tiver nenhum.
  IF v_upper_sql !~ '\mLIMIT\s+\d+' THEN
    v_clean_sql := v_clean_sql || ' LIMIT 1000';
  END IF;

  -- 5) Executa em transação SOMENTE-LEITURA + timeout. A trava read-only é a
  --    garantia principal: barra qualquer escrita no nível do Postgres.
  BEGIN
    SET LOCAL transaction_read_only = on;
    EXECUTE format('SELECT jsonb_agg(t) FROM (%s) t', v_clean_sql) INTO v_result;
    RETURN jsonb_build_object(
      'success', true,
      'rows', COALESCE(v_result, '[]'::jsonb),
      'count', COALESCE(jsonb_array_length(v_result), 0)
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'error', 'execution_error',
      'message', SQLERRM,
      'sql_state', SQLSTATE
    );
  END;
END;
$function$;
