// Antes de criar um contato para uma parte do processo, procura quem já está na
// base: mesmo documento, mesmo nome ou nome próximo — em `contacts` e em `leads`.
// O telefone que vem junto é o mesmo número das conversas do WhatsApp
// (`whatsapp_messages.phone`), então a sugestão também diz se aquele número já
// conversou com o escritório.
//
// Por que a busca NÃO varre o nome em whatsapp_messages: a tabela tem ~1,6 M
// linhas / 6,6 GB e `contact_name` não tem índice — um `ilike` ali estoura o
// statement timeout do Postgres. O caminho barato é o inverso: acha o telefone
// pelo nome em contacts/leads (tabelas pequenas) e confirma a conversa POR
// TELEFONE, que é indexado.

import { db } from '@/integrations/supabase';
import {
  buildIlikeSearchTokens,
  namesAreCompatible,
  normalizeSearchText,
  tokenMatchScore,
  tokenizeName,
  uniqueTokens,
} from '@/lib/nomeMatch';

export const soDigitos = (v?: string | null) => String(v || '').replace(/\D/g, '');

/** 11 dígitos = CPF, 14 = CNPJ. Fora disso o "documento" não serve pra casar. */
export const tipoDeDocumento = (v?: string | null): 'cpf' | 'cnpj' | null => {
  const d = soDigitos(v);
  if (d.length === 11) return 'cpf';
  if (d.length === 14) return 'cnpj';
  return null;
};

/**
 * O mesmo número aparece escrito de várias formas (com e sem o 55, com e sem o
 * nono dígito). Gera as grafias plausíveis para consultar
 * `whatsapp_messages.phone` por IGUALDADE — que usa o índice — em vez de
 * `like %…%`, que não usa e derruba a consulta.
 */
export function variantesDeTelefone(raw?: string | null): string[] {
  let local = soDigitos(raw);
  if (!local) return [];
  if (local.startsWith('55') && local.length >= 12) local = local.slice(2);
  if (local.length > 11) local = local.slice(-11);
  if (local.length < 10) return [];
  const ddd = local.slice(0, 2);
  const numero = local.slice(2);
  const grafias = new Set<string>();
  const add = (n: string) => {
    grafias.add(`${ddd}${n}`);
    grafias.add(`55${ddd}${n}`);
  };
  add(numero);
  if (numero.length === 9 && numero.startsWith('9')) add(numero.slice(1));
  if (numero.length === 8) add(`9${numero}`);
  return Array.from(grafias);
}

export type OrigemDaSugestao = 'contato' | 'lead';
export type MotivoDaSugestao = 'documento' | 'nome-exato' | 'nome-parecido';

export interface SugestaoDeContato {
  origem: OrigemDaSugestao;
  id: string;
  nome: string;
  telefone: string | null;
  documento: string | null;
  /** Lead já ligado ao contato (contacts.lead_id) ou o próprio lead. */
  leadId: string | null;
  motivo: MotivoDaSugestao;
  /** Quantos tokens do nome da parte bateram — desempata a ordem. */
  score: number;
  /** Preenchido por `marcarConversasDeWhatsApp`. */
  temConversa?: boolean;
}

const MOTIVO_PESO: Record<MotivoDaSugestao, number> = {
  documento: 3,
  'nome-exato': 2,
  'nome-parecido': 1,
};

/** Documento manda, depois nome idêntico, depois quem tem telefone. */
export function ordenarSugestoes(sugestoes: SugestaoDeContato[]): SugestaoDeContato[] {
  return [...sugestoes].sort((a, b) => {
    const peso = MOTIVO_PESO[b.motivo] - MOTIVO_PESO[a.motivo];
    if (peso) return peso;
    if (a.score !== b.score) return b.score - a.score;
    const fone = Number(!!b.telefone) - Number(!!a.telefone);
    if (fone) return fone;
    return a.nome.localeCompare(b.nome);
  });
}

/** Mesma parte pode voltar como contato E como lead: o contato prevalece. */
function dedup(sugestoes: SugestaoDeContato[]): SugestaoDeContato[] {
  const porChave = new Map<string, SugestaoDeContato>();
  for (const s of sugestoes) {
    const chave = `${s.origem}:${s.id}`;
    const atual = porChave.get(chave);
    if (!atual || MOTIVO_PESO[s.motivo] > MOTIVO_PESO[atual.motivo]) porChave.set(chave, s);
  }
  return Array.from(porChave.values());
}

export interface ParteParaBusca {
  nome: string;
  /** Como veio do Escavador: "010.690.513-90" ou "12.255.352/0001-77". */
  doc?: string | null;
  polo?: string | null;
  tipo?: string | null;
}

/**
 * Sugestões para uma parte do processo. Caro (até 4 consultas): chame ao abrir
 * o diálogo de UMA parte, nunca em laço pela lista de partes.
 */
export async function buscarSugestoesParaParte(parte: ParteParaBusca): Promise<SugestaoDeContato[]> {
  const achados: SugestaoDeContato[] = [];
  const docDigitos = soDigitos(parte.doc);
  const temDoc = !!tipoDeDocumento(parte.doc);

  const nomeNormalizado = normalizeSearchText(parte.nome);
  const motivoPorNome = (candidato?: string | null): MotivoDaSugestao =>
    normalizeSearchText(candidato) === nomeNormalizado ? 'nome-exato' : 'nome-parecido';

  // 1) Documento igual — a pista mais forte, e a única que não erra.
  if (temDoc) {
    const grafias = [docDigitos, String(parte.doc || '')].filter(Boolean);
    const [contatosPorDoc, leadsPorDoc] = await Promise.all([
      db.from('contacts' as any)
        .select('id, full_name, phone, cpf, lead_id')
        .in('cpf', grafias)
        .is('deleted_at', null)
        .limit(10),
      db.from('leads' as any)
        .select('id, lead_name, lead_phone, cpf')
        .in('cpf', grafias)
        .is('deleted_at', null)
        .limit(10),
    ]);
    for (const c of ((contatosPorDoc.data || []) as any[])) {
      achados.push({
        origem: 'contato', id: c.id, nome: c.full_name || parte.nome,
        telefone: c.phone || null, documento: c.cpf || null, leadId: c.lead_id || null,
        motivo: 'documento', score: tokenMatchScore(parte.nome, c.full_name),
      });
    }
    for (const l of ((leadsPorDoc.data || []) as any[])) {
      achados.push({
        origem: 'lead', id: l.id, nome: l.lead_name || parte.nome,
        telefone: l.lead_phone || null, documento: l.cpf || null, leadId: l.id,
        motivo: 'documento', score: tokenMatchScore(parte.nome, l.lead_name),
      });
    }
  }

  // 2) Nome igual ou parecido. O `ilike` traz demais (basta um token bater); o
  //    filtro fino é o `namesAreCompatible`, que exige sobrenome quando o nome
  //    da parte é completo — senão "Maria" casaria com meia base.
  const tokens = uniqueTokens(tokenizeName(parte.nome));
  if (tokens.length) {
    const busca = buildIlikeSearchTokens(
      [...tokens].sort((a, b) => b.length - a.length).slice(0, 4)
    );
    const [contatosPorNome, leadsPorNome] = await Promise.all([
      db.from('contacts' as any)
        .select('id, full_name, phone, cpf, lead_id')
        .or(busca.map((t) => `full_name.ilike.%${t}%`).join(','))
        .is('deleted_at', null)
        .limit(100),
      db.from('leads' as any)
        .select('id, lead_name, lead_phone, cpf')
        .or(busca.map((t) => `lead_name.ilike.%${t}%`).join(','))
        .is('deleted_at', null)
        .limit(100),
    ]);
    for (const c of ((contatosPorNome.data || []) as any[])) {
      if (!namesAreCompatible(parte.nome, c.full_name)) continue;
      achados.push({
        origem: 'contato', id: c.id, nome: c.full_name || '',
        telefone: c.phone || null, documento: c.cpf || null, leadId: c.lead_id || null,
        motivo: motivoPorNome(c.full_name), score: tokenMatchScore(parte.nome, c.full_name),
      });
    }
    for (const l of ((leadsPorNome.data || []) as any[])) {
      if (!namesAreCompatible(parte.nome, l.lead_name)) continue;
      achados.push({
        origem: 'lead', id: l.id, nome: l.lead_name || '',
        telefone: l.lead_phone || null, documento: l.cpf || null, leadId: l.id,
        motivo: motivoPorNome(l.lead_name), score: tokenMatchScore(parte.nome, l.lead_name),
      });
    }
  }

  return ordenarSugestoes(dedup(achados)).slice(0, 12);
}

/**
 * Marca quais telefones sugeridos já têm conversa no WhatsApp. Só existência:
 * a data da última mensagem exigiria `order by created_at` — o índice que serve
 * essa ordenação varre a tabela inteira quando o número não tem conversa.
 */
export async function marcarConversasDeWhatsApp(
  sugestoes: SugestaoDeContato[]
): Promise<SugestaoDeContato[]> {
  // Uma consulta por telefone, e não um `in` com todas as grafias juntas: o
  // índice devolve as linhas em ordem de telefone, então um número com muitas
  // mensagens comeria o limite e os outros voltariam como "sem conversa".
  const porTelefone = new Map<string, string[]>();
  for (const s of sugestoes) {
    const grafias = variantesDeTelefone(s.telefone);
    if (grafias.length) porTelefone.set(String(s.telefone), grafias);
  }
  if (!porTelefone.size) return sugestoes;

  const comConversa = new Set<string>();
  await Promise.all(
    Array.from(porTelefone.entries()).map(async ([telefone, grafias]) => {
      const { data, error } = await db
        .from('whatsapp_messages' as any)
        .select('id')
        .in('phone', grafias)
        .limit(1);
      if (error) {
        console.warn('Não deu para checar conversa de WhatsApp:', error.message);
        return;
      }
      if ((data || []).length) comConversa.add(telefone);
    })
  );
  return sugestoes.map((s) => ({
    ...s,
    temConversa: s.telefone ? comConversa.has(String(s.telefone)) : false,
  }));
}

/** Nota de cadastro — de onde esse contato saiu, para quem abrir depois. */
export function notaDeCadastro(parte: ParteParaBusca, processoNumero?: string | null): string {
  return [
    `Cadastrado via processo ${processoNumero || ''}`.trim(),
    parte.tipo ? `Participação: ${parte.tipo}` : null,
    parte.polo ? `Polo: ${parte.polo}` : null,
    parte.doc ? `Doc: ${parte.doc}` : null,
  ].filter(Boolean).join(' | ');
}

export interface ResultadoDoVinculo {
  contactId: string;
  /** false quando reaproveitou um contato que já existia. */
  criouContato: boolean;
  vinculouAoLead: boolean;
  /** Telefone que ficou no contato ao fim — null quando ninguém tinha um. */
  telefone: string | null;
}

/**
 * Grava a decisão do diálogo: reaproveita o contato escolhido ou cria um novo,
 * e liga ao lead do processo quando existe um.
 *
 * Sem lead o contato é criado do mesmo jeito — ele passa a existir na lista de
 * contatos e o vínculo com o lead pode vir depois. Antes a tela travava aqui e
 * o botão simplesmente não fazia nada.
 */
export async function vincularParteAContato(params: {
  parte: ParteParaBusca;
  processoNumero?: string | null;
  leadId?: string | null;
  /** Sugestão escolhida; sem ela, cria um contato novo. */
  escolha?: SugestaoDeContato | null;
  /** Telefone a gravar quando o contato de destino ainda não tem um. */
  telefone?: string | null;
  criadoPor?: string | null;
}): Promise<ResultadoDoVinculo> {
  const { parte, processoNumero, leadId, escolha, telefone, criadoPor } = params;

  let contactId: string;
  let criouContato = false;
  let telefoneFinal = telefone || escolha?.telefone || null;

  if (escolha?.origem === 'contato') {
    contactId = escolha.id;
    // Só preenche telefone vazio: sobrescrever o número de um contato existente
    // é decisão de quem edita o contato, não efeito colateral de vincular parte.
    if (telefone && !escolha.telefone) {
      const { error } = await db.from('contacts' as any).update({ phone: telefone }).eq('id', contactId);
      if (error) console.warn('Não deu para gravar o telefone no contato:', error.message);
      else telefoneFinal = telefone;
    } else {
      telefoneFinal = escolha.telefone || null;
    }
  } else {
    const cpf = tipoDeDocumento(parte.doc) === 'cpf' ? soDigitos(parte.doc) : null;
    const { data: novo, error } = await db
      .from('contacts' as any)
      .insert({
        full_name: parte.nome,
        phone: telefoneFinal,
        cpf,
        notes: notaDeCadastro(parte, processoNumero),
        lead_id: leadId || escolha?.leadId || null,
        created_by: criadoPor || null,
      } as any)
      .select('id')
      .single();
    if (error || !novo) throw error || new Error('Falha ao criar o contato');
    contactId = (novo as any).id;
    criouContato = true;
  }

  let vinculouAoLead = false;
  if (leadId) {
    const { error } = await db.from('contact_leads' as any).insert({ contact_id: contactId, lead_id: leadId });
    // 23505 = já estava vinculado, que é o resultado desejado.
    if (error && (error as any).code !== '23505') {
      console.warn('Não deu para vincular o contato ao lead:', error.message);
    } else {
      vinculouAoLead = true;
    }
  }

  return { contactId, criouContato, vinculouAoLead, telefone: telefoneFinal };
}
