## Diagnóstico (com evidência)

Rodei contagens reais agora:

| Fonte | Total | Últimos 30d | Assinados |
|---|---|---|---|
| **Supabase Externo** (`zapsign_documents`) | **300** | **135** | **174** |
| **Supabase Cloud** (mesma tabela espelhada) | 268 | ~133 | ~89 |
| Tela do card | 133 | — | 89 |
| Tela do sheet | 123 | — | — |

**Causa raiz:** tanto o card "Docs" quanto o sheet "Documentos Assinados" estão lendo do **Cloud** (`supabase.from('zapsign_documents')`), que está dessincronizado do Externo (drift de 32 docs no total, 85 nos assinados). Os vendedores estão certos — geraram/assinaram bem mais do que aparece. A fonte de verdade é o Externo (300 docs, 174 assinados).

A diferença 123 vs 133 entre card e sheet é timezone/janela: o card usa `dateRange` da página (label "30d"), o sheet usa `fromDate/toDate` próprios (04/04→04/05) — então cortam alguns docs de borda diferente. Quando trocarmos para a mesma fonte e a mesma janela, baterá.

Distribuição real por instância no Externo (300 docs):
`cris=122, sem instância=73, Prev. Edilan=59, Raym=19, Analyne=14, Viviane=8, João Pedro=2, Atendimento Previdenciário=1, Prudencred=1, Test=1`

Os 73 docs sem `instance_name` são justamente os que o vendedor gerou direto no painel ZapSign (sem usar o botão "Gerar documento" do CRM). É aí que entra o fallback que você pediu: cruzar `whatsapp_phone` do doc com `whatsapp_messages` do Externo para descobrir em qual instância o cliente conversou.

## Mudanças

### 1. `src/pages/ZapsignSyncPage.tsx`
- Trocar as duas queries do `useEffect` de `docCounts` de `supabase` (Cloud) para `externalSupabase` (Externo).
- Resultado esperado: card "Docs (30d)" passa a mostrar 135 total, 124 assinados, 11 pendentes (ou números atualizados na hora da execução).

### 2. `src/components/whatsapp/agent-monitor/components/OperationalDetailSheet.tsx` (bloco `signed_docs`, linhas 76–95)
- Trocar `supabase.from('zapsign_documents')` → `externalSupabase.from('zapsign_documents')`.
- Trocar também o `supabase.from('leads')` que enriquece o lead_name → `externalSupabase`.
- Adicionar campo `signed_at` ao select para podermos exibir/ordenar pela assinatura quando existir.
- **Novo: resolver instância via telefone para docs sem `instance_name`.** Antes do `setItems`, juntar todos os `whatsapp_phone` dos docs com `instance_name` nulo, e fazer 1 query batched no Externo:
  ```ts
  externalSupabase.from('whatsapp_messages')
    .select('phone, instance_name, created_at')
    .in('phone', phonesSemInstancia)
    .order('created_at', { ascending: false })
  ```
  Para cada telefone, escolher a instância com mais mensagens (mesma heurística do `lead-reprocess-procuracao`, com variantes 9º dígito). Anexar como `_resolved_instance` no item, exibida com tag "via chat" para deixar claro que é fallback.

### 3. Filtro por instância dentro do sheet
- Adicionar um `<Select>` no header do sheet (ao lado dos botões Hoje/7d/30d/90d) listando as instâncias presentes nos docs carregados (`cris`, `Prev. Edilan`, `Raym`, etc.) + opção "Sem instância" + opção "Todas".
- Filtragem usa `instance_name || _resolved_instance` — então o filtro também pega os docs gerados direto no ZapSign mas cuja conversa estava na instância selecionada.
- Mostrar contador filtrado no badge do header (já existe).

### 4. Exibição no card do doc
- Mostrar a tag da instância (com indicador "via chat" se veio do fallback) abaixo do nome do signer, para você bater olho e ver "ah, esse foi do João Pedro mesmo que não tenha botão".

## O que NÃO vai mudar
- Não toco no Cloud nem tento ressincronizar a tabela espelhada — trato direto na origem (Externo).
- Não toco em `zapsign_sync_runs` nem nos KPIs de "Contatos/Leads enriq./Grupos/Erros" (essas continuam vindo dos runs).
- Sem migrations, sem edge function nova.

## Verificação pós-deploy
1. Abrir o sheet com período 30d → conferir que "Todos" agora mostra ~135 (não 123).
2. Filtrar por instância "cris" → comparar com `cris=122` real.
3. Filtrar por "Sem instância" → ver os 73 docs e validar que `_resolved_instance` foi preenchido para a maioria.
