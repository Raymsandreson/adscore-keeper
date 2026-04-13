import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callGemini, transformGeminiStream } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_VARIABLES = `
CAMPOS DINÂMICOS DISPONÍVEIS (variáveis que podem ser inseridas no prompt):

📌 Lead:
{lead.nome} - Nome do lead
{lead.telefone} - Telefone
{lead.email} - Email
{lead.status} - Status atual
{lead.funil} - Nome do funil
{lead.etapa} - Etapa atual no funil
{lead.acolhedor} - Acolhedor/Responsável
{lead.produto} - Produto/Serviço
{lead.data_criacao} - Data de criação
{lead.observacoes} - Observações

📌 Contato:
{contato.nome} - Nome completo
{contato.telefone} - Telefone
{contato.email} - Email
{contato.cpf} - CPF
{contato.cidade} - Cidade
{contato.estado} - Estado
{contato.profissao} - Profissão
{contato.classificacao} - Classificação
{contato.data_nascimento} - Data de nascimento

📌 Processo:
{processo.numero} - Número do processo
{processo.caso} - Número do caso
{processo.tipo} - Tipo do caso
{processo.status} - Status do processo
{processo.nucleo} - Núcleo

📌 Grupo:
{grupo.nome} - Nome do grupo
{grupo.link_convite} - Link de convite

📌 Campos personalizados:
{campo.NOME_DO_CAMPO} - Qualquer campo personalizado

AÇÕES E COMPORTAMENTOS DO SISTEMA:
- O agente pode marcar status como "inviavel" escrevendo exatamente: [STATUS:inviavel] - usa quando o lead não tem interesse ou não se qualifica
- O agente pode solicitar transferência para humano: [TRANSFERIR:motivo] 
- O agente pode agendar follow-up: [FOLLOWUP:minutos] - agenda nova tentativa
- O agente pode encerrar conversa: [ENCERRAR] 
- O agente pode criar atividade: [ATIVIDADE:tipo:descrição]
- O agente suporta mensagens de áudio (responder com áudio quando configurado)
- O agente pode ser configurado para funcionar apenas em horários específicos
- O agente pode dividir mensagens longas automaticamente
- O agente pausa quando humano intervém (configurável em minutos)
- O agente pode encaminhar perguntas para grupo de supervisão

DICAS PARA BONS PROMPTS:
1. Sempre defina a PERSONA (quem é o agente, qual o papel)
2. Defina o TOM DE VOZ (amigável, profissional, técnico)
3. Estabeleça REGRAS claras (o que fazer e NÃO fazer)
4. Crie um FLUXO (saudação → qualificação → resolução → encerramento)
5. Use campos dinâmicos para personalizar ({lead.nome}, {contato.cidade}, etc.)
6. Defina LIMITES (quando transferir, o que não responder)
7. Use emojis moderadamente para humanizar
8. Inclua exemplos de respostas quando possível
`;

const GENERATE_SYSTEM = `Você é um especialista em criar prompts de sistema para agentes de IA que atendem clientes via WhatsApp.

Seu objetivo é gerar um prompt de sistema (system prompt) claro, eficaz e bem estruturado que defina o comportamento do agente.

${SYSTEM_VARIABLES}

REGRAS PARA O PROMPT GERADO:
- Escreva em português brasileiro
- Defina claramente a persona/papel do agente
- Inclua tom de voz e estilo de comunicação
- Defina regras de comportamento (o que fazer e NÃO fazer)
- Inclua instruções sobre formato de resposta (curto, direto, usar emojis, etc.)
- Adicione regras de escopo (quando transferir para humano, o que NÃO responder)
- Se aplicável, inclua fluxo de atendimento (saudação → qualificação → resposta → encerramento)
- O prompt deve ser prático e direto — é para uso interno do sistema
- NÃO inclua explicações sobre o prompt, retorne APENAS o prompt pronto para uso
- Use marcadores e seções organizadas`;

const BUILD_SYSTEM = `Você é um consultor especialista em construção de prompts para agentes de IA no WhatsApp. Seu papel é GUIAR o usuário passo a passo na criação do prompt ideal.

${SYSTEM_VARIABLES}

COMO VOCÊ DEVE AGIR:
1. Faça perguntas direcionadas para entender o objetivo do agente
2. Sugira quais campos dinâmicos inserir e EXPLIQUE por que cada um é útil
3. Recomende ações do sistema (como [STATUS:inviavel], [TRANSFERIR], etc.) quando aplicável
4. Dê exemplos práticos de trechos de prompt
5. Ao ter informações suficientes, gere o prompt dentro de um bloco \`\`\`prompt ... \`\`\` 
6. Sempre explique suas sugestões — não apenas dê o prompt, ensine o usuário

FORMATO DE RESPOSTA:
- Use markdown para formatar (negrito, listas, blocos de código)
- Seja didático e amigável
- Quando sugerir campos, mostre exemplos de uso real
- Quando o prompt estiver pronto, coloque dentro de \`\`\`prompt\n...\n\`\`\`

CONTEXTO: O sistema é um CRM jurídico com WhatsApp integrado, funis de vendas (kanban), gestão de leads, contatos, processos jurídicos, grupos de WhatsApp, e agentes de IA automatizados.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, refinement, current_prompt, mode, chat_history } = await req.json();

    const messages: any[] = [];

    if (mode === 'build' && chat_history) {
      // Build mode: interactive chat
      messages.push({ role: "system", content: BUILD_SYSTEM });
      
      if (current_prompt) {
        messages.push({
          role: "system",
          content: `O prompt atual do agente é:\n\`\`\`\n${current_prompt}\n\`\`\`\nUse isso como referência ao ajudar o usuário.`
        });
      }

      for (const msg of chat_history) {
        messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
      }
    } else {
      // Generate mode (original behavior)
      messages.push({ role: "system", content: GENERATE_SYSTEM });

      if (refinement && current_prompt) {
        messages.push(
          { role: "assistant", content: current_prompt },
          { role: "user", content: `Ajuste o prompt conforme esta instrução: ${refinement}` }
        );
      } else {
        messages.push({
          role: "user",
          content: `Crie um prompt de sistema completo para um agente de IA com a seguinte descrição:\n\n${description}\n\nGere apenas o prompt pronto para uso, sem explicações adicionais.`
        });
      }
    }

    const response = await callGemini({
      model: "google/gemini-2.5-flash",
      messages,
      stream: true,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const transformedStream = transformGeminiStream(response.body!);

    return new Response(transformedStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-agent-prompt error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
