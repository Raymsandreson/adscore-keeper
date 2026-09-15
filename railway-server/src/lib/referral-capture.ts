// Captura de indicação — o cartão de contato compartilhado vira linha em `referrals`.
//
// Por que existe: até aqui o cartão chegava, era gravado como mensagem de texto
// e morria ali. Quem pediu "me manda o contato do seu cunhado" recebia o
// contato e, se ninguém anotasse na mão, a indicação sumia: não havia como
// saber quem indicou quem, nem quantas indicações cada pessoa já deu, nem se
// alguém chegou a falar com o indicado.
//
// Roda fire-and-forget depois que a mensagem já está gravada. Qualquer falha
// aqui vira log: a mensagem do cliente não pode ser perdida porque a esteira de
// indicação tropeçou.
import type { SupabaseClient } from '@supabase/supabase-js';
import { contatosCompartilhados, type ContatoDoCartao } from './vcard';

export interface EntradaDeIndicacao {
  /** O `message` do payload da UazAPI (onde mora o vCard). */
  message: unknown;
  /** Chat de onde veio: telefone da pessoa ou id do grupo. Só dígitos. */
  chatPhone: string;
  /** Nome do chat/contato, quando o WhatsApp mandou. */
  chatName?: string | null;
  /** Id da mensagem no WhatsApp — a trava de idempotência. */
  externalMessageId?: string | null;
  /** Id da linha em whatsapp_messages. */
  messageRowId?: string | null;
  instanceName?: string | null;
  direction: 'inbound' | 'outbound';
  isGroup?: boolean;
  /** Quem mandou dentro do grupo (em conversa direta é o próprio chat). */
  senderPhone?: string | null;
  contactId?: string | null;
  /** Quando o cartão foi compartilhado. Backfill passa a data original. */
  sharedAt?: string | null;
}

export interface ResultadoDaCaptura {
  capturadas: number;
  ignoradas: number;
  motivo?: string;
}

/** Só dígitos, sem zeros à esquerda — mesmo formato de whatsapp_messages.phone. */
function normalizarTelefone(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = String(valor).replace(/\D/g, '').replace(/^0+/, '');
  return limpo.length >= 8 ? limpo : null;
}

/**
 * O telefone indicado é o da própria casa?
 *
 * Acontece o tempo todo: o cliente reencaminha o cartão do escritório para o
 * escritório, ou manda de volta o contato que acabamos de mandar. Isso não é
 * indicação — e sem esse filtro a fila enche de nós mesmos.
 */
function ehNumeroDaCasa(telefone: string, numerosDaCasa: Set<string>): boolean {
  return numerosDaCasa.has(telefone);
}

/** Telefones das nossas instâncias. Cache curto: muda quando alguém conecta um
 *  número novo, o que é raro, e 5 min de atraso não prejudica nada. */
let cacheNumerosDaCasa: { em: number; numeros: Set<string> } | null = null;

async function numerosDaCasa(supabase: SupabaseClient): Promise<Set<string>> {
  const agora = Date.now();
  if (cacheNumerosDaCasa && agora - cacheNumerosDaCasa.em < 5 * 60_000) {
    return cacheNumerosDaCasa.numeros;
  }
  const numeros = new Set<string>();
  try {
    const { data } = await supabase.from('whatsapp_instances').select('owner_phone');
    for (const linha of data || []) {
      const telefone = normalizarTelefone((linha as any).owner_phone);
      if (telefone) numeros.add(telefone);
    }
  } catch (e) {
    console.error('[indicacoes] não consegui listar os números da casa:', e);
  }
  cacheNumerosDaCasa = { em: agora, numeros };
  return numeros;
}

/** Só para teste: esquece o cache entre casos. */
export function limparCacheDeNumerosDaCasa(): void {
  cacheNumerosDaCasa = null;
}

/** Contato já cadastrado com esse telefone, se houver. */
async function contatoPorTelefone(
  supabase: SupabaseClient,
  telefone: string,
): Promise<{ id: string; full_name: string } | null> {
  // O telefone em `contacts` nem sempre está normalizado (há linha com máscara
  // e linha sem DDI). Buscar por igualdade perderia esses casos, então a busca
  // é pelos 8 últimos dígitos — a parte que sobrevive a qualquer formatação —
  // e a conferência exata vem depois, no laço.
  const sufixo = telefone.slice(-8);
  const { data } = await supabase
    .from('contacts')
    .select('id, full_name, phone')
    .ilike('phone', `%${sufixo}%`)
    .is('deleted_at', null)
    .limit(5);

  for (const linha of data || []) {
    if (normalizarTelefone((linha as any).phone)?.endsWith(sufixo)) {
      return { id: (linha as any).id, full_name: (linha as any).full_name };
    }
  }
  return null;
}

/**
 * Grava as indicações de uma mensagem. Devolve quantas entraram.
 *
 * Idempotente pelo índice único (source_message_id, indicated_phone): reprocessar
 * a mesma mensagem — webhook reentregando, backfill passando por cima — não
 * duplica.
 */
export async function capturarIndicacao(
  supabase: SupabaseClient,
  entrada: EntradaDeIndicacao,
): Promise<ResultadoDaCaptura> {
  try {
    const contatos: ContatoDoCartao[] = contatosCompartilhados(entrada.message);
    if (contatos.length === 0) return { capturadas: 0, ignoradas: 0, motivo: 'sem cartão' };

    const chatPhone = normalizarTelefone(entrada.chatPhone);
    if (!chatPhone) return { capturadas: 0, ignoradas: contatos.length, motivo: 'chat sem telefone' };

    const daCasa = await numerosDaCasa(supabase);

    // Dono do número que recebeu — a indicação é da instância, e uma instância
    // pode ter mais de um usuário (o responsável é atribuído na tela).
    let ownerPhone: string | null = null;
    if (entrada.instanceName) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('owner_phone')
        .ilike('instance_name', entrada.instanceName)
        .limit(1)
        .maybeSingle();
      ownerPhone = normalizarTelefone((inst as any)?.owner_phone);
    }

    const linhas: Record<string, unknown>[] = [];
    let ignoradas = 0;

    for (const contato of contatos) {
      const telefone = normalizarTelefone(contato.telefone);
      if (!telefone) { ignoradas++; continue; }
      // Cartão da própria casa, ou o cartão de quem está na conversa (alguém
      // reenviando o próprio contato): nenhum dos dois é indicação.
      if (ehNumeroDaCasa(telefone, daCasa) || telefone === chatPhone) { ignoradas++; continue; }

      const jaCadastrado = await contatoPorTelefone(supabase, telefone);

      linhas.push({
        source_message_id: entrada.externalMessageId || null,
        source_message_row_id: entrada.messageRowId || null,
        shared_at: entrada.sharedAt || new Date().toISOString(),
        direction: entrada.direction,

        referrer_phone: chatPhone,
        referrer_name: entrada.chatName || null,
        referrer_contact_id: entrada.contactId || null,
        referrer_group_id: entrada.isGroup ? chatPhone : null,
        referrer_sender_phone: normalizarTelefone(entrada.senderPhone) || null,

        indicated_name: contato.nome,
        indicated_phone: telefone,
        indicated_company: contato.empresa,
        indicated_contact_id: jaCadastrado?.id || null,
        raw_vcard: contato.vcard,

        instance_name: entrada.instanceName || null,
        instance_owner_phone: ownerPhone,

        status: 'novo',
      });
    }

    if (linhas.length === 0) return { capturadas: 0, ignoradas, motivo: 'nenhum cartão aproveitável' };

    const { error } = await supabase
      .from('referrals')
      .upsert(linhas, { onConflict: 'source_message_id,indicated_phone', ignoreDuplicates: true });

    if (error) {
      console.error('[indicacoes] erro ao gravar:', error.message);
      return { capturadas: 0, ignoradas, motivo: error.message };
    }

    console.log(
      `[indicacoes] ${linhas.length} capturada(s) de ${entrada.chatName || chatPhone}` +
        ` na instância ${entrada.instanceName || '(sem instância)'}`,
    );
    return { capturadas: linhas.length, ignoradas };
  } catch (err) {
    console.error('[indicacoes] falha na captura:', err);
    return { capturadas: 0, ignoradas: 0, motivo: err instanceof Error ? err.message : 'erro' };
  }
}
