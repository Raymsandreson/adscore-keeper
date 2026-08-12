// Lê a conversa do WhatsApp e identifica o que o CLIENTE ficou de fazer.
//
// Motivo: o combinado nasce no meio do áudio ("pode deixar que eu avalio vocês
// no Google", "vou gravar o vídeo sim", "amanhã te mando a carteira") e ninguém
// para pra cadastrar isso à mão — some. Aqui a IA varre a conversa, extrai as
// promessas do cliente com as PALAVRAS DELE e grava em `lead_client_commitments`.
//
// Body: {
//   phone: string,                 // obrigatório
//   instance_name?: string,
//   lead_id?: string,
//   contact_id?: string,
//   client_name?: string,
//   force?: boolean,               // ignora o cache e varre de novo
//   message_limit?: number,        // padrão 120 últimas mensagens
// }
//
// Cache: `lead_client_commitment_scans` guarda a última mensagem analisada.
// Sem mensagem nova desde então, a função devolve o que já existe SEM chamar a
// IA — abrir a mesma conversa dez vezes custa uma análise só.
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';
import { supabase } from '../lib/supabase';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
const DEFAULT_MESSAGE_LIMIT = 120;
/** Título maior que isso vira resumo truncado — pendência é uma linha, não um parágrafo. */
const MAX_TITLE = 120;

interface DetectedCommitment {
  title: string;
  quote: string;
  /** Número da mensagem no transcript (#N), não o UUID. */
  source_ref: string;
  due_date: string;
  confidence: number;
  kind: string;
  /** true quando a própria conversa mostra que o cliente já cumpriu. */
  done: boolean;
}

interface MessageRow {
  id: string;
  message_text: string | null;
  message_type: string | null;
  direction: string | null;
  created_at: string;
  contact_name: string | null;
}

const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Palavras que não distinguem uma pendência de outra. "Fazer a visita do caso
 * do Morumbi" e "Realizar a visita do caso do Morumbi" são a MESMA coisa — o
 * dedup por título exato deixava as duas passarem, e o painel mostrava a
 * pendência repetida com outras palavras.
 */
const STOPWORDS = new Set([
  'a','o','as','os','um','uma','de','do','da','dos','das','em','no','na','nos','nas',
  'para','pra','pro','por','com','ao','aos','e','que','se','ja','já','vai','ir',
  'fazer','realizar','efetuar','providenciar','enviar','mandar','levar','dar',
  'sobre','antes','depois','durante','the',
]);

/** Palavras que realmente identificam a pendência. */
function keyTokens(title: string): Set<string> {
  return new Set(
    normalize(title)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // acento não pode separar "visíta" de "visita"
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/**
 * Duas pendências são a mesma quando as palavras que importam coincidem em 70%
 * ou mais (Jaccard). Acima disso é reescrita da mesma promessa; abaixo, são
 * coisas diferentes ("visita do Morumbi" × "visita de Itatiba").
 */
function isSameCommitment(a: string, b: string): boolean {
  if (normalize(a) === normalize(b)) return true;
  const ta = keyTokens(a);
  const tb = keyTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.7;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);

  try {
    const {
      phone, instance_name, lead_id, contact_id, client_name, force, message_limit,
    } = (req.body || {}) as {
      phone?: string; instance_name?: string; lead_id?: string; contact_id?: string;
      client_name?: string; force?: boolean; message_limit?: number;
    };

    if (!phone) return ok({ success: false, error: 'phone obrigatório' });

    const instance = instance_name || '';
    const limit = Math.min(Math.max(Number(message_limit) || DEFAULT_MESSAGE_LIMIT, 20), 300);

    // ---- 1. mensagens da conversa -------------------------------------------------
    let msgQuery = supabase
      .from('whatsapp_messages')
      .select('id, message_text, message_type, direction, created_at, contact_name')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (instance) msgQuery = msgQuery.eq('instance_name', instance);

    const { data: msgData, error: msgError } = await msgQuery;
    if (msgError) return ok({ success: false, error: `mensagens: ${msgError.message}` });

    const messages = ((msgData as MessageRow[]) || [])
      .filter((m) => (m.message_text || '').trim())
      .reverse(); // cronológico para a IA

    if (messages.length === 0) {
      return ok({ success: true, created: 0, commitments: [], skipped: 'conversa sem texto' });
    }

    const lastMessageAt = messages[messages.length - 1].created_at;

    // ---- 2. cache: já analisamos até aqui? ----------------------------------------
    const { data: scanRow } = await supabase
      .from('lead_client_commitment_scans')
      .select('id, last_message_at, summary')
      .eq('phone', phone)
      .eq('instance_name', instance)
      .maybeSingle();

    const alreadyAnalyzed =
      scanRow?.last_message_at && new Date(scanRow.last_message_at) >= new Date(lastMessageAt);

    if (alreadyAnalyzed && !force) {
      console.log(`[detect-client-commitments] cache hit — sem mensagem nova (${messages.length} msgs)`);
      return ok({ success: true, created: 0, cached: true, summary: scanRow?.summary || null });
    }

    // ---- 3. o que já está registrado (a IA não pode repetir nem ressuscitar) -------
    const targetFilter = lead_id
      ? `lead_id.eq.${lead_id},and(phone.eq.${phone},instance_name.eq.${instance})`
      : `and(phone.eq.${phone},instance_name.eq.${instance})`;

    const { data: existingData } = await supabase
      .from('lead_client_commitments')
      .select('id, title, status')
      .or(targetFilter);

    const existing = (existingData as Array<{ title: string; status: string }>) || [];
    const existingTitles = existing.map((e) => e.title);

    // ---- 4. transcript ------------------------------------------------------------
    const clientLabel = client_name || 'CLIENTE';
    // Cada mensagem entra com um número curto (#1, #2, …) em vez do UUID: a IA
    // errava ao copiar 36 caracteres e 46% das pendências ficavam sem mensagem
    // de origem — sem ela não dá para saber QUANDO foi combinado nem abrir o
    // trecho na conversa. Número de 1 a 3 dígitos ela copia.
    const byRef = new Map<string, MessageRow>();
    messages.forEach((m, i) => byRef.set(String(i + 1), m));

    const transcript = messages
      .map((m, i) => {
        const who = m.direction === 'outbound' ? 'ESCRITÓRIO' : clientLabel;
        // ISO (en-CA dá YYYY-MM-DD) porque a IA resolve "amanhã"/"sexta" por
        // esta data: em dd/mm/aaaa ela troca dia por mês e o prazo sai errado.
        const when = new Date(m.created_at).toLocaleString('en-CA', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const audio = m.message_type === 'audio' ? ' (transcrição de áudio)' : '';
        return `#${i + 1} ${when} — ${who}${audio}: ${(m.message_text || '').slice(0, 1200)}`;
      })
      .join('\n');

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const system = `Você lê conversas de WhatsApp entre um escritório de advocacia e um cliente e identifica **o que o CLIENTE ficou de fazer** — as promessas dele que o escritório precisa cobrar depois.

Data de HOJE: ${today}.

O QUE CONTA como pendência do cliente:
- Ele se comprometeu com algo, mesmo informalmente: "vou fazer sim", "pode deixar", "amanhã te mando", "deixa comigo", "vou ver isso".
- Vale qualquer coisa: avaliar o escritório no Google, gravar vídeo de depoimento, enviar documento/foto/comprovante, comparecer em perícia ou audiência, pagar algo, procurar um dado, falar com alguém, indicar conhecido.
- Se o escritório PEDIU e o cliente não recusou, conta como pendência dele.

O QUE **NÃO** CONTA:
- Tarefa do ESCRITÓRIO (protocolar, peticionar, dar retorno, ligar para o cliente) — isso não é pendência do cliente.
- Conversa fiada, desabafo, dúvida sem compromisso.

JÁ CUMPRIDA (done = true): a conversa mostra que ele **fez** o que prometeu — mandou o documento, disse que já avaliou, compareceu. Registre do mesmo jeito, com done = true: serve de histórico do que o cliente entregou. O que ainda falta vem com done = false.

RESUMO DO CONTEXTO (campo summary): 3 a 5 frases, em português claro, contando a situação como quem passa o caso para um colega que nunca leu esta conversa: qual é o problema/pedido do cliente, em que pé está (o que o escritório já fez ou informou), e o que está travando ou sendo esperado agora. Sem saudação, sem "nesta conversa", sem repetir a lista de pendências. Se a conversa não permitir, escreva "".

REGRAS DE ESCRITA:
- O título deve usar as PALAVRAS DA CONVERSA, específico e curto: "Mandar a carteira de trabalho", "Gravar o vídeo de depoimento", "Avaliar o escritório no Google", "Levar o laudo na perícia do dia 12". NUNCA use rótulo genérico como "Pendência", "Documento", "Outro".
- Uma pendência por promessa. Não junte duas coisas num título só.
- quote: o trecho literal em que ele prometeu (até 200 caracteres).
- source_ref: o número da mensagem em que ele prometeu, como aparece no início da linha ("#42" → responda "42"). Só o número, sem "#". É por ele que sabemos QUANDO foi combinado — copie da conversa, não invente.
- due_date: quando o cliente deve entregar, em YYYY-MM-DD. Resolva SEMPRE pela DATA DA MENSAGEM em que ele prometeu (o AAAA-MM-DD logo depois do id, no início da linha), NUNCA pela data de hoje: a varredura roda dias depois da conversa, então "amanhã" dito em 03/08 é 04/08, não amanhã.
  * Marcador brando de tempo também vale: "ainda hoje"/"mais tarde"/"hoje à noite" = a data da própria mensagem; "segunda"/"sexta" = o próximo dia dessa semana contado a partir da mensagem; "semana que vem" = a segunda-feira seguinte; "depois do dia 15" = dia 15 do mês da mensagem.
  * "Quando puder", "assim que der", "vou ver", "te mando depois", "qualquer coisa te aviso" NÃO são prazo: devolva "". Prazo inventado vira cobrança errada — na dúvida, "".
- kind: um rótulo curto e livre que classifique (ex.: "avaliação", "depoimento", "documento", "comparecimento", "pagamento", "contato").
- confidence: 0 a 1. Use abaixo de 0.6 quando a promessa for vaga.
- NÃO invente. Sem promessa clara na conversa, devolva lista vazia.

${existingTitles.length > 0
  ? `JÁ REGISTRADAS (não repita, nem com outras palavras): ${existing.map((e) => `"${e.title}"`).join(', ')}`
  : 'Nada registrado ainda nesta conversa.'}`;

    // ---- 5. IA --------------------------------------------------------------------
    let detected: DetectedCommitment[] = [];
    let summary = '';
    let aiError: string | null = null;

    try {
      const result = await geminiChat({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `CONVERSA:\n${transcript}` },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'registrar_pendencias_do_cliente',
            description: 'Lista o que o cliente ficou de fazer, segundo a conversa.',
            parameters: {
              type: 'object',
              properties: {
                commitments: {
                  type: 'array',
                  description: 'Pendências do cliente. Lista vazia se não houver nenhuma promessa clara.',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: 'O que ele ficou de fazer, nas palavras da conversa.' },
                      quote: { type: 'string', description: 'Trecho literal em que ele prometeu.' },
                      source_ref: { type: 'string', description: 'Número da mensagem da promessa, sem o "#". Ex.: "42".' },
                      due_date: { type: 'string', description: 'YYYY-MM-DD se houver prazo. Senão vazio.' },
                      confidence: { type: 'number', description: 'Confiança de 0 a 1.' },
                      kind: { type: 'string', description: 'Rótulo curto livre da categoria.' },
                      done: { type: 'boolean', description: 'true se a conversa mostra que ele JÁ cumpriu.' },
                    },
                    required: ['title', 'quote', 'source_ref', 'due_date', 'confidence', 'kind', 'done'],
                    additionalProperties: false,
                  },
                },
                summary: {
                  type: 'string',
                  description: 'Resumo do contexto da conversa em 3 a 5 frases. Vazio se não der para resumir.',
                },
              },
              required: ['commitments', 'summary'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'registrar_pendencias_do_cliente' } },
      });

      const toolCall = result?.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        detected = Array.isArray(parsed?.commitments) ? parsed.commitments : [];
        summary = String(parsed?.summary || '').trim().slice(0, 2000);
      } else {
        aiError = 'A IA respondeu sem retornar a lista.';
      }
    } catch (e: any) {
      aiError = e?.message || String(e);
      console.error('[detect-client-commitments] erro na IA:', aiError);
    }

    if (aiError) {
      await supabase.from('lead_client_commitment_scans').upsert({
        phone, instance_name: instance, lead_id: lead_id || null,
        last_scanned_at: new Date().toISOString(), model: MODEL, last_error: aiError.slice(0, 300),
      }, { onConflict: 'phone,instance_name' });
      return ok({ success: false, error: aiError });
    }

    // ---- 6. filtra e grava --------------------------------------------------------
    // Quando cada mensagem foi enviada: é daqui que sai `promised_at`, a data em
    // que o cliente prometeu. A coluna é `DEFAULT now()` e ninguém a preenchia,
    // então TODA pendência nascia com a data da VARREDURA — promessa de 20/07
    // varrida em 10/08 aparecia no dia 10/08 na caixa e no calendário, porque
    // pendência sem prazo é posicionada por `promised_at`.
    const seenNow = new Set<string>();

    /**
     * Qual mensagem originou a pendência.
     *
     * Três caminhos, do mais confiável ao último recurso: o número que a IA
     * devolveu (#N), o UUID cru (respostas antigas ainda vêm assim) e, se os
     * dois falharem, o trecho citado procurado no texto das mensagens — o
     * `quote` é literal, então casar por ele acerta sem depender de a IA copiar
     * identificador nenhum. A mais recente vence quando o trecho se repete.
     */
    const acharMensagem = (ref: unknown, quote: string): MessageRow | null => {
      const bruto = String(ref ?? '').trim().replace(/^#/, '');
      const porNumero = byRef.get(bruto);
      if (porNumero) return porNumero;
      const porId = messages.find((m) => m.id === bruto);
      if (porId) return porId;

      const alvo = normalize(quote).slice(0, 80);
      if (alvo.length < 12) return null;   // trecho curto casa com qualquer coisa
      for (let i = messages.length - 1; i >= 0; i--) {
        if (normalize(messages[i].message_text || '').includes(alvo)) return messages[i];
      }
      return null;
    };

    const rows = detected
      .filter((c) => {
        const title = String(c?.title || '').trim();
        if (title.length < 3) return false;
        if (Number(c.confidence) < 0.5) return false; // promessa vaga demais
        // Repetida com outras palavras conta como repetida — tanto contra o que
        // já está gravado quanto dentro da própria resposta da IA.
        if (existingTitles.some((t) => isSameCommitment(t, title))) return false;
        if ([...seenNow].some((t) => isSameCommitment(t, title))) return false;
        seenNow.add(title);
        return true;
      })
      .map((c) => {
        const title = String(c.title).trim().slice(0, MAX_TITLE);
        const src = acharMensagem(c.source_ref, String(c.quote || ''));
        const due = /^\d{4}-\d{2}-\d{2}$/.test(String(c.due_date || '')) ? String(c.due_date) : null;
        // Cumprida dentro da própria conversa já nasce resolvida: vira histórico
        // do que o cliente entregou, sem ninguém precisar marcar nada.
        const alreadyDone = c.done === true;
        return {
          lead_id: lead_id || null,
          contact_id: contact_id || null,
          phone,
          instance_name: instance || null,
          title,
          kind: String(c.kind || 'outro').trim().slice(0, 40) || 'outro',
          status: alreadyDone ? 'feito' : 'combinado',
          done_at: alreadyDone ? new Date().toISOString() : null,
          done_by_name: alreadyDone ? 'IA (visto na conversa)' : null,
          origin: 'ia',
          ai_confidence: Number(c.confidence) || null,
          due_date: due,
          // Sem a mensagem de origem não há como saber quando foi combinado;
          // aí sim vale a hora da varredura (é o default da coluna).
          promised_at: src?.created_at || new Date().toISOString(),
          source_message_id: src?.id || null,
          source_message_text: String(c.quote || '').slice(0, 400) || null,
          created_by_name: 'IA',
        };
      });

    // Insere uma a uma: o dedup do banco é um índice único POR EXPRESSÃO
    // (alvo + título normalizado), e expressão não pode ser `onConflict` no
    // PostgREST. Violação de unicidade (23505) aqui é o resultado esperado —
    // significa que outra aba registrou a mesma pendência primeiro.
    // Pendência que JÁ existia em aberto e que a conversa agora mostra cumprida:
    // fecha em vez de tentar inserir de novo (o dedup barraria e o "feito" se
    // perderia — a pendência ficaria eternamente aberta na tela).
    let closed = 0;
    const doneTitles = detected
      .filter((c) => c?.done === true && String(c?.title || '').trim())
      .map((c) => String(c.title));

    for (const e of (existingData as Array<{ id: string; title: string; status: string }>) || []) {
      if (e.status !== 'combinado' && e.status !== 'cobrado') continue;
      if (!doneTitles.some((t) => isSameCommitment(t, e.title))) continue;
      const { error: closeError } = await supabase
        .from('lead_client_commitments')
        .update({
          status: 'feito',
          done_at: new Date().toISOString(),
          done_by_name: 'IA (visto na conversa)',
        })
        .eq('id', e.id);
      if (!closeError) closed++;
    }

    let created = 0;
    let duplicates = 0;
    for (const row of rows) {
      const { error: insError } = await supabase.from('lead_client_commitments').insert(row);
      if (!insError) { created++; continue; }
      if (insError.code === '23505') { duplicates++; continue; }
      console.error('[detect-client-commitments] erro ao gravar:', insError.message);
    }

    await supabase.from('lead_client_commitment_scans').upsert({
      phone,
      instance_name: instance,
      lead_id: lead_id || null,
      last_message_at: lastMessageAt,
      last_scanned_at: new Date().toISOString(),
      messages_analyzed: messages.length,
      found_count: created,
      model: MODEL,
      last_error: null,
      // Resumo só é sobrescrito quando a IA conseguiu escrever um — resposta
      // vazia não apaga o resumo bom da varredura anterior.
      ...(summary ? { summary, summary_updated_at: new Date().toISOString() } : {}),
    }, { onConflict: 'phone,instance_name' });

    // Log sem conteúdo de conversa (dado de cliente não vai para log).
    // `com_origem` e `com_prazo` são o termômetro da extração de data: sem a
    // mensagem de origem a pendência nasce com a data da varredura.
    const comOrigem = rows.filter((r) => r.source_message_id).length;
    const comPrazo = rows.filter((r) => r.due_date).length;
    console.log(`[detect-client-commitments] ok — msgs=${messages.length}, detectadas=${detected.length}, novas=${created}, com_origem=${comOrigem}/${rows.length}, com_prazo=${comPrazo}/${rows.length}, duplicadas=${duplicates}, fechadas=${closed}, resumo=${summary ? 'sim' : 'nao'}`);

    return ok({
      success: true,
      created,
      closed,
      analyzed: messages.length,
      detected: detected.length,
      summary: summary || null,
    });
  } catch (e: any) {
    console.error('[detect-client-commitments] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};
