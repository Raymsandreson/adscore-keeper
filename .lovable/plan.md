# Plano: Página de Caso + Busca por número

Vou combinar as duas abordagens: arquitetura limpa para casos (longo prazo) + atalho imediato para acessar casos órfãos como o CASO-369.

## O que será construído

### Parte 1 — Página dedicada `/casos/:id`
Pense numa "casa própria" do caso. Hoje o caso mora de favor dentro do lead; vamos dar endereço próprio para ele.

- Nova rota `/casos/:caseId` em `src/App.tsx`
- Novo arquivo `src/pages/CaseDetailPage.tsx` exibindo:
  - Cabeçalho: número do caso, status, núcleo, data de fechamento
  - Seção "Lead vinculado" (só renderiza se `lead_id` existir) com link para abrir o sheet do lead
  - Seção "Cliente/Contato" — nome, telefone, documentos
  - Seção "Processos judiciais" vinculados (reaproveita componentes já existentes)
  - Seção "Atividades" do caso
  - Seção "Documentos" (pasta Drive já vinculada)
- Quando `lead_id` for nulo, esconde a seção do lead sem quebrar nada — sem `if` espalhado no resto da tela.

### Parte 2 — Busca rápida "CASO-XXX" no header
Pense num GPS: digita o número, vai direto pro endereço.

- Adicionar campo de busca no header global (`src/components/Layout.tsx` ou equivalente)
- Reconhece padrões: `CASO-369`, `caso 369`, `369` (só dígitos com prefixo opcional)
- Faz query rápida em `legal_cases.case_number`
- Se achar → navega para `/casos/:id`
- Se não achar → toast "Caso não encontrado"

### Parte 3 — Religar pontos onde casos aparecem
Onde hoje clica num caso e tenta abrir lead inexistente:
- Lista de casos (`/casos`) → linha leva para `/casos/:id` (não mais para lead)
- Atividades vinculadas a caso sem lead → botão "Abrir caso" navega para `/casos/:id`
- Cards/listas que mostram número do caso → vira link clicável

## O que NÃO será mexido

- Estrutura do lead sheet (continua igual)
- Lógica de criação de caso (`generate_case_number`, trigger `auto_close_lead_on_case_creation`)
- Banco de dados — nenhuma migration necessária
- Métricas e dashboards (caso órfão já existe no banco, só ganha tela própria)
- Fluxo de leads com caso vinculado (continua abrindo pelo lead normalmente)

## Detalhes técnicos

- Reutilizar hooks existentes de busca de caso (provavelmente em `src/hooks/useLegalCases.ts` ou similar — vou checar)
- Página usa o mesmo layout/sidebar das outras páginas internas
- Busca no header debounced (300ms) para não martelar o banco
- Query da busca: `SELECT id, case_number FROM legal_cases WHERE case_number ILIKE $1 LIMIT 10` (índice em `case_number` se já não houver)

## Ordem de execução

1. Explorar arquivos existentes (lista de casos, hooks, rotas)
2. Criar `CaseDetailPage.tsx` com seções condicionais
3. Adicionar rota
4. Adicionar busca no header
5. Atualizar links na lista de casos e atividades órfãs
6. Testar com CASO-369 (sem lead) e um caso com lead vinculado

## Riscos e rollback

- Risco baixo: tudo é adição, não toca em fluxo existente
- Rollback: remover rota + arquivo novo + reverter 2-3 pontos de link
