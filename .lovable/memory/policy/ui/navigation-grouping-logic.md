---
name: Navigation Grouping Logic
description: Toda nova funcionalidade entra DENTRO do módulo pai existente (botão/aba/sub-menu), nunca solta no menu lateral
type: preference
---
Regra: ao adicionar nova tela/funcionalidade, primeiro identifique o módulo pai natural (Leads, Contatos, WhatsApp, Finanças, etc.) e coloque o acesso DENTRO dele (botão no header, aba, ou sub-link). Só vira item de primeiro nível no sidebar se for um módulo realmente novo e independente.

**Por quê:** menu lateral cresce rápido e vira sopa de letrinhas; usuário perde a lógica espacial do sistema.

**Como aplicar:**
1. Antes de editar `AppSidebar.tsx`, perguntar: "isso é submódulo de algo que já existe?"
2. Se sim → botão/aba na página pai (ex: Mapa de Leads → botão no header da Central de Leads)
3. Se não → confirmar com usuário antes de adicionar no sidebar
4. Manter agrupamento visual coerente: tudo de leads junto, tudo de WhatsApp junto, etc.
