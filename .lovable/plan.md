

## Plano: Sugestões de Continuação Inteligentes no Chat IA

### O que muda

Toda resposta da IA no chat virá acompanhada de 2-4 "chips" clicáveis de sugestão de próximo passo. O usuário clica, o texto vai para o campo de input (editável), e basta enviar. A IA também deve preencher todos os campos relevantes (data, notificação, matriz, tipo) proativamente nas suas respostas.

### Implementação

**1. Backend: Adicionar `follow_up_suggestions` ao tool calling da IA**

No `supabase/functions/analyze-activity-chat/index.ts`, modo `assistant`:
- Adicionar campo `follow_up_suggestions` ao schema da tool `suggest_field_updates`
- Array de 2-4 objetos com `{ label: string, message: string }` onde `label` é texto curto do chip e `message` é o texto completo que será enviado como mensagem
- Atualizar o system prompt para instruir a IA a SEMPRE gerar sugestões de continuação contextuais (ex: "Definir próximo passo", "Criar atividade de acompanhamento", "Atualizar status do lead")
- Incluir no prompt que as sugestões devem cobrir cenários como: perguntar detalhes faltantes, criar atividades com campos completos, atualizar status, definir prioridades

**2. Frontend: Renderizar chips de sugestão após cada mensagem da IA**

No `ActivityChatSheet.tsx`:
- Salvar `follow_up_suggestions` no campo `ai_suggestion` da mensagem (já existe o campo JSON)
- No `renderMessage` para mensagens AI, renderizar os chips como botões horizontais scrolláveis abaixo do texto
- Ao clicar no chip, preencher `inputText` com o `message` da sugestão para o usuário revisar/editar antes de enviar
- Estilizar como badges/chips compactos com ícone de seta

**3. Atualizar o system prompt**

Adicionar instruções:
- "SEMPRE inclua 2-4 sugestões de continuação no campo follow_up_suggestions"
- "As sugestões devem ser frases completas que o usuário enviaria, cobrindo: detalhes faltantes, próximos passos, criação de atividades, atualização de campos"
- "Cada sugestão deve ser autossuficiente — ao ser enviada, a IA deve conseguir agir sem pedir mais informações"
- "Sempre que possível, as sugestões devem incluir dados concretos (datas, tipos, prioridades) para que a IA preencha todos os campos automaticamente"

### Exemplo de fluxo

```text
Usuário: "Preciso agendar uma reunião com o cliente João"

IA: "Entendido! Posso criar a atividade de reunião com João. 
     Quando seria a melhor data?"

Chips:
[📅 Amanhã às 14h] → "Agende a reunião com João para amanhã às 14h, prioridade normal, matriz Agende"
[📅 Próxima segunda 10h] → "Agende a reunião com João para próxima segunda às 10h, prioridade normal"  
[📋 Me ajude a definir] → "Quais horários estão disponíveis considerando minhas atividades pendentes?"
[➕ Criar agora sem data] → "Crie a atividade de reunião com João como pendente para eu definir a data depois"
```

### Detalhes técnicos

- O campo `ai_suggestion` (JSONB) já existe na tabela `activity_chat_messages` — basta incluir `follow_up_suggestions` dentro dele
- Nenhuma migration necessária
- A resposta da tool `suggest_field_updates` passa a retornar `follow_up_suggestions` junto com os outros campos
- No frontend, os chips são renderizados apenas na última mensagem da IA (para não poluir o histórico)

