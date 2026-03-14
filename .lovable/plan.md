

# Plano: Edição de Atalhos + Validação de Dados na Geração de Documentos

## Problema 1: Atalhos não são editáveis
A tab "Atalhos" só permite criar e deletar. Não há botão de edição nem formulário para modificar um atalho existente.

## Problema 2: Documento gerado sem todos os dados
O template ZapSign tem campos como `{{Nome Cliente Maior de idade}}`, `{{estado civil}}`, `{{profissão}}`, `{{Rua/Quadra/Logradouro}}`, `{{Bairro}}`, `{{Cidade}}`, `{{Estado}}`, `{{CEP}}`, etc. O sistema confia na IA para decidir `all_collected: true`, mas a IA pode marcar prematuramente. Falta uma validação server-side que compare os campos coletados com os campos obrigatórios do template antes de gerar.

---

## Alterações

### 1. Adicionar edição de atalhos (`WhatsAppCommandConfig.tsx`)

Na `ShortcutsTab`:
- Adicionar estado `editingId` para controlar qual atalho está em edição
- Botão de editar (ícone lápis) em cada card de atalho
- Ao clicar, preenche o formulário com os dados existentes
- O `handleSave` passa a fazer `upsert` ou detectar se é insert/update baseado em `editingId`
- Campos editáveis: nome, descrição, token do template, nome do template, instruções do prompt

### 2. Validação server-side no collection processor (`wjia-collection-processor/index.ts`)

Antes de gerar o documento (quando `result.all_collected === true`):
- Comparar `updatedFields` com `session.required_fields` (já salvo na sessão)
- Verificar se cada campo obrigatório do template tem um valor preenchido (não vazio)
- Se faltar algum campo, **não gerar** o documento — forçar `status: "collecting"` e enviar mensagem pedindo os dados faltantes
- Isso impede a IA de gerar prematuramente

### 3. Melhoria no prompt do collection processor

Adicionar ao prompt do sistema a lista explícita dos campos do template (de `session.required_fields`) para que a IA tenha clareza total sobre o que precisa coletar, reduzindo falsos positivos de `all_collected`.

---

## Arquivos a editar
1. `src/components/whatsapp/WhatsAppCommandConfig.tsx` — adicionar edição inline de atalhos
2. `supabase/functions/wjia-collection-processor/index.ts` — validação server-side antes de gerar documento

