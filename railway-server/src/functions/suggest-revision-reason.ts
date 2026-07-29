// Sugere o motivo + categoria de uma revisão de POP a partir do diff.
// Usado pelo dialog "Registrar alteração no POP" do WorkflowBuilder: a IA lê o
// que mudou e propõe o texto do motivo já classificado em uma das 3 categorias
// de gestão de POP (automação | eliminação | otimização).
//
// Body: { typeLabel?, boardName?, diffLines: string[], draft? }
//   diffLines: linhas legíveis do diff (formatDiffLines do front)
//   draft: rascunho do gerente, se já digitou algo (a IA respeita e refina)
// Retorno HTTP 200: { category: 'automacao'|'eliminacao'|'otimizacao', reason } | { error }
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';

const MODEL = process.env.SUGGEST_REVISION_AI_MODEL || 'google/gemini-3.6-flash';

export const handler: RequestHandler = async (req, res) => {
  try {
    const { typeLabel, boardName, diffLines, draft } = (req.body || {}) as {
      typeLabel?: string;
      boardName?: string;
      diffLines?: string[];
      draft?: string;
    };

    if (!Array.isArray(diffLines) || diffLines.length === 0) {
      return res.status(200).json({ error: 'diffLines vazio — nada para analisar' });
    }

    const systemPrompt = `Você escreve o registro de alteração de POPs (Procedimentos Operacionais Padrão) de um escritório de advocacia (acidentes de trabalho e INSS). O gerente mantém os POPs atualizados e otimizados conforme a prática do dia a dia e os testes que vão sendo feitos.

Sua tarefa: a partir do diff da alteração, propor o MOTIVO da alteração (texto curto, 1-3 frases, pt-BR, direto) e classificar em UMA categoria:
- "automacao": a mudança automatiza algo que era manual (mover lead, definir status automaticamente, gatilhos, integrações).
- "eliminacao": a mudança remove passo/objetivo/fase/status que não agrega mais (enxugar o processo).
- "otimizacao": a mudança melhora/refina o que já existe (reescrever script, reordenar, ajustar status possíveis/esperado, esclarecer instrução).

Regras:
- O motivo explica o PORQUÊ provável da mudança do ponto de vista de gestão do processo, não repete o diff literalmente.
- Se houver rascunho do gerente, use-o como base: refine e complete, sem descartar a intenção dele.
- Havendo mudanças de mais de uma natureza, escolha a categoria predominante.
- Não invente fatos externos (nomes de órgãos, prazos) que não estejam no diff ou no rascunho.`;

    const userContent = [
      `POP: ${boardName || '(sem nome)'} (${typeLabel || 'POP'})`,
      '',
      'ALTERAÇÕES DETECTADAS:',
      ...diffLines.slice(0, 40).map(l => `- ${l}`),
      draft?.trim() ? `\nRASCUNHO DO GERENTE:\n${draft.trim()}` : '',
    ].join('\n');

    const data = await geminiChat({
      model: MODEL,
      thinking_budget: 0,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'suggest_reason',
            description: 'Retorna o motivo sugerido e a categoria da alteração do POP.',
            parameters: {
              type: 'object',
              properties: {
                category: { type: 'string', enum: ['automacao', 'eliminacao', 'otimizacao'] },
                reason: { type: 'string', description: 'Motivo da alteração em pt-BR, 1-3 frases.' },
              },
              // Gemini 3.x às vezes emite só os campos required — marcar todos.
              required: ['category', 'reason'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'suggest_reason' } },
    });

    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return res.status(200).json({ error: 'IA não retornou dados estruturados' });
    }

    const result = JSON.parse(toolCall.function.arguments) as { category?: string; reason?: string };
    const category = ['automacao', 'eliminacao', 'otimizacao'].includes(result.category || '')
      ? result.category
      : 'otimizacao';
    return res.status(200).json({ category, reason: (result.reason || '').trim() });
  } catch (e: any) {
    console.error('[suggest-revision-reason] error:', e);
    return res.status(200).json({ error: e?.message || 'Erro desconhecido' });
  }
};
