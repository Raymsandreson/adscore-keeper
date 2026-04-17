

## Plano: Edge function de execução única para otimizar `get_conversation_summaries` no banco externo

### Objetivo
Criar uma edge function que conecta no Supabase Externo (`kmedldlepwiityjsdahz`) via `EXTERNAL_DB_URL`, cria os índices necessários e substitui a função `get_conversation_summaries` por uma versão otimizada — eliminando o timeout `57014` que está zerando a lista de conversas.

### Causa raiz (já diagnosticada via 5 Porquês)
A função atual no externo:
- usa `LOWER(m.instance_name)` no WHERE → invalida índices em `instance_name`
- faz `DISTINCT ON (phone, instance_name) ORDER BY ... created_at DESC` sem índice composto adequado
- varre `whatsapp_messages` inteira duas vezes (CTE `latest` + CTE `counts`)

Resultado: timeout de 8s do PostgREST → front recebe erro → `setConversations([])` → conversas somem.

### O que a edge function vai executar no banco externo

**1. Índices**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_inst_phone_created
  ON whatsapp_messages (instance_name, phone, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_inst_lower
  ON whatsapp_messages (LOWER(instance_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wam_unread
  ON whatsapp_messages (instance_name, phone)
  WHERE direction = 'inbound' AND read_at IS NULL;
```

**2. Função otimizada** (uma única varredura, janela de 90 dias casando com `cleanup_old_whatsapp_messages`)
```sql
CREATE OR REPLACE FUNCTION public.get_conversation_summaries(p_instance_names text[])
RETURNS TABLE(...) -- mesma assinatura
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH normalized AS (
    SELECT LOWER(unnest(p_instance_names)) AS name
  ),
  base AS (
    SELECT m.*
    FROM whatsapp_messages m
    WHERE LOWER(m.instance_name) IN (SELECT name FROM normalized)
      AND m.created_at > now() - interval '90 days'
  ),
  agg AS (
    SELECT
      phone, instance_name,
      COUNT(*) AS msg_count,
      COUNT(*) FILTER (WHERE direction='inbound' AND read_at IS NULL) AS unread,
      MAX(created_at) AS last_at
    FROM base
    GROUP BY phone, instance_name
  ),
  latest AS (
    SELECT DISTINCT ON (b.phone, b.instance_name)
      b.phone, b.contact_name, b.contact_id::text, b.lead_id::text,
      b.message_text, b.created_at, b.direction, b.instance_name
    FROM base b
    ORDER BY b.phone, b.instance_name, b.created_at DESC
  )
  SELECT l.phone,
         COALESCE(NULLIF(l.contact_name,''), c.full_name, '') AS contact_name,
         COALESCE(l.contact_id,'') , COALESCE(l.lead_id,''),
         l.message_text, l.created_at, l.direction, l.instance_name,
         COALESCE(a.unread,0), COALESCE(a.msg_count,0)
  FROM latest l
  LEFT JOIN agg a USING (phone, instance_name)
  LEFT JOIN contacts c ON c.id::text = l.contact_id
  ORDER BY l.created_at DESC;
$$;
```

**3. Reload do schema cache do PostgREST** (`NOTIFY pgrst, 'reload schema'`).

### Arquivos a criar
- `supabase/functions/apply-external-perf-indexes/index.ts` — conecta via `postgresjs` usando `EXTERNAL_DB_URL` (secret já existente), executa cada statement, retorna JSON com sucesso/erro por statement. Padrão idêntico ao já usado em `run-external-migration/index.ts`.
- Sem entrada em `supabase/config.toml` (deploy padrão basta).

### Como o usuário roda
Uma chamada via curl ou pelo painel:
```
POST /functions/v1/apply-external-perf-indexes
```
Sem body. A função executa tudo, retorna o relatório, e pode ser deletada depois.

### Observação importante
- Não toca em Lovable Cloud DB nem em código do front — só infra do banco externo.
- `CREATE INDEX CONCURRENTLY` não bloqueia tabela.
- Custo: ~1 execução, segundos. Resultado: queries que hoje dão timeout passam a responder em ms.
- Não inclui o ajuste no `useWhatsAppMessages.ts` (catch não-destrutivo) — se quiser, peço como passo seguinte.

