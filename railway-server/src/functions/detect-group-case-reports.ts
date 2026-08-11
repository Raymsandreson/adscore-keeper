// Lê os GRUPOS marcados para captação e acha gente relatando acidente.
//
// Motivo: caso novo raramente chega dizendo "quero contratar advogado". Ele
// aparece como desabafo no meio do grupo do bairro, do sindicato, da obra:
// "o marido da Cleide caiu do andaime ontem", "meu tio morreu na BR-381", "o
// INSS negou meu afastamento de novo". Ninguém lê grupo com olho de captação e
// o relato passa. Aqui a IA lê só os grupos que a equipe MARCOU, extrai o que
// parece caso e joga numa fila — quem aprova é gente, não a IA.
//
// Irmão de `detect-client-commitments`: mesma estrutura (transcript → tool
// call → dedup por Jaccard → cache por última mensagem), alvo diferente.
// Aquele lê conversa individual de cliente NOSSO; este lê grupo e procura
// gente que ainda não é cliente.
//
// Body: {
//   instance_name?: string,   // limita a uma instância
//   group_phone?: string,     // varre um grupo só (dígitos do JID)
//   force?: boolean,          // ignora o cache e relê a janela inteira
//   message_limit?: number,   // teto de mensagens por grupo (padrão 120)
//   max_groups?: number,      // grupos por rodada (padrão 12) — o cron chama sem isso
//   first_scan_hours?: number,// janela do primeiro scan de um grupo (padrão 48h)
// }
//
// Cache: `whatsapp_group_report_scans` guarda a última mensagem lida por grupo.
// Sem mensagem nova, o grupo é pulado SEM chamar a IA — rodando de 10 em 10
// minutos em dezenas de grupos, é a diferença entre caro e barato.
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';
import { supabase } from '../lib/supabase';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
const DEFAULT_MESSAGE_LIMIT = 120;
const DEFAULT_MAX_GROUPS = 12;
/** Primeira varredura de um grupo não lê o histórico inteiro — só o passado recente. */
const DEFAULT_FIRST_SCAN_HOURS = 48;
/** Abaixo disso é chute da IA em cima de conversa solta. */
const MIN_CONFIDENCE = 0.6;
const MAX_HEADLINE = 180;
/** Relato antigo do mesmo grupo ainda conta para o dedup por este tanto de dias. */
const DEDUP_WINDOW_DAYS = 45;

const KINDS = new Set([
  'acidente_trabalho', 'acidente_transito', 'obito', 'doenca_ocupacional', 'outro',
]);

interface DetectedReport {
  headline: string;
  quote: string;
  source_message_id: string;
  kind: string;
  victim_name: string;
  victim_is_reporter: boolean;
  accident_date: string;
  city: string;
  state: string;
  company: string;
  damage: string;
  dynamics_summary: string;
  details: string;
  confidence: number;
}

interface WatchedGroup {
  instance_name: string;
  group_phone: string;
  group_jid: string | null;
  group_name: string | null;
  notify_user_ids: string[] | null;
}

interface MessageRow {
  id: string;
  message_text: string | null;
  message_type: string | null;
  direction: string | null;
  created_at: string;
  contact_name: string | null;
  metadata: any;
}

const normalize = (s: string) =>
  (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Palavras que aparecem em qualquer relato e não distinguem um do outro. */
const STOPWORDS = new Set([
  'a','o','as','os','um','uma','de','do','da','dos','das','em','no','na','nos','nas',
  'para','pra','pro','por','com','ao','aos','e','que','se','ja','já','vai','foi','era',
  'sobre','antes','depois','durante','the','ele','ela','meu','minha','seu','sua',
  'sofreu','teve','esta','está','muito','ontem','hoje','agora','ali','la','lá',
]);

function keyTokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/**
 * Dois relatos são o mesmo caso quando as palavras que importam coincidem em
 * 60% ou mais. Limiar mais frouxo que o das pendências (70%) de propósito: a
 * mesma tragédia é recontada por três pessoas diferentes no grupo, cada uma
 * com suas palavras, e três cards do mesmo acidente na fila é o que faz a
 * equipe parar de olhar a fila.
 */
function isSameReport(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = keyTokens(a);
  const tb = keyTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.6;
}

/** Telefone de quem falou — em grupo, `phone` é o grupo, não a pessoa. */
function senderPhoneOf(m: MessageRow): string | null {
  const meta = m.metadata || {};
  const raw =
    meta?.message?.sender_pn || meta?.sender_pn ||
    meta?.message?.sender || meta?.participant || '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

function buildSystemPrompt(groupName: string, today: string, jaVistos: string[]): string {
  return `Você lê conversas de um GRUPO de WhatsApp${groupName ? ` ("${groupName}")` : ''} e procura uma coisa só: **alguém contando um caso que pode virar processo** para um escritório de advocacia brasileiro.

Data de HOJE: ${today}.

O QUE CONTA (registre):
- Acidente de trabalho: queda, máquina, choque elétrico, soterramento, queimadura, esmagamento, corte/amputação, obra, fábrica, mina.
- Acidente de trânsito: colisão, atropelamento, moto, capotamento, ônibus.
- Óbito: morte de alguém em acidente, no trabalho ou logo depois — inclusive quando o assunto é pensão/indenização para a família.
- Doença ocupacional ou problema de afastamento no INSS: LER/DORT, coluna, perícia negada, benefício cortado, afastamento recusado, auxílio-doença.

Conta tanto quem viveu o caso ("caí do andaime na obra semana passada") quanto quem conta de outro ("o marido da Cleide caiu", "o filho do Zé morreu no acidente da BR").

O QUE **NÃO** CONTA:
- Notícia, link ou print compartilhado sobre desconhecido, sem ninguém do grupo ter ligação com o caso.
- Conversa sobre processo que o escritório JÁ toca ("como está meu processo?", "saiu minha audiência?").
- Piada, hipótese, notícia antiga, discussão política, corrente, "cuidado que isso é perigoso".
- Mensagem do próprio escritório.
- Fofoca vaga sem nenhum fato concreto de acidente, morte ou afastamento.

REGRAS DE ESCRITA:
- headline: uma linha, com as PALAVRAS DA CONVERSA, do jeito que um assessor contaria para o colega: "Marido da Cleide caiu de andaime em obra em Contagem e fraturou a coluna". Nunca rótulo genérico ("Acidente", "Caso novo").
- quote: o trecho literal em que a pessoa contou (até 300 caracteres). Copie, não reescreva.
- source_message_id: o id EXATO entre colchetes daquela mensagem. Copie da conversa, não invente.
- victim_name: nome da vítima se aparecer; senão descreva o vínculo ("marido da Cleide"). Vazio só se não houver nada.
- victim_is_reporter: true quando quem escreveu é a própria vítima.
- accident_date: YYYY-MM-DD só se der para saber (resolva "ontem"/"sexta" pela data de hoje). Senão "".
- city / state: cidade e UF (2 letras) se aparecerem ou forem dedução segura do que foi dito. Senão "".
- company: empresa envolvida (obra, fábrica, transportadora, empregador), se citada.
- damage: o dano em poucas palavras ("Morte", "Fratura na coluna", "Amputação de dedo", "Benefício negado").
- dynamics_summary: como aconteceu, curto ("Queda de andaime de 6m", "Moto x carro na BR-381").
- details: 2 a 4 frases contando o caso para quem não leu o grupo, inclusive quem contou e que relação tem com a vítima.
- kind: um de acidente_trabalho, acidente_transito, obito, doenca_ocupacional, outro.
- confidence: 0 a 1. Abaixo de 0.6 quando for vago ou você estiver deduzindo demais.
- NÃO invente nome, cidade nem empresa. Sem relato claro, devolva lista vazia — é o resultado mais comum e está tudo bem.

${jaVistos.length > 0
    ? `JÁ REGISTRADOS deste grupo (não repita, nem com outras palavras — outra pessoa recontando o MESMO caso é repetição): ${jaVistos.map((h) => `"${h}"`).join(', ')}`
    : 'Nada registrado ainda neste grupo.'}`;
}

const REPORT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'registrar_relatos_de_caso',
    description: 'Lista os relatos de acidente, óbito ou afastamento contados no grupo.',
    parameters: {
      type: 'object',
      properties: {
        reports: {
          type: 'array',
          description: 'Relatos encontrados. Lista vazia quando não houver nenhum.',
          items: {
            type: 'object',
            properties: {
              headline: { type: 'string', description: 'O caso em uma linha, nas palavras da conversa.' },
              quote: { type: 'string', description: 'Trecho literal em que a pessoa contou.' },
              source_message_id: { type: 'string', description: 'Id entre colchetes da mensagem do relato.' },
              kind: { type: 'string', description: 'acidente_trabalho, acidente_transito, obito, doenca_ocupacional ou outro.' },
              victim_name: { type: 'string', description: 'Nome da vítima ou o vínculo dela com quem contou.' },
              victim_is_reporter: { type: 'boolean', description: 'true se quem escreveu é a própria vítima.' },
              accident_date: { type: 'string', description: 'YYYY-MM-DD se der para saber. Senão vazio.' },
              city: { type: 'string', description: 'Cidade do acidente.' },
              state: { type: 'string', description: 'UF de 2 letras.' },
              company: { type: 'string', description: 'Empresa envolvida, se citada.' },
              damage: { type: 'string', description: 'Dano principal em poucas palavras.' },
              dynamics_summary: { type: 'string', description: 'Como aconteceu, curto.' },
              details: { type: 'string', description: 'O caso em 2 a 4 frases para quem não leu o grupo.' },
              confidence: { type: 'number', description: 'Confiança de 0 a 1.' },
            },
            required: [
              'headline', 'quote', 'source_message_id', 'kind', 'victim_name',
              'victim_is_reporter', 'accident_date', 'city', 'state', 'company',
              'damage', 'dynamics_summary', 'details', 'confidence',
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['reports'],
      additionalProperties: false,
    },
  },
};

/** Avisa quem cuida do grupo. Fire-and-forget: relato já está gravado. */
function firePush(group: WatchedGroup, created: number, primeira: string) {
  const userIds = (group.notify_user_ids || []).filter(Boolean);
  if (userIds.length === 0 || created === 0) return;

  const url = `${process.env.RAILWAY_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 3000}`}/functions/send-team-push`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.RAILWAY_API_KEY || '',
      'x-internal-key': process.env.RAILWAY_INTERNAL_KEY || '',
    },
    body: JSON.stringify({
      user_ids: userIds,
      title: created === 1
        ? `Relato de caso em ${group.group_name || 'grupo'}`
        : `${created} relatos de caso em ${group.group_name || 'grupo'}`,
      content: primeira,
      tag: `relato-grupo-${group.group_phone}`,
      url: '/leads/relatos-grupos',
    }),
  }).catch((err) => console.warn('[detect-group-case-reports] push falhou:', err?.message || err));
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);

  try {
    const {
      instance_name, group_phone, force, message_limit, max_groups, first_scan_hours,
    } = (req.body || {}) as {
      instance_name?: string; group_phone?: string; force?: boolean;
      message_limit?: number; max_groups?: number; first_scan_hours?: number;
    };

    const limit = Math.min(Math.max(Number(message_limit) || DEFAULT_MESSAGE_LIMIT, 20), 300);
    const maxGroups = Math.min(Math.max(Number(max_groups) || DEFAULT_MAX_GROUPS, 1), 60);
    const firstScanHours = Math.min(Math.max(Number(first_scan_hours) || DEFAULT_FIRST_SCAN_HOURS, 1), 24 * 30);

    // ---- 1. grupos marcados ---------------------------------------------------
    let watchQuery = supabase
      .from('whatsapp_group_watch')
      .select('instance_name, group_phone, group_jid, group_name, notify_user_ids')
      .eq('enabled', true);
    if (instance_name) watchQuery = watchQuery.eq('instance_name', instance_name);
    if (group_phone) watchQuery = watchQuery.eq('group_phone', group_phone);

    const { data: watchData, error: watchError } = await watchQuery;
    if (watchError) return ok({ success: false, error: `grupos: ${watchError.message}` });

    const groups = (watchData as WatchedGroup[]) || [];
    if (groups.length === 0) {
      return ok({ success: true, groups_scanned: 0, created: 0, skipped: 'nenhum grupo marcado' });
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const results: Array<Record<string, unknown>> = [];
    let totalCreated = 0;
    let scanned = 0;

    for (const group of groups) {
      if (scanned >= maxGroups) break;

      // ---- 2. cache: até onde já lemos este grupo ----------------------------
      const { data: scanRow } = await supabase
        .from('whatsapp_group_report_scans')
        .select('last_message_at')
        .eq('instance_name', group.instance_name)
        .eq('group_phone', group.group_phone)
        .maybeSingle();

      const lastSeen = scanRow?.last_message_at || null;
      // Grupo novo não puxa o histórico inteiro: só a janela recente. Ler dois
      // anos de grupo de bairro custaria caro e encheria a fila de caso velho.
      const since = lastSeen && !force
        ? lastSeen
        : new Date(Date.now() - firstScanHours * 3600 * 1000).toISOString();

      const { data: msgData, error: msgError } = await supabase
        .from('whatsapp_messages')
        .select('id, message_text, message_type, direction, created_at, contact_name, metadata')
        .eq('phone', group.group_phone)
        .eq('instance_name', group.instance_name)
        .eq('direction', 'inbound')       // o que a casa escreveu não é relato de caso
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (msgError) {
        results.push({ group: group.group_name, error: msgError.message });
        continue;
      }

      const messages = ((msgData as MessageRow[]) || [])
        .filter((m) => (m.message_text || '').trim().length >= 15) // "kkkk", "bom dia" não é relato
        .reverse();

      if (messages.length === 0) {
        results.push({ group: group.group_name, skipped: 'sem mensagem nova' });
        continue;
      }

      scanned++;
      const lastMessageAt = messages[messages.length - 1].created_at;

      // ---- 3. o que já está na fila deste grupo ------------------------------
      const dedupSince = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
      const { data: existingData } = await supabase
        .from('whatsapp_group_case_reports')
        .select('headline, victim_name')
        .eq('instance_name', group.instance_name)
        .eq('group_phone', group.group_phone)
        .gte('created_at', dedupSince);

      // Descartado entra no dedup de propósito: se alguém já olhou e disse que
      // não era caso, a IA não pode ressuscitar na próxima varredura.
      const existing = (existingData as Array<{ headline: string; victim_name: string | null }>) || [];
      const existingKeys = existing.map((e) => `${e.headline} ${e.victim_name || ''}`);

      // ---- 4. transcript -----------------------------------------------------
      const transcript = messages
        .map((m) => {
          const when = new Date(m.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          const who = m.contact_name || senderPhoneOf(m) || 'Participante';
          const audio = m.message_type === 'audio' ? ' (transcrição de áudio)' : '';
          return `[${m.id}] ${when} — ${who}${audio}: ${(m.message_text || '').slice(0, 1200)}`;
        })
        .join('\n');

      // ---- 5. IA -------------------------------------------------------------
      let detected: DetectedReport[] = [];
      let aiError: string | null = null;

      try {
        const result = await geminiChat({
          model: MODEL,
          messages: [
            { role: 'system', content: buildSystemPrompt(group.group_name || '', today, existing.map((e) => e.headline)) },
            { role: 'user', content: `CONVERSA DO GRUPO:\n${transcript}` },
          ],
          tools: [REPORT_TOOL],
          tool_choice: { type: 'function', function: { name: 'registrar_relatos_de_caso' } },
        });

        const toolCall = result?.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          detected = Array.isArray(parsed?.reports) ? parsed.reports : [];
        } else {
          aiError = 'A IA respondeu sem retornar a lista.';
        }
      } catch (e: any) {
        aiError = e?.message || String(e);
      }

      if (aiError) {
        console.error(`[detect-group-case-reports] IA falhou em ${group.group_name}:`, aiError);
        await supabase.from('whatsapp_group_report_scans').upsert({
          instance_name: group.instance_name,
          group_phone: group.group_phone,
          last_scanned_at: new Date().toISOString(),
          model: MODEL,
          last_error: aiError.slice(0, 300),
        }, { onConflict: 'instance_name,group_phone' });
        results.push({ group: group.group_name, error: aiError });
        continue;
      }

      // ---- 6. filtra e grava -------------------------------------------------
      const byId = new Map(messages.map((m) => [m.id, m]));
      const seenNow: string[] = [];

      const rows = detected
        .filter((r) => {
          const headline = String(r?.headline || '').trim();
          if (headline.length < 10) return false;
          if (Number(r.confidence) < MIN_CONFIDENCE) return false;
          const key = `${headline} ${String(r.victim_name || '')}`;
          if (existingKeys.some((k) => isSameReport(k, key))) return false;
          if (seenNow.some((k) => isSameReport(k, key))) return false;
          seenNow.push(key);
          return true;
        })
        .map((r) => {
          const src = byId.get(String(r.source_message_id));
          const kind = KINDS.has(String(r.kind)) ? String(r.kind) : 'outro';
          const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.accident_date || ''))
            ? String(r.accident_date) : null;
          const uf = String(r.state || '').trim().toUpperCase();
          return {
            instance_name: group.instance_name,
            group_phone: group.group_phone,
            group_jid: group.group_jid,
            group_name: group.group_name,
            reporter_phone: src ? senderPhoneOf(src) : null,
            reporter_name: src?.contact_name || null,
            kind,
            headline: String(r.headline).trim().slice(0, MAX_HEADLINE),
            quote: String(r.quote || '').slice(0, 400) || null,
            details: String(r.details || '').slice(0, 2000) || null,
            source_message_id: src ? src.id : null,
            message_at: src ? src.created_at : null,
            victim_name: String(r.victim_name || '').trim().slice(0, 120) || null,
            victim_is_reporter: r.victim_is_reporter === true,
            accident_date: date,
            city: String(r.city || '').trim().slice(0, 80) || null,
            state: /^[A-Z]{2}$/.test(uf) ? uf : null,
            company: String(r.company || '').trim().slice(0, 120) || null,
            damage: String(r.damage || '').trim().slice(0, 160) || null,
            dynamics_summary: String(r.dynamics_summary || '').trim().slice(0, 200) || null,
            ai_confidence: Number(r.confidence) || null,
            status: 'novo',
          };
        });

      // Uma a uma: o índice único é parcial (só vale com source_message_id), e
      // 23505 aqui é resultado esperado — outra varredura pegou a mesma
      // mensagem primeiro.
      let created = 0;
      let duplicates = 0;
      let primeiraGravada = '';
      for (const row of rows) {
        const { error: insError } = await supabase.from('whatsapp_group_case_reports').insert(row);
        if (!insError) {
          created++;
          if (!primeiraGravada) primeiraGravada = row.headline;
          continue;
        }
        if (insError.code === '23505') { duplicates++; continue; }
        console.error('[detect-group-case-reports] erro ao gravar:', insError.message);
      }

      await supabase.from('whatsapp_group_report_scans').upsert({
        instance_name: group.instance_name,
        group_phone: group.group_phone,
        last_message_at: lastMessageAt,
        last_scanned_at: new Date().toISOString(),
        messages_analyzed: messages.length,
        found_count: created,
        model: MODEL,
        last_error: null,
      }, { onConflict: 'instance_name,group_phone' });

      if (created > 0) firePush(group, created, primeiraGravada);

      totalCreated += created;
      results.push({
        group: group.group_name,
        analyzed: messages.length,
        detected: detected.length,
        created,
        duplicates,
      });
    }

    // Log sem conteúdo de conversa — dado de terceiro não vai para log.
    console.log(`[detect-group-case-reports] ok — grupos=${scanned}/${groups.length}, relatos=${totalCreated}`);

    return ok({
      success: true,
      groups_total: groups.length,
      groups_scanned: scanned,
      created: totalCreated,
      results,
    });
  } catch (e: any) {
    console.error('[detect-group-case-reports] error:', e);
    return ok({ success: false, error: e?.message || String(e) });
  }
};
