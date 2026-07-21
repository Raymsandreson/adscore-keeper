# Documentação funcional do sistema

Documentação de todas as seções do sistema: propósito de cada tela, funcionalidades, o que cada botão faz e o fluxo de uso recomendado.

## Finalidade

1. **Guia in-app** — o conteúdo de `src/config/featureGuides.ts` (popup exibido ao entrar em cada seção) é derivado destes documentos. Ao mudar uma tela, atualizar o documento do módulo e o guia juntos.
2. **Base para proteção de propriedade intelectual** — descrição funcional do sistema e do método de trabalho, utilizável como anexo técnico em registro de programa de computador no INPI (Lei 9.609/98) e como prova de anterioridade/autoria.

## Módulos

- [Atividades e produtividade](atividades.md) — registro de atividades, cronômetro, ditado por voz, banco de horas, telão, ranking
- [Leads e CRM](leads-crm.md) — kanban de leads, acolhimento, contatos, casos, funis, mapa
- [Processual](processual.md) — processos, audiências, acompanhamento, BPC, procurações, núcleos
- [Comunicação e gestão](comunicacao-gestao.md) — WhatsApp, chat da equipe, campanhas, relatórios IA, equipe, analytics, financeiro, configurações

## Observação sobre propriedade intelectual (Brasil)

- **Código-fonte**: protegido por direito autoral automaticamente (Lei 9.609/98). O **registro de programa de computador no INPI** é opcional, barato e serve como prova de autoria e data — recomendado.
- **Método de negócio** em si (o "jeito de trabalhar") **não é patenteável** no Brasil (Lei 9.279/96, art. 10) — métodos comerciais puros ficam fora de patente. A proteção prática vem do conjunto: registro do software, marca registrada, segredo de negócio (contratos de confidencialidade com a equipe) e esta documentação datada.
- Esta documentação, versionada em git com histórico de commits, ajuda a demonstrar anterioridade e autoria.
