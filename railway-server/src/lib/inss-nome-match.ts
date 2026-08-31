// ============================================================================
// "De quem é este requerimento?" — casamento por nome, com prova forte.
//
// 312 dos 1.032 requerimentos vivos do INSS não têm lead nem caso (medido em
// 31/08/2026). Eles seguram 622 e-mails que NUNCA viraram atividade nem
// mensagem: 60 exigências com prazo, das quais 53 já venceram sem ninguém ver.
// Só 18 têm CPF, e o número do requerimento não aparece em lugar nenhum do
// sistema (conferido em lead_processes, no campo "Nº Requerimento INSS" e nas
// 1.685 atividades que falam de protocolo). Sobra o nome.
//
// O caminho por nome que existia casava PRIMEIRO + ÚLTIMO token, e só olhava
// `victim_name` e `contacts.full_name` — com `ilike '%sobrenome%' limit 30`,
// que é cego para Silva/Santos e para acento ("ANTONIO" não acha "Antônio").
// Frouxo e curto ao mesmo tempo: "RITA MARIA FERREIRA DA SILVA" casava com o
// lead "Rita de Cassia Silva martins", e 3 seguradas diferentes casavam com o
// mesmo lead apagado "Maria do Nascimento".
//
// A regra aqui é a mais forte que ainda pega os casos reais:
//   - o nome do segurado inteiro cabe no nome do alvo (o alvo costuma ser mais
//     completo: "PREV 879 | Mariceli de Silva Barreto/ Aux."), ou
//   - o nome do alvo inteiro cabe no do segurado E tem 3+ nomes próprios
//     ("Luan Antônio Silva" ⊂ "LUAN ANTONIO SILVA DE SOUZA"). O piso de 3 é o
//     que separa isso de "Maria do Nascimento", que engolia meio mundo.
//
// Medido sobre os 312: 18 casam com dono único, 15 ficam ambíguos e 279 não
// têm nenhum lead com aquele nome — a maioria BPC de criança e
// salário-maternidade, em que o requerente é o menor e o cadastro está no nome
// da mãe. Esses 279 nenhuma regra resolve; é conferência humana.
// ============================================================================

import { RUIDO_DE_ROTULO, normalizarNome } from './inss-nome-confere';

const STOPWORDS = new Set([
  'DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU',
  'JR', 'JUNIOR', 'NETO', 'NETA', 'FILHO', 'FILHA', 'SOBRINHO',
]);

/** Nomes próprios de um texto: sem preposição, sem rótulo de funil, sem dígito. */
export function tokensDePessoa(texto?: string | null): string[] {
  return normalizarNome(texto)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !RUIDO_DE_ROTULO.has(t) && !/\d/.test(t));
}

/**
 * Um nome é o outro? Só em duas formas, ambas exigindo conjunto inteiro —
 * interseção parcial (o velho primeiro+último) não vale.
 */
export function casaNomeCompleto(segurado: string[], alvo: string[]): boolean {
  // Nome repetido não conta duas vezes: "Prev 41 Luiz Fernando/Fernando" tem
  // três tokens e só dois nomes, e passaria pelo piso de 3 sem ser um nome
  // completo. Era justo o requerimento cuja exigência vencia no dia do conserto.
  const seg = [...new Set(segurado)];
  const alv = [...new Set(alvo)];
  if (seg.length < 2 || alv.length < 2) return false;
  const noAlvo = new Set(alv);
  if (seg.every((t) => noAlvo.has(t))) return true;
  const noSegurado = new Set(seg);
  if (alv.length >= 3 && alv.every((t) => noSegurado.has(t))) return true;
  return false;
}

export interface AlvoNome {
  leadId: string;
  /** Texto que casou, para o log e para a conferência humana. */
  nome: string;
  tokens: string[];
}

export type EscolhaPorNome =
  | { leadId: string; alvo: AlvoNome; motivo: string }
  | { leadId: null; motivo: string };

/**
 * Escolhe o dono pelo nome — e só devolve lead quando ele é ÚNICO. Dois
 * candidatos viram silêncio de propósito: requerimento pendurado na pessoa
 * errada é pior que requerimento sem dono, porque a partir daí ele passa a
 * gerar atividade e mensagem para quem não tem nada com aquilo.
 */
export function escolherPorNome(nomeSegurado: string | null | undefined, alvos: AlvoNome[]): EscolhaPorNome {
  const segurado = tokensDePessoa(nomeSegurado);
  if (segurado.length < 2) return { leadId: null, motivo: 'nome do segurado curto demais' };

  const porLead = new Map<string, AlvoNome>();
  for (const alvo of alvos) {
    if (!porLead.has(alvo.leadId) && casaNomeCompleto(segurado, alvo.tokens)) {
      porLead.set(alvo.leadId, alvo);
    }
  }
  if (porLead.size === 0) return { leadId: null, motivo: 'nenhum lead com esse nome' };
  if (porLead.size > 1) {
    const nomes = [...porLead.values()].slice(0, 3).map((a) => a.nome).join(' | ');
    return { leadId: null, motivo: `${porLead.size} leads com esse nome (${nomes})` };
  }
  const [alvo] = [...porLead.values()];
  return { leadId: alvo.leadId, alvo, motivo: `nome completo confere com "${alvo.nome}"` };
}
