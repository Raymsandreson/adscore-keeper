## Objetivo

Tirar a dependência do token Meta e usar a planilha oficial (`LEADS FORMULÁRIO BPC-LOAS`) como fonte real de quantos leads chegaram, quais são viáveis vs inviáveis e quais ainda não escreveram no WhatsApp.

## Fonte de dados — Google Sheets

Planilha: `1EXB6oFovhX2LOHsC2X20LFk-JVIkjk-NR5Er4cUn6Qw`  
Abas (uma por atendente): `LEADS ISRAEL`, `LEADS CRIS`, `LEADS MATEUS`, `LEADS EDILAN`, `LEDS KAROLYNE`

Colunas relevantes detectadas:
- `id`, `created_time`, `campaign_id`, `campaign_name`, `form_name`, `is_organic`, `platform`
- `nome_completo`, `telefone`, `estado_civil`
- `você_possui_filho_autista_ou_conhece_alguém_autista_?`
- `possui_laudo_médico_ou_relatório_escolar_?`
- `qual_a_sua_renda_familiar_?`
- `possui_advogado_?`
- `qual_o_seu_número_de_contato_?`
- `lead_status` (CREATED, ok, ctt errado, etc.)

Conector Google Sheets já está conectado a este projeto. ✅

## O que vai mudar

### 1. Custom fields no funil "BPC - Autismo"
Criar 7 campos personalizados (escopo = board BPC - Autismo) que correspondem 1:1 às perguntas do form Meta:
- Filho autista / conhece autista (select)
- Laudo médico ou relatório escolar (select)
- Renda familiar (select)
- Possui advogado (select)
- Estado civil (text)
- Campanha de origem (text — preenche `campaign_name`)
- ID do lead no form Meta (text — chave de deduplicação)

### 2. Edge function `sheets-bpc-sync` (Railway)
Job que roda a cada 60s:
1. Lê as 5 abas via Google Sheets API (gateway)
2. Normaliza telefone (`p:+5537...` → `5537...`)
3. Para cada linha nova (chave = `id` do form):
   - Procura lead existente no Externo pelo telefone
   - Se não existe → cria lead no board BPC - Autismo, com `source='meta_form_sheet'`, status inicial = "Novo"
   - Se existe → só atualiza os custom fields
4. Marca `responded_whatsapp = true` quando há mensagem em `whatsapp_messages` com aquele telefone
5. Marca `unviable = true` quando `lead_status` na planilha = "ctt errado" ou similar

### 3. Hook novo `useBpcFormLeads`
Frontend lê uma RPC nova `get_bpc_form_metrics(period)` que devolve:
- `total` — quantos vieram do form no período
- `unviable` — quantos marcados inviável
- `to_call_now` — preencheram form e NÃO mandaram WhatsApp ainda
- `already_in_whatsapp` — preencheram E já escreveram
- `leads` — lista completa pros sheets de detalhe

### 4. UI — `FocusDashboard.tsx` (modo compact, que é o da sua tela)

**Card "INVIÁVEIS" (circulado) vira "VIÁVEIS":**
```
🏆 VIÁVEIS
47/3
total / inviável
```
Clicar abre sheet com a lista da planilha.

**Card novo "LIGAR AGORA" ao lado:**
```
📞 LIGAR AGORA  🔥
12
preencheram e sumiram
```
Cor vermelha/laranja (urgência). Clicar abre sheet com nome+telefone+data do form de quem preencheu e não mandou WA.

### 5. Sheet detalhe `BpcFormLeadsSheet`
Componente novo, estilo `ClosedLeadsSheet`, com 3 abas: Todos | Ligar agora | Inviáveis.  
Cada linha: nome, telefone (com botão CallFace), data do form, campanha, status, badge "no WhatsApp" se aplicável.

## O que NÃO vai mudar

- Token Meta continua intacto (ainda usado pra investimento/CPL, só não pra contagem de lead)
- Card Fechados, Docs, Sem resp., Atrasadas, Assinatura, Ranking — mantidos como estão
- `BMConnection.tsx` (status do token) — fica
- Tabelas existentes de leads, contatos, mensagens — nada de schema novo no core

## Custos e performance

- 5 chamadas `GET values` por minuto = 7.200 calls/dia → bem abaixo do limite do Google Sheets API (60k/min/projeto)
- Cada call retorna ~1.300 linhas × 21 colunas ≈ 80KB; total ~400KB/min
- Frontend faz 1 RPC só (não consulta a planilha direto)

## Plano de execução

1. **Criar custom fields no board BPC - Autismo** (run-external-migration via SQL INSERT em `lead_custom_fields`)
2. **Edge function `sheets-bpc-sync`** no Railway + pg_cron 60s no Externo
3. **RPC `get_bpc_form_metrics`** no Externo
4. **Hook + Sheet novo** no frontend
5. **Substituir card Inviáveis + adicionar card Ligar agora** em `FocusDashboard.tsx`
6. **Verificar**: rodar sync manual, ver contadores aparecerem, abrir um lead e conferir custom fields

## Rollback

- Reverter `FocusDashboard.tsx` (1 arquivo) volta UI ao estado atual
- `DROP FUNCTION get_bpc_form_metrics` + `cron.unschedule('sheets-bpc-sync')` desliga o pipeline
- Custom fields novos não quebram nada se ficarem (são opcionais)
