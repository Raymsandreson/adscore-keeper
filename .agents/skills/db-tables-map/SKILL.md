---
name: db-tables-map
description: Use ANTES de criar tabela, coluna, hook, função ou feature que toca dados de negócio (lead, contato, grupo whatsapp, atividade, processo jurídico, financeiro, métrica, etc.). Obriga checar se já existe tabela/coluna/relação que resolve, em vez de duplicar. Acione quando ouvir "criar tabela", "salvar X no banco", "preciso guardar", "armazenar", "persistir", "novo campo", "nova entidade", ou quando for desenhar qualquer fluxo que envolva persistência.
---

# Mapa de Tabelas — Anti-Duplicação

Metáfora: antes de cavar poço novo, olhe a planta da obra. Esta skill é a planta.

## Regra dura

PROIBIDO propor `CREATE TABLE`, novo campo, ou nova lógica de persistência SEM antes:

1. Rodar `scripts/list-tables.sh` para listar tabelas vivas (Cloud + Externo)
2. Procurar nas referências abaixo se já existe solução
3. Citar no plano: "verifiquei X, Y, Z — não existe equivalente" OU "existe `tabela.coluna`, vou reutilizar"

Se pular esses passos, está violando a skill.

## Hot list — tabelas que JÁ resolvem problemas comumente reinventados

Leia `references/known-reusables.md`. Casos clássicos:

- Nome de grupo WhatsApp → `whatsapp_groups_index` (sync diário mantém atualizado). NÃO chame UazAPI direto, NÃO crie cache novo.
- Vínculo lead↔grupo → `lead_whatsapp_groups` (já tem `group_name` para snapshot).
- Vínculo lead↔contato → `contact_leads` (com `relationship_type`).
- Histórico de mensagens → `whatsapp_messages` (Externo). Não criar tabela paralela de "conversation_log".
- Custom fields por entidade → `lead_custom_fields` + `lead_custom_field_values`. Use isso antes de `ALTER TABLE leads ADD COLUMN`.
- Form layouts → `form_layout_tabs` + `form_layout_fields`. Não hardcode layout em componente novo.
- Atribuição agente↔etapa → `agent_stage_assignments`.
- Permissões por instância → `whatsapp_instance_users`. Permissões por módulo → `member_module_permissions`.

## Decisão antes de criar

```
Preciso guardar/buscar dado X?
│
├─ É dado de negócio (lead, contato, mensagem, processo, financeiro)?
│   └─ vai no EXTERNO. Cloud é só auth/metadata.
│
├─ Já existe tabela cujo nome contém o domínio? (rode o script)
│   ├─ SIM → leia colunas. Cabe campo novo lá? FK basta?
│   └─ NÃO → confirme com referências/domain-map.md
│
├─ É relação N↔N entre coisas existentes?
│   └─ Tabela de junção, não tabela "rica" nova.
│
└─ Só agora, se nada serve: proponha CREATE TABLE com GRANTs.
```

## Forms e hooks (NÃO duplicar também)

Mesma regra vale para componentes. Antes de criar `NewXDialog`:
- Procure `<Entidade>Form` existente (memory `unified-form-architecture`).
- Procure hook `use<Entidade>` em `src/hooks/`.
- Procure página `pages/<Entidade>Page.tsx`.

Variações = props, nunca fork.

## Referências

- `references/known-reusables.md` — tabelas frequentemente reinventadas, com colunas-chave.
- `references/domain-map.md` — tabelas agrupadas por domínio (CRM, WA, Jurídico, Financeiro, Equipe).
- `scripts/list-tables.sh` — dump ao vivo das tabelas (Cloud + Externo).

## Pós-uso

Quando descobrir uma tabela/coluna que resolveu um problema e que você NÃO conhecia, atualize `references/known-reusables.md` na mesma sessão. A skill só fica útil se crescer.
