# Páginas soltas viram UM documento (agrupamento automático)

**Onde aparece:** aba Documentos do lead (`LeadDocumentsTab`) e pasta do lead no Google Drive.

## O problema

Duas etapas do pipeline olhavam um arquivo por vez, e nenhuma via os vizinhos:

1. `supabase/functions/import-group-docs-to-lead/index.ts` sobe **uma mídia do WhatsApp = um arquivo do Drive**. Laudo mandado em 10 fotos = 10 arquivos.
2. `supabase/functions/lead-drive/index.ts` → `analyze_file` classifica e renomeia **um arquivo por vez**. Como cada página é julgada sozinha, cada uma se declara `document_subtype: "único"`.

Resultado visível (pasta "Luiza - adccab03", set/2026): dois `Laudo Pericial — (único).bin`, duas `Guia de Encaminhamento` do mesmo menor, RG sem frente-e-verso junto.

É o mesmo defeito que `consolidate_lead_fields` já tinha resolvido para os campos do CRM — ali a solução foi uma fase 2 que lê o dossiê inteiro de uma vez. Aqui a fase 2 é o agrupamento.

## Como funciona agora

### 1. Candidatos (determinístico) — `supabase/functions/_shared/agrupamentoDocumentos.ts`

Agrupa por `tipo de documento × titular`, usando a análise IA já gravada no `description` do arquivo do Drive (cache: não gasta Gemini de novo). Página sem titular entra no grupo do mesmo tipo que tem titular — a IA costuma ler o nome só na primeira folha do laudo. Arquivo sozinho não vira candidato, então lead sem páginas separadas não chama IA nenhuma.

### 2. Decisão (IA) — `lead-drive`, action `group_documents`

A IA recebe **todos os candidatos numa chamada só** (`gemini-2.5-flash`, metadados + análises, sem reenviar imagem) e devolve grupos com ordem, confiança e motivo. Custo: ordem de fração de centavo por lead.

### 3. Porteiro (determinístico) — `classificarGrupos`

A IA sugere; quem decide agrupar **sozinho** são estas regras:

| Regra | Por quê |
|---|---|
| confiança `alta` | qualquer dúvida vira confirmação manual |
| 2+ arquivos válidos | grupo de um não é grupo |
| sem titulares conflitantes | laudo de duas pessoas nunca vira um PDF só |
| tipo específico (nunca `Foto`/`Outro`) | "Foto" é o balaio do não identificado — cinco fotos distintas não são um documento de cinco páginas |
| páginas em sequência (≤1h) **ou** com "página X de Y" | páginas mandadas com dias de distância provavelmente são documentos diferentes |

Reprovou em alguma? **Não some**: vai para a faixa amarela na aba Documentos, com o motivo do rebaixamento, esperando confirmação de um clique.

### 4. Ordem das páginas — `ordenarPaginas`

`"página X de Y"` (nome ou descrição) > hora de **envio no WhatsApp** > nome em ordem natural.

O envio vem de `process_documents.metadata.sent_at` (gravado no import) e, para os registros antigos, de uma query única em `whatsapp_messages` pelo `external_message_id`. `modifiedTime` do Drive **não serve**: é a hora em que o import rodou, em lotes de 5, o que embaralha a sequência.

### 5. Originais

Nunca são apagados: vão para a subpasta **"Páginas soltas"** dentro da pasta do lead. Agrupamento errado tem volta.

⚠️ A action `flatten_subfolders` do `lead-drive` joga o conteúdo de todas as subpastas de volta na raiz — se algum dia for chamada, desfaz a arrumação. Hoje nenhum ponto do front a chama.

## Disparo

- **Automático**, 1x por sessão por lead, quando a aba Documentos carrega com 2+ arquivos (guarda em `sessionStorage`: `auto-agrupar-docs:v1:<leadId>`).
- **Manual**, botão "Unificar páginas" na barra da aba.
- Idempotente: o que virou PDF saiu da raiz, logo não reentra na roda.

## O `.bin` que sumia do PDF

Mídia do WhatsApp sem `fileName`/`mimetype` no metadata vira `doc-XXXX.bin` + `application/octet-stream`. O merge antigo descartava esses arquivos como "mime não suportado" — a página ficava de fora do PDF **sem aviso**. Agora `formatoParaPdf` olha os **primeiros bytes** (`%PDF`, `FF D8 FF`, `89 50 4E 47`) antes de acreditar no mimetype declarado.

Não foi medido quantos arquivos em produção estão nessa situação (esta sessão não teve acesso de SQL ao banco).

## Testes

`src/lib/__tests__/agrupamentoDocumentos.test.ts` — 19 casos, incluindo o cenário real da pasta da Luiza, titulares diferentes, "Foto" com confiança alta e páginas com dias de distância.

## O que ainda não foi verificado em produção

O deploy das edge functions (`lead-drive`, `import-group-docs-to-lead`) e a execução contra um lead real ainda não aconteceram no momento em que este documento foi escrito. Antes de considerar entregue: rodar num lead com laudo de várias páginas e conferir o PDF montado e a subpasta "Páginas soltas".
