
# Plano: Sistema Completo de Posts Externos com Vinculação a Leads

## Resumo dos Problemas Identificados

1. **Limite de comentários baixo**: Atualmente 500, precisa ser 2000
2. **Erro ao salvar comentários**: Os erros estão ocorrendo mesmo após criar o índice único
3. **Falta gerenciador de Posts Externos**: Não existe UI para usar a tabela `external_posts` já criada
4. **Falta vinculação com Leads**: Não há fluxo para criar/vincular leads a partir de posts

---

## Etapa 1: Corrigir Edge Function (Limite e Erros)

### Alterações em `fetch-apify-comments`
- Aumentar `resultsLimit` e `commentsPerPost` de 500 para **2000**
- Aumentar timeout do polling (mais comentários = mais tempo de processamento)
- Melhorar tratamento de erros no upsert (usar `INSERT ... ON CONFLICT` via SQL em caso de falha)
- Adicionar retorno do `external_posts` automaticamente ao buscar de uma URL

---

## Etapa 2: Criar Componente `ExternalPostsManager`

### Nova tela em Analytics > Comentários (aba "Posts Externos")

```text
┌──────────────────────────────────────────────────────────────────┐
│  [+ Adicionar Post]  [🔄 Atualizar]  [Buscar Comentários]        │
├──────────────────────────────────────────────────────────────────┤
│ Filtros: [Plataforma ▼] [Com Lead ▼] [Buscar...]                 │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 📷 Post: instagram.com/reel/DUTl24wDbgz                      │ │
│ │ Autor: @usuario123                                           │ │
│ │ Comentários: 55  |  Última busca: 04/02 às 10:45             │ │
│ │ Lead: [Vincular a Lead ▼] ou [✓ Acidente SP - João Silva]    │ │
│ │ Notícias: [+ Adicionar link de notícia]                      │ │
│ │           - g1.com/acidente-sp-janeiro                       │ │
│ │           - uol.com/tragedia-rodovia                         │ │
│ │ [📥 Ver Comentários]  [✏️ Notas]  [🗑️ Excluir]               │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Funcionalidades
- **CRUD de Posts Externos**: Adicionar URLs, editar metadados, excluir
- **Buscar Comentários**: Integrado com Apify (botão já existente, mas dentro do contexto do post)
- **Vincular a Lead**: Dropdown com leads existentes ou botão "Criar novo lead"
- **Gerenciar Notícias**: Array de links de notícias relacionadas ao caso
- **Notas**: Campo de texto livre para anotações
- **Filtros**: Por plataforma, por vínculo com lead, busca textual

---

## Etapa 3: Atualizar Painel de Comentários

### Adicionar filtro "Tipo de Post"
```text
[Postagens Próprias] [Postagens de Terceiros] [Todas]
```

### Melhorar exibição
- Mostrar preview da mídia (thumbnail) quando disponível
- Link clicável para o perfil do autor
- Badge indicando se é outbound/inbound

---

## Etapa 4: Integração com Sistema de Leads

### No dialog de "Adicionar Lead"
- Novo campo: **URL do Post de Origem** (opcional)
- Ao salvar, cria automaticamente entrada em `external_posts` vinculada

### No card de Lead (Kanban)
- Mostrar badge se tem post externo vinculado
- Botão para abrir detalhes do post

### Na visualização de Post Externo
- Botão "Criar Lead a partir deste post"
- Preenche automaticamente campos como `news_link`, `source`

---

## Arquivos a Criar/Modificar

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `supabase/functions/fetch-apify-comments/index.ts` | Modificar | Aumentar limites para 2000, melhorar error handling |
| `src/components/instagram/ExternalPostsManager.tsx` | Criar | Tela completa de gerenciamento de posts externos |
| `src/components/instagram/ExternalPostCard.tsx` | Criar | Card individual de post externo |
| `src/components/instagram/ExternalPostDialog.tsx` | Criar | Dialog para adicionar/editar post |
| `src/components/instagram/LinkLeadToPostDialog.tsx` | Criar | Dialog para vincular/criar lead |
| `src/components/instagram/CommentsAdminPanel.tsx` | Modificar | Adicionar filtro de tipo de post |
| `src/hooks/useExternalPosts.ts` | Criar | Hook para CRUD de external_posts |
| `src/pages/AnalyticsPage.tsx` | Modificar | Adicionar nova aba "Posts Externos" |

---

## Detalhes Técnicos

### Hook `useExternalPosts`
```typescript
// Operações principais
- fetchPosts(): Lista todos os posts externos com filtros
- addPost(url): Adiciona novo post e dispara busca de comentários
- updatePost(id, data): Atualiza metadados do post
- deletePost(id): Remove post (comentários permanecem)
- addNewsLink(id, link): Adiciona link de notícia ao array
- linkToLead(postId, leadId): Vincula post a lead existente
- fetchCommentsForPost(postId): Dispara Apify para buscar comentários
```

### Fluxo de Criação de Lead a partir de Post
1. Usuário clica "Criar Lead" no card do post
2. Abre dialog de criação de lead com campos pré-preenchidos:
   - `source`: "external_post"
   - `news_link`: URL do post
   - `notes`: Links de notícias concatenados
3. Ao salvar, atualiza `external_posts.lead_id` automaticamente

### Correção do Upsert
```typescript
// Usar upsert mais robusto
const { error } = await supabase
  .from("instagram_comments")
  .upsert(commentData, {
    onConflict: "comment_id",
    ignoreDuplicates: true, // Ignora se já existir em vez de falhar
  });
```

---

## Ordem de Implementação

1. **Corrigir Edge Function** (limite 2000 + error handling)
2. **Criar hook useExternalPosts**
3. **Criar componente ExternalPostsManager** com cards
4. **Adicionar aba em Analytics**
5. **Criar dialogs de vinculação com Lead**
6. **Atualizar filtros no CommentsAdminPanel**
