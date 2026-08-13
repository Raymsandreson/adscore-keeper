// ============================================================================
// O que os e-mails do tribunal já disseram sobre UM processo.
//
// `processual_emails` (Externo) guarda o e-mail bruto do push, casado ao
// processo pelo CNJ em `process_number`. Medido em 12/08/2026: 4.712 e-mails,
// 540 processos, média de 3,5 e-mails por processo — e 191 das 192
// movimentações da semana têm e-mail casado. Ou seja, o histórico existe e é
// pequeno o bastante para caber num prompt.
//
// O teto não é decoração: o maior processo soma 650 MIL caracteres de e-mail
// (contra 7,8 mil de média e 12 mil no p90). Sem corte, um único caso estoura
// o request e a chamada volta erro para todo mundo.
// ============================================================================
import { createClient } from '@supabase/supabase-js';

/** E-mails lidos por processo. Média é 3,5; 10 cobre praticamente tudo. */
const MAX_EMAILS = 10;
/** Corte por e-mail. O corpo do push repete cabeçalho e rodapé do tribunal. */
const MAX_CHARS_POR_EMAIL = 2500;
/** Teto do bloco inteiro, para o pior caso não passar do p90 com folga. */
const MAX_CHARS_TOTAL = 14000;

export interface EmailProcessual {
  assunto: string | null;
  recebido_em: string | null;
  caixa: string | null;
  texto: string;
}

function clienteExterno() {
  const url = (process.env.EXTERNAL_SUPABASE_URL || '').trim();
  const key = (process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Limpa o que o push do tribunal repete em todo e-mail. Não é cosmético: o
 * aviso de confidencialidade e o "não responda esta mensagem" ocupariam metade
 * do orçamento de caracteres com texto que não diz nada do caso.
 */
function limpar(texto: string): string {
  return texto
    .replace(/\r/g, '')
    .replace(/^\s*(Esta (é uma )?mensagem|Não responda|Favor não responder|Este e-?mail).*$/gim, '')
    .replace(/https?:\/\/\S{80,}/g, '[link]')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * E-mails daquele CNJ, do mais antigo para o mais novo — a ordem em que a
 * história do processo aconteceu, que é como a IA precisa ler para dizer o que
 * vem DEPOIS.
 */
export async function buscarEmailsDoProcesso(processNumber: string | null | undefined): Promise<EmailProcessual[]> {
  const cnj = (processNumber || '').trim();
  if (!cnj) return [];
  const ext = clienteExterno();
  if (!ext) return [];

  const { data, error } = await ext
    .from('processual_emails')
    .select('subject, received_at, inbox_label, body_text, snippet')
    .eq('process_number', cnj)
    .is('deleted_at', null)
    // Os mais RECENTES entram na seleção (é o que o teto corta), mas a lista
    // devolvida vai em ordem cronológica logo abaixo.
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS);

  if (error) {
    console.warn('[processual-email-context] falhou:', error.message);
    return [];
  }

  let orcamento = MAX_CHARS_TOTAL;
  const selecionados: EmailProcessual[] = [];
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    if (orcamento <= 0) break;
    const bruto = String(row.body_text || row.snippet || '');
    if (!bruto.trim()) continue;
    const texto = limpar(bruto).slice(0, Math.min(MAX_CHARS_POR_EMAIL, orcamento));
    if (!texto) continue;
    orcamento -= texto.length;
    selecionados.push({
      assunto: (row.subject as string) || null,
      recebido_em: (row.received_at as string) || null,
      caixa: (row.inbox_label as string) || null,
      texto,
    });
  }

  return selecionados.reverse();
}

/** Bloco pronto para o prompt. Vazio quando não há e-mail — nunca "(nenhum)". */
export function formatarEmails(emails: EmailProcessual[]): string {
  if (!emails.length) return '';
  const linhas = emails.map((e) => {
    const dia = e.recebido_em ? new Date(e.recebido_em).toISOString().slice(0, 10) : 's/ data';
    const cabecalho = [dia, e.caixa, e.assunto].filter(Boolean).join(' · ');
    return `--- E-mail ${cabecalho}\n${e.texto}`;
  });
  return `\n\nE-MAILS DO TRIBUNAL SOBRE ESTE PROCESSO (ordem cronológica, do mais antigo ao mais novo — é o histórico completo que temos):\n${linhas.join('\n\n')}`;
}
