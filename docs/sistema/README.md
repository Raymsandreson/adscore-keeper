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
- [Chat interno da equipe](chat-interno.md) — de quem é a conversa de cada ficha (a da atividade é a do processo), menções e para onde elas levam
- [Financeiro no processo e na atividade](financeiro-processo-atividade.md) — onde lançar despesa/receita de cliente e como o lançamento sobe para processo, caso e lead
- [Dom — Assessor Jurídico Virtual](dom-assessor-virtual.md) — atendente virtual que responde o cliente no grupo do caso com o andamento real dos autos: as três travas, o isolamento por grupo, como ele fala e o que ainda falta
- [Dom — o que muda antes de religar](dom-reformular-atividades.md) — levantamento dos 512 rascunhos e das 133 atividades que ele abriu antes da suspensão: por que a máquina se contradiz em 4 de cada 5 casos e as sete mudanças que precedem qualquer religamento
- [Open Finance / Celcoin](open-finance-celcoin.md) — conciliação bancária que substitui a Pluggy: caminhos versionados, janela de datas, consentimento PJ e o que ainda falta conectar
- [Data Stone — enriquecimento cadastral](datastone-enriquecimento.md) — telefone do lead vira CPF e dados cadastrais: o que a API devolve de verdade, as três travas e por que o gate de nome evitou 22 gravações erradas em 41
- [Liberar acesso de uma pessoa](acesso-de-usuario.md) — criar acesso direto ou convite pela tela Equipe, qual perfil dá o quê, e os dois bloqueios que parecem o mesmo ("acesso desativado" × "Acesso Restrito")

### Aquisição: do anúncio ao caso fechado

O caminho completo de um lead pago, do formulário no anúncio até a conversão
devolvida à Meta. Ler nesta ordem:

- [Planilhas de Lead Ads → funil](planilhas-lead-ads.md) — como o lead sai do formulário e vira card pela planilha do Google: abas, dedup, cabeçalho e o que o leitor descarta
- [Lead da Meta direto no funil](meta-leads-direto.md) — o mesmo lead pela Graph API, sem depender da planilha; os dois caminhos convivem e o dedup é quem impede a duplicata
- [Meta Conversions API](meta-conversions-api.md) — o fechamento no CRM voltando à Meta como conversão: a fila, o reconciliador, o dataset certo e o piloto de Conversion Leads
- [Aba Métricas](aba-metricas.md) — investimento, leads e fechamentos na mesma tela, e as regras que impedem número inventado

## Observação sobre propriedade intelectual (Brasil)

- **Código-fonte**: protegido por direito autoral automaticamente (Lei 9.609/98). O **registro de programa de computador no INPI** é opcional, barato e serve como prova de autoria e data — recomendado.
- **Método de negócio** em si (o "jeito de trabalhar") **não é patenteável** no Brasil (Lei 9.279/96, art. 10) — métodos comerciais puros ficam fora de patente. A proteção prática vem do conjunto: registro do software, marca registrada, segredo de negócio (contratos de confidencialidade com a equipe) e esta documentação datada.
- Esta documentação, versionada em git com histórico de commits, ajuda a demonstrar anterioridade e autoria.
