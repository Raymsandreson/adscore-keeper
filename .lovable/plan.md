## Contexto

Validei direto no banco externo (`kmedldlepwiityjsdahz`) que o lead da Eloah (`e67b6810-acfa-4440-b427-e1368883c2b4`) ficou correto em nome, telefone, CPF, cidade, UF, CEP, rua e número. Porém:

- **PDF não foi anexado** — a função tenta `ext.from("process_documents").insert(...)`, mas `process_documents` **só existe no Cloud, não no externo**. O insert falha silencioso e o contador `pdf_attached` mente.
- **Bairro vazio** — OCR não capturou.
- **Não dá pra gravar `process_documents` no Cloud** — porque `lead_id` tem FK pra `leads(id)` local, e o lead da Eloah só existe no externo.

A tabela `zapsign_documents` **existe no externo** com os campos certos (`lead_id`, `signer_name`, `signer_phone`, `signed_at`, `document_name`, etc.) e é o lugar nativo pra esse anexo.

---

## Mudanças

### 1. Corrigir `supabase/functions/zapsign-backfill-procurations/index.ts`

Substituir o bloco de anexo (linhas ~453–473) para:
- Inserir em `ext.from("zapsign_documents")` em vez de `process_documents`
- Mapear campos corretos (`document_name`, `signer_name`, `signer_phone`, `signed_at`, `doc_token`, `signed_file_url`/equivalente conforme schema real da tabela — vou ler `\d zapsign_documents` antes pra acertar nomes)
- Manter dedup por `doc_token = cand.token`
- Só incrementar `stats.pdf_attached` se o insert retornar sem erro (sem mais mentira)

### 2. Adicionar enriquecimento via ViaCEP

No mesmo loop de extração, quando `cep` foi extraído mas `bairro` veio vazio:
- `fetch("https://viacep.com.br/ws/<cep>/json/")` (sem auth, público)
- Se sucesso e `bairro` presente, preencher `enrich.neighborhood`
- Se ViaCEP devolver erro ou bairro vazio, segue sem (não bloqueia)

### 3. Reprocessar SÓ a Eloah em modo real

- Chamar a função com `single_token` da procuração da Eloah (mesma usada no dry_run anterior) e `dry_run: false`
- Validar com SQL direto no externo:
  - `SELECT * FROM zapsign_documents WHERE lead_id = 'e67b6810...'` — deve retornar 1 linha
  - `SELECT neighborhood FROM leads WHERE id = 'e67b6810...'` — deve estar preenchido
- Mostrar evidência antes de seguir pro lote

---

## O que NÃO vou mexer

- Outros leads já criados pelo dry_run (não foram, era simulação)
- Cloud `process_documents` (continua intocado — UI atual do CRM lê de lá, mas pra leads do externo precisaríamos de uma view/sync separado, fora do escopo agora)
- Lead antigo da Eloah `951978f9...` (Edilan) — fica pendente sua decisão (mesclar/deletar/manter)
- Função `zapsign-webhook` (fluxo realtime, não tem esse bug)

---

## Detalhes técnicos

- Antes de codar, vou rodar `\d zapsign_documents` no externo pra confirmar nomes exatos das colunas (signed_file_url vs signed_pdf_url etc.) — o `lov-tool-use` anterior já mostrou parte do schema mas não todas as colunas relevantes pro PDF.
- ViaCEP é gratuita, sem chave, ~50ms latência. Adiciono `try/catch` com timeout de 3s.
- Após editar a função, deploy com `supabase--deploy_edge_functions`.
- Teste com `supabase--curl_edge_functions` chamando com `{ single_token: "<token-eloah>", dry_run: false }`.
- Validação final via `psql "$EXTERNAL_DB_URL" -c "..."`.

---

## Próximo passo após aprovação

Reprocessar Eloah, te mostrar print do SQL confirmando PDF anexado + bairro preenchido, e aí você decide a escala do lote (10 / 50 / todos).