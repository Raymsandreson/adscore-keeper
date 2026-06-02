## Objetivo

Setar `leads.acolhedor` automaticamente nos **dois pontos onde o grupo é vinculado**, em vez de depender da função de faxina (`backfill-acolhedor-from-group-owner`).

## Onde plugar

**Ponto 1 — Grupo criado pelo bot (pós-ZapSign)**
- Arquivo: `supabase/functions/create-whatsapp-group/index.ts`
- Já existe `creatorInstance.instance_name` (a instância que criou o grupo é o dono óbvio).
- Mudanças:
  - Ao inserir/atualizar `lead_whatsapp_groups`, gravar também `instance_name: creatorInstance.instance_name` (coluna já existe, hoje fica `null`).
  - Se `leadData.acolhedor` for nulo/vazio e a instância criadora **não** for compartilhada (lista `SHARED_INSTANCES`), mapear via `INSTANCE_TO_OPERATOR` e fazer `UPDATE leads SET acolhedor=... WHERE id=lead_id AND acolhedor IS NULL`.

**Ponto 2 — Usuário cola link manualmente no `LeadEditDialog`**
- Arquivo: `src/components/kanban/LeadEditDialog.tsx`, dentro do `handleSave`, logo depois do `insert` em `lead_whatsapp_groups` (linha ~1119) e do `onSave` do lead (linha ~1148).
- Após salvar, se o lead não tem `acolhedor`, dispara fire-and-forget:
  - `cloudFunctions.invoke('backfill-acolhedor-from-group-owner', { body: { lead_id: currentLead.id } })`
- Não bloqueia UI, não espera resposta. A função já varre todas as instâncias agora (fix anterior) e atualiza no banco.

## Fonte única do mapeamento

Extrair `SHARED_INSTANCES` e `INSTANCE_TO_OPERATOR` de `backfill-acolhedor-from-group-owner/index.ts` para `supabase/functions/_shared/instance-operator-map.ts`. Tanto o backfill quanto o `create-whatsapp-group` importam dali. Zero duplicação.

## Idempotência

Os dois pontos só escrevem quando `acolhedor IS NULL`. Se o usuário já preencheu manualmente, o automático respeita.

## Metáfora

Hoje o porteiro do prédio é uma faxineira que passa de vez em quando anotando quem mora. Vamos colocar um porteiro fixo na portaria que anota na hora que o grupo é criado, e um sininho automático na recepção quando alguém cola o link manual. A faxineira continua existindo só pra emergência.

## Arquivos tocados

- novo: `supabase/functions/_shared/instance-operator-map.ts`
- editar: `supabase/functions/backfill-acolhedor-from-group-owner/index.ts` (importar do shared)
- editar: `supabase/functions/create-whatsapp-group/index.ts` (gravar instance_name + setar acolhedor)
- editar: `src/components/kanban/LeadEditDialog.tsx` (disparar backfill após save)
