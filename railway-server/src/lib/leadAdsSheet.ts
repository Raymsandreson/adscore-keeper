// Funções puras da planilha de Lead Ads. Módulo separado de propósito: o
// `bpc-sheet-sync` importa o cliente Supabase, e teste que só quer checar
// formato de string não deveria precisar de credencial para rodar. Mesmo
// padrão de `metaCapiNormalize`.

/**
 * Id do lead na Meta, como a Conversion Leads API espera: número puro.
 *
 * A exportação de Lead Ads escreve `l:1009263962139850` — com prefixo. Em
 * 04/09/2026 gravei 131 linhas assim e só percebi olhando o dado no banco:
 * `length = 18` em vez dos 15-17 dígitos do spec. Id com prefixo é o mesmo que
 * id nenhum, e falha lá na Meta, calada — nada estoura deste lado.
 */
export function normalizaLeadIdMeta(bruto: string | undefined | null): string {
  const digitos = String(bruto || '').replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : '';
}

// ---------------------------------------------------------------------------
// Abaixo: o que a planilha e a API da Meta PRECISAM compartilhar.
//
// Os dois caminhos criam lead no mesmo board e deduplicam por telefone. Se cada
// um normalizar telefone do seu jeito, o dedup de um nao enxerga o do outro e a
// mesma pessoa entra duas vezes. Por isso mora aqui, num lugar so, com teste.
// ---------------------------------------------------------------------------

/**
 * Telefone em digitos, com 55 quando aplicavel.
 *
 * O `p:` vem da exportacao de Lead Ads, mesma familia do `l:` do id.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = String(raw).replace(/^p:/i, '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

/** Chave de dedup: os 8 ultimos digitos ignoram DDI, DDD e o 9 movel. */
export function phoneKey(digits: string): string {
  return digits.slice(-8);
}

export function isJunkName(s: string): boolean {
  const t = (s || '').trim();
  if (!t || t.length < 3) return true;
  if (t.startsWith('<test')) return true;
  if (/^\.+$/.test(t)) return true;
  if (!/[a-zà-ú]/i.test(t)) return true;
  return false;
}

/**
 * Mapeamento por PALAVRA-CHAVE, nao por nome exato.
 *
 * Vale para aba de planilha ("1LEADS EDILAN") e para nome de formulario da Meta
 * ("AUXILIO - ACIDENTE [EDILAN-3]", "MATEUS - BPC") — a mesma pessoa aparece
 * escrita de meia duzia de formas.
 */
export const OPERATOR_KEYWORDS: { keyword: string; operator: string }[] = [
  { keyword: 'israel', operator: 'Israel' },
  { keyword: 'cris', operator: 'Cris' },
  { keyword: 'mateus', operator: 'Mateus' },
  { keyword: 'edilan', operator: 'Edilan' },
  { keyword: 'karol', operator: 'Karolyne' },
  { keyword: 'andressa', operator: 'Andressa' },
  { keyword: 'keilane', operator: 'Keilane' },
  { keyword: 'api', operator: 'API' },
];

/** Operador de um texto livre, ou null. Null vira lista de pendencia, nao palpite. */
export function casaOperador(texto: string): string | null {
  const lower = String(texto || '').toLowerCase();
  const m = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
  return m ? m.operator : null;
}


// ============================================================
// ONDE ESTA O CABECALHO
// ============================================================
//
// A exportacao da Meta para o Sheets nao garante que a primeira linha seja o
// cabecalho. Basta alguem inserir uma linha, colar um registro no topo ou
// reordenar, e a linha 1 vira dado. Medido em 11/09/2026: a aba `MATEUS - 2`
// tinha um lead na linha 1 e o cabecalho na linha 2 — o leitor usou o lead como
// nome de coluna e descartou as 874 linhas da aba. A `KAROLYNE` tinha o mesmo
// defeito, com 36.
//
// A alternativa era pedir para a equipe apagar a linha toda vez que isso
// acontecesse. Isso nao e conserto: transfere para a pessoa um trabalho que o
// programa faz melhor, e falha calado de novo no dia em que ninguem lembrar.
//
// Aqui o cabecalho e PROCURADO: entre as primeiras linhas, vence a que mais
// parece cabecalho — a que traz mais nomes de coluna conhecidos. Se nenhuma
// parecer, cai na primeira linha, que e o comportamento antigo; assim uma aba
// com nomes de coluna inesperados nao fica pior do que ja era.

/** Nomes de coluna que a exportacao da Meta usa. Servem de prova de que a linha e cabecalho. */
const COLUNAS_DA_META = new Set([
  'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name',
  'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic', 'platform',
  'full_name', 'nome_completo', 'phone_number', 'telefone', 'celular',
  'lead_status', 'marital_status', 'estado_civil', 'cpf', 'job_title', 'cargo',
]);

/** Valor com cara de id de lead da Meta: `l:1086829373844173` ou so os digitos. */
const PARECE_ID_DA_META = /^(l:)?[0-9]{10,20}$/;

export interface CabecalhoAchado {
  /** Indice da linha do cabecalho dentro de `values`. */
  linha: number;
  /** Celulas do cabecalho, ja normalizadas (minusculas, sem espaco nas pontas). */
  headers: string[];
  /** Quantos nomes de coluna conhecidos a linha vencedora tinha. 0 = nao achou, caiu no padrao. */
  acertos: number;
  /** `true` quando a primeira coluna estava sem rotulo e foi batizada de `id`. */
  id_recuperado: boolean;
}

/**
 * Acha a linha de cabecalho e devolve os nomes de coluna normalizados.
 *
 * Tambem conserta a primeira coluna sem rotulo: a aba `KAROL - 2` tinha o
 * cabecalho certo na linha 1, mas a celula A1 vazia — e sem o nome `id` as
 * linhas nao carregavam o id da Meta, entao o status escrito pela equipe nao
 * casava com lead nenhum. Se a coluna sem nome guarda ids da Meta nas linhas de
 * baixo, ela e `id`; isso e evidencia, nao chute.
 */
export function achaCabecalho(values: any[][], limite = 5): CabecalhoAchado {
  const normaliza = (linha: any[]) => (linha || []).map((h) => String(h ?? '').toLowerCase().trim());
  const ate = Math.min(limite, values.length);
  let melhor = { linha: 0, acertos: 0 };
  for (let i = 0; i < ate; i++) {
    const acertos = normaliza(values[i]).filter((h) => COLUNAS_DA_META.has(h)).length;
    // `>` e nao `>=`: empate fica com a linha de cima, que e a ordem natural.
    if (acertos > melhor.acertos) melhor = { linha: i, acertos };
  }
  const headers = normaliza(values[melhor.linha] || []);

  let idRecuperado = false;
  if (headers.length && !headers[0]) {
    const olhaAte = Math.min(values.length, melhor.linha + 12);
    let comCaraDeId = 0;
    let olhadas = 0;
    for (let i = melhor.linha + 1; i < olhaAte; i++) {
      const v = String(values[i]?.[0] ?? '').trim();
      if (!v) continue;
      olhadas += 1;
      if (PARECE_ID_DA_META.test(v)) comCaraDeId += 1;
    }
    if (olhadas > 0 && comCaraDeId === olhadas) {
      headers[0] = 'id';
      idRecuperado = true;
    }
  }

  return { linha: melhor.linha, headers, acertos: melhor.acertos, id_recuperado: idRecuperado };
}


// ============================================================
// EM QUAL COLUNA ESTA O TELEFONE
// ============================================================
//
// Era uma lista de nomes exatos, e ela envelhece: a planilha do Auxilio Acidente
// tem `qual_o_seu_número_para_contato_?` e o leitor procurava
// `qual_o_seu_número_de_contato_?` — uma palavra de diferenca, e a linha caia
// como "sem telefone". Cada formulario novo que alguem cria com a pergunta
// escrita de outro jeito repete isso, calado.
//
// O `meta-leads-sync` ja lia por PEDACO do nome desde o comeco, e por isso nao
// sofria do mesmo problema. Aqui a regra passa a ser a mesma, com uma diferenca
// que importa: so o TELEFONE ganha busca por pedaco.
//
// O nome NAO ganha. O formulario do BPC pergunta `qual_o_nome_da_criança_?`, e
// buscar "nome" por pedaco pegaria o nome do dependente para o cadastro do
// titular — trocar o cliente por outra pessoa e pior do que nao achar o campo.

/** Colunas de telefone conhecidas, tentadas primeiro por serem as mais confiaveis. */
const COLUNAS_DE_TELEFONE = [
  'telefone', 'phone_number', 'celular', 'número_do_whatsapp', 'numero_do_whatsapp',
];

/** Pedacos que denunciam uma coluna de telefone escrita de outro jeito. */
const PEDACOS_DE_TELEFONE = ['telefone', 'contato', 'whats', 'phone', 'celular'];

/**
 * Acha o telefone na linha, mesmo quando a coluna tem nome inesperado.
 *
 * A busca por pedaco so aceita valor com 10+ digitos: sem isso, uma coluna
 * "melhor horario de contato" entregaria texto no lugar do numero.
 */
export function celulaDeTelefone(o: Record<string, string>): string {
  for (const c of COLUNAS_DE_TELEFONE) {
    const v = String(o[c] ?? '').trim();
    if (v) return v;
  }
  for (const [chave, valor] of Object.entries(o)) {
    const k = String(chave).toLowerCase();
    if (!PEDACOS_DE_TELEFONE.some((p) => k.includes(p))) continue;
    const v = String(valor ?? '').trim();
    if (v.replace(/\D/g, '').length >= 10) return v;
  }
  return '';
}
