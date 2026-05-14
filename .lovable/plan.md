## Escopo

Duas entregas independentes:

### 1) Tipo de campo "Senha" para campos personalizados do lead
Tipo novo que mostra `••••••••` por padrão, com botão de olho pra revelar e botão de copiar pra colar no gov.br sem precisar enxergar. Armazenado em `value_text` (sem mudança de schema). Funciona em qualquer aba/funil.

### 2) "Personalizar" no formulário do contato (igual ao do lead)
Botão "Personalizar" no `ContactDetailSheet` abrindo um editor espelho do `LeadFieldsUnifiedEditor`, com:
- Criar / editar / excluir abas customizadas (além das fixas Info, Chamadas, Histórico, Local, Grupos, Vínculos, Leads, IA)
- Criar / editar / excluir campos por aba, com todos os tipos (texto, número, data, seleção, checkbox, link, **senha**)
- Reordenar abas e campos
- Renderizar os campos customizados na aba correspondente do contato

## O que vai mudar

### Banco (Supabase Externo, via `run-external-migration`)

```sql
CREATE TABLE contact_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name text NOT NULL,
  field_type text NOT NULL,       -- text|number|date|select|checkbox|url|password
  field_options jsonb DEFAULT '[]',
  is_required boolean DEFAULT false,
  display_order int DEFAULT 0,
  tab text DEFAULT 'info',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE contact_custom_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  field_id uuid NOT NULL REFERENCES contact_custom_fields(id) ON DELETE CASCADE,
  value_text text,
  value_number numeric,
  value_date date,
  value_boolean boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(contact_id, field_id)
);

CREATE TABLE contact_tab_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_key text NOT NULL UNIQUE,
  label text NOT NULL,
  display_order int DEFAULT 0,
  hidden boolean DEFAULT false,
  is_custom boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_contact_custom_field_values_contact ON contact_custom_field_values(contact_id);
```

Sem `board_id` (contato é global). Sem RLS extra (mesmo padrão das tabelas atuais de contato no Externo).

### Código

**Senha (lead, mudança pequena):**
- `src/hooks/useLeadCustomFields.ts` — adicionar `'password'` ao type `FieldType`.
- `src/components/leads/CustomFieldsForm.tsx` — render `password` (input `type="password"` + olho + copiar via `navigator.clipboard`).
- `src/components/leads/LeadFieldsUnifiedEditor.tsx` — opção "Senha" no seletor de tipo.

**Contato (novo):**
- `src/hooks/useContactCustomFields.ts` — espelho do hook do lead, sem `board_id`.
- `src/hooks/useContactTabLayout.ts` — espelho do `useLeadTabLayout`.
- `src/components/contacts/ContactFieldsUnifiedEditor.tsx` — espelho do `LeadFieldsUnifiedEditor` adaptado pra contato.
- `src/components/contacts/ContactCustomFieldsForm.tsx` — render dos campos por aba (reusa `CustomFieldInput` do lead, que ganha suporte a `password`).
- `src/components/contacts/ContactDetailSheet.tsx` — botão "Personalizar" no header + render das abas customizadas + persistência dos valores ao salvar.

### O que NÃO vai mudar
- Layout das abas fixas atuais do contato (Info / Chamadas / Histórico / Local / Grupos / Vínculos / Leads / IA) — só ganham companhia das customizadas.
- Banco Lovable Cloud (proibido por política — tudo no Externo).
- Forms do lead (nada além do tipo senha).
- Schema de `lead_custom_fields` (senha cabe em `value_text`).

### Risco / rollback
- Tabelas novas isoladas; rollback = `DROP TABLE contact_custom_fields, contact_custom_field_values, contact_tab_layouts CASCADE;`.
- "Senha" é só máscara visual — quem tem acesso ao registro tem acesso ao valor. Não é criptografia real (não dá pra ser, porque o gov.br precisa do valor em claro pra colar). Vou deixar isso explícito no tooltip do campo pra você não confundir com cofre de senhas.
