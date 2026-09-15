// Regras puras da consulta Data Stone aplicada a um lead.
//
// Separado do handler de propósito: é aqui que mora o que decide se a consulta
// vale o crédito e se o retorno pode encostar na ficha do cliente. O vitest da
// raiz importa este arquivo (não toca banco nem rede).
import { createHash } from 'node:crypto';
import { getLocationFromDDD } from './ddd-mapping';

export type MotivoRecusa = 'vazio' | 'id_de_grupo' | 'tamanho' | 'ddd_desconhecido';

export interface TelefoneConsultavel {
  ddd: string;
  numero: string;
  e164: string;
}

/**
 * Decide se um `lead_phone` pode virar consulta paga.
 *
 * Os formatos saíram de uma amostra de 400 leads da fila alvo (15/09/2026):
 * 364 em `55`+11 dígitos, 27 em `55`+10, 1 com 11 dígitos sem DDI e **8 com um
 * ID de grupo do WhatsApp gravado no campo de telefone** (`120363019728479551`).
 * Esse último é o que justifica a função existir: mandar isso para a API é
 * crédito gasto para receber nada.
 */
export interface ResultadoTelefone {
  /** null quando o valor não pode virar consulta. */
  tel: TelefoneConsultavel | null;
  motivo?: MotivoRecusa;
  detalhe?: string;
}

/*
 * Objeto único em vez de união discriminada de propósito: o tsconfig do
 * railway-server roda com `strict: false`, e sem strictNullChecks o TypeScript
 * não estreita união por um campo booleano — `if (!r.ok)` não libera `r.motivo`.
 */
export function telefoneParaConsulta(leadPhone: string | null | undefined): ResultadoTelefone {
  const digitos = (leadPhone || '').replace(/\D/g, '');
  if (!digitos) return { tel: null, motivo: 'vazio', detalhe: 'lead sem telefone' };

  // ID de grupo do WhatsApp tem 17-20 dígitos; telefone brasileiro nunca passa de 13.
  if (digitos.length > 13) {
    return { tel: null, motivo: 'id_de_grupo', detalhe: `${digitos.length} dígitos — é ID de grupo, não telefone` };
  }

  let nacional: string;
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    nacional = digitos.slice(2);
  } else if (digitos.length === 10 || digitos.length === 11) {
    nacional = digitos;
  } else {
    return { tel: null, motivo: 'tamanho', detalhe: `${digitos.length} dígitos não formam telefone BR` };
  }

  const ddd = nacional.slice(0, 2);
  const numero = nacional.slice(2);
  if (!getLocationFromDDD(digitos)) {
    return { tel: null, motivo: 'ddd_desconhecido', detalhe: `DDD ${ddd} não existe no Brasil` };
  }
  if (numero.length !== 8 && numero.length !== 9) {
    return { tel: null, motivo: 'tamanho', detalhe: `número com ${numero.length} dígitos` };
  }

  return { tel: { ddd, numero, e164: `55${ddd}${numero}` } };
}

/** Chave do cache. Guardamos o hash, não o dado — o valor em claro já vive em `leads`. */
export function hashChave(tipo: string, valor: string): string {
  return createHash('sha256').update(`${tipo}:${valor.replace(/\D/g, '')}`).digest('hex');
}

export interface PessoaDataStone {
  cpf?: string;
  name?: string;
  mother_name?: string;
  birthday?: string;
  rg?: string | null;
  addresses?: Array<{
    type?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    district?: string;
    postal_code?: string;
    priority?: number;
  }>;
}

export interface LeadParaEnriquecer {
  cpf?: string | null;
  rg?: string | null;
  birth_date?: string | null;
  cep?: string | null;
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
}

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/**
 * Monta o UPDATE do lead a partir do retorno da Data Stone.
 *
 * Só preenche campo VAZIO. Nunca sobrescreve o que já está lá — o dado do CRM
 * foi digitado por quem falou com o cliente, e o da Data Stone é cadastro de
 * base pública, que envelhece. Divergência não é erro a corrigir em silêncio:
 * volta em `divergentes` para alguém olhar.
 */
export function camposParaGravar(
  lead: LeadParaEnriquecer,
  pessoa: PessoaDataStone,
): { campos: Record<string, string>; divergentes: string[] } {
  const campos: Record<string, string> = {};
  const divergentes: string[] = [];

  const por = (coluna: keyof LeadParaEnriquecer, valor?: string | null) => {
    const v = (valor ?? '').toString().trim();
    if (!v) return;
    if (vazio(lead[coluna])) campos[coluna] = v;
    else if (String(lead[coluna]).replace(/\W/g, '').toUpperCase() !== v.replace(/\W/g, '').toUpperCase()) {
      divergentes.push(coluna);
    }
  };

  por('cpf', (pessoa.cpf || '').replace(/\D/g, ''));
  por('rg', pessoa.rg || '');
  por('birth_date', pessoa.birthday || '');

  // A API devolve várias moradas; `priority: 1` é a que ela considera principal.
  const end = [...(pessoa.addresses || [])].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
  if (end) {
    const logradouro = [end.type, end.street].filter(Boolean).join(' ').trim();
    por('street', logradouro);
    por('street_number', end.number || '');
    por('complement', end.complement || '');
    por('neighborhood', end.neighborhood || '');
    por('city', end.city || '');
    // `district` vem como sigla de UF no payload da Data Stone.
    por('state', (end.district || '').length === 2 ? end.district : '');
    por('cep', (end.postal_code || '').replace(/\D/g, ''));
  }

  return { campos, divergentes };
}
