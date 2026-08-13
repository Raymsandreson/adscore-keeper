// ============================================================================
// Resume o que caiu no processo, na CAPTURA — não na hora de olhar.
//
// O card do sino mostra o texto como o tribunal escreveu ("Certidão Automática
// de Ciência por Domicílio Eletrônico | Certidão (RESTRITO)") e esconde os
// eventos do e-mail atrás de um clique. Quem varre 100 linhas não lê nenhum.
//
// Resumir no render seriam 100 chamadas de IA por abertura do sino. Aqui cada
// movimentação é resumida UMA vez, quando chega, e vira texto no banco
// (process_updates.resumo_ia).
//
// Body: { limit?: number, ids?: string[], force?: boolean }
// Retorna: { success, resumidas, tentadas, sem_material }
//
// Chamada pelo cron interno do index.ts. `ids` + `force` existem para
// reprocessar uma linha específica na mão sem esperar a varredura.
// ============================================================================
import type { RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';
import { geminiChat } from '../lib/gemini';
import { buscarEmailsDoProcesso, formatarEmails } from '../lib/processual-email-context';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
/** Por rodada. O cron roda de 10 em 10 minutos, então isso é folga sobre o fluxo real (~200/semana). */
const LIMITE_PADRAO = 20;
/**
 * Janela do backfill. Sem ela, ligar a coluna joga as 2.057 movimentações
 * históricas na fila de uma vez — 17 horas de varredura e outras tantas
 * chamadas de IA para resumir processo que ninguém vai reabrir. Movimentação
 * velha continua mostrando o texto cru, como sempre mostrou.
 * `0` desliga o corte (varre tudo).
 */
const JANELA_DIAS = Number(process.env.SUMMARIZE_UPDATES_WINDOW_DAYS ?? 30);
/** E-mails do processo que entram no prompt do RESUMO. O histórico completo é assunto da dica de próximo passo, não daqui. */
const EMAILS_NO_RESUMO = 3;

interface EventoProcesso {
  data?: string | null;
  hora?: string | null;
  texto?: string;
}

interface LinhaUpdate {
  id: string;
  numero_cnj: string | null;
  processo_titulo: string | null;
  categoria: string | null;
  titulo: string | null;
  descricao: string | null;
  data_movimentacao: string | null;
  eventos: EventoProcesso[] | null;
}

const SYSTEM = `Você trabalha no acompanhamento processual de um escritório de advocacia previdenciário/trabalhista.

Sua tarefa: ler o que o tribunal comunicou sobre UM processo e escrever um RESUMO de 1 a 2 frases para a EQUIPE ler de relance numa lista com dezenas de linhas.

Regras:
- Diga O QUE ACONTECEU de concreto. Se houver data, prazo, valor ou quem foi intimado, isso é o mais importante.
- Comece pelo fato, não por preâmbulo. Nada de "Trata-se de", "O presente e-mail informa", "Houve movimentação".
- Se for rotina interna sem efeito prático (certidão automática, juntada de procuração, ciência por domicílio eletrônico), diga isso em uma frase curta — a equipe precisa saber que pode passar adiante.
- Se o comunicado exigir providência do escritório (prazo correndo, documento a juntar, audiência a confirmar), termine a frase deixando isso explícito.
- NÃO invente fato, data, prazo ou nome que não esteja no texto. Sem material suficiente, resuma o pouco que há.
- Português do Brasil, direto, no máximo 40 palavras. Não repita o número do processo.`;

function formatarEventos(eventos: EventoProcesso[] | null): string {
  if (!Array.isArray(eventos) || !eventos.length) return '';
  const linhas = eventos
    .slice(0, 20)
    .map((e) => `- ${[e.data, e.hora].filter(Boolean).join(' ')} ${String(e.texto || '').trim()}`.trim())
    .filter((l) => l !== '-');
  if (!linhas.length) return '';
  return `\n\nEVENTOS EXTRAÍDOS DO E-MAIL DE PUSH:\n${linhas.join('\n')}`;
}

export const handler: RequestHandler = async (req, res) => {
  const externalUrl = (process.env.EXTERNAL_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!externalUrl || !serviceKey) {
    return res.status(200).json({ success: false, error: 'EXTERNAL_SUPABASE_URL/SERVICE_ROLE_KEY ausentes' });
  }
  const ext = createClient(externalUrl, serviceKey, { auth: { persistSession: false } });

  const { limit, ids, force } = (req.body || {}) as { limit?: number; ids?: string[]; force?: boolean };
  const teto = Math.min(Math.max(Number(limit) || LIMITE_PADRAO, 1), 100);

  try {
    let q = ext
      .from('process_updates')
      .select('id, numero_cnj, processo_titulo, categoria, titulo, descricao, data_movimentacao, eventos');

    if (Array.isArray(ids) && ids.length) {
      q = q.in('id', ids.slice(0, 100));
      if (!force) q = q.is('resumo_ia_at', null);
    } else {
      // `resumo_ia_at` e não `resumo_ia`: linha que a IA não conseguiu resumir
      // fica carimbada e sai da fila, senão o varredor tentaria de novo para
      // sempre as mesmas.
      q = q.is('resumo_ia_at', null);
      if (JANELA_DIAS > 0) {
        const corte = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString();
        // Linha sem data de movimentação existe (Escavador/backfill), e um
        // `gte` seco a descartaria para sempre — daí o segundo ramo pelo
        // created_at, que toda linha tem.
        q = q.or(`data_movimentacao.gte.${corte.slice(0, 10)},and(data_movimentacao.is.null,created_at.gte.${corte})`);
      }
      q = q
        .order('data_movimentacao', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(teto);
    }

    const { data, error } = await q;
    if (error) {
      // Coluna ausente = migration não aplicada. Não é erro de execução: é
      // "ainda não dá", e o cron não pode encher o log de stack trace por isso.
      const faltaColuna = /resumo_ia/i.test(error.message || '');
      return res.status(200).json({
        success: false,
        error: faltaColuna ? 'coluna resumo_ia ausente — migration pendente no Externo' : error.message,
      });
    }

    const linhas = (data || []) as LinhaUpdate[];
    let resumidas = 0;
    let semMaterial = 0;

    for (const u of linhas) {
      // O histórico do processo entra porque a descrição, sozinha, muitas vezes
      // é só o cabeçalho do push ("[TRT15] [PUSH] Atualizações...") — sem o
      // e-mail não há o que resumir.
      const emails = (await buscarEmailsDoProcesso(u.numero_cnj)).slice(-EMAILS_NO_RESUMO);
      const material = [
        u.titulo && u.titulo !== 'Movimentação' ? `Título: ${u.titulo}` : null,
        u.descricao ? `Texto registrado: ${u.descricao}` : null,
        formatarEventos(u.eventos),
        formatarEmails(emails),
      ].filter(Boolean).join('\n');

      // Nada além do rótulo de categoria: resumir isso seria inventar. Carimba
      // a data para a linha não voltar à fila e segue.
      if (!material.replace(/\s/g, '')) {
        semMaterial++;
        await ext.from('process_updates')
          .update({ resumo_ia: null, resumo_ia_at: new Date().toISOString() })
          .eq('id', u.id);
        continue;
      }

      let resumo = '';
      try {
        const resposta = await geminiChat({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: `Processo: ${u.processo_titulo || '—'}\n`
                + `Classificação automática: ${u.categoria || '—'}\n`
                + `Data da movimentação: ${u.data_movimentacao || '—'}\n\n${material}`,
            },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'set_resumo',
              description: 'Resumo de 1 a 2 frases do que o tribunal comunicou.',
              parameters: {
                type: 'object',
                properties: {
                  resumo: {
                    type: 'string',
                    description: 'O que aconteceu, em até 40 palavras, começando pelo fato. Diz se exige providência do escritório.',
                  },
                },
                required: ['resumo'],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'set_resumo' } },
          temperature: 0.2,
        });

        const chamada = resposta?.choices?.[0]?.message?.tool_calls?.[0];
        if (chamada?.function?.arguments) {
          resumo = String(JSON.parse(chamada.function.arguments)?.resumo || '').trim();
        }
      } catch (err) {
        console.warn('[summarize-process-updates] IA falhou em', u.id, err instanceof Error ? err.message : err);
        // Falha de provider NÃO carimba: aqui a linha volta à fila na próxima
        // rodada, ao contrário do caso "não há o que resumir".
        continue;
      }

      const { error: upErr } = await ext
        .from('process_updates')
        .update({ resumo_ia: resumo || null, resumo_ia_at: new Date().toISOString() })
        .eq('id', u.id);
      if (upErr) {
        console.warn('[summarize-process-updates] gravação falhou em', u.id, upErr.message);
        continue;
      }
      if (resumo) resumidas++;
    }

    return res.status(200).json({
      success: true,
      tentadas: linhas.length,
      resumidas,
      sem_material: semMaterial,
    });
  } catch (err) {
    console.error('[summarize-process-updates] erro:', err);
    return res.status(200).json({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
