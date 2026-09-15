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
  // Acrescentado em 15/09/2026. O formulario "TAFFAREL - BPC" existia e nao
  // casava com keyword nenhuma: 61 leads em 4 dias (11 a 15/09) entraram no
  // board BPC com `source` "Meta Lead Ads — BPC - Autismo", isto e, SEM DONO.
  // Lead sem dono nao recebe status da planilha e nao gera aviso para ninguem.
  // Antes de 'api' de proposito: 'api' e generica e casa por acidente.
  { keyword: 'taffarel', operator: 'Taffarel' },
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
  // Os mesmos nomes depois que a planilha foi traduzida (ver abaixo). Sem eles
  // a linha de cabecalho da planilha nova ganhava 4 acertos de 26 — passava por
  // pouco, e uma aba com um lead colado no topo teria empatado com ela.
  'id do lead', 'data / hora', 'status do lead', 'responsavel', 'respons\u00e1vel',
  'crian\u00e7a', 'whatsapp', 'campanha', 'conjunto de an\u00fancios', 'an\u00fancio',
  'formul\u00e1rio', 'plataforma', 'observa\u00e7\u00f5es',
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


// ============================================================
// EM QUAL COLUNA ESTA O STATUS QUE A EQUIPE ESCREVE
// ============================================================
//
// Mesma armadilha do telefone, e desta vez custou um funil inteiro: o leitor
// procurava exatamente `status da lead`, e a planilha do Auxilio Acidente usa
// `status lead` — sem o "da". Resultado medido em 14/09/2026: aquele funil
// aplicava ZERO status, e o diagnostico nem mostrava a coluna, porque a lista de
// contagem tambem nao a conhecia. Nao aparecia como erro; aparecia como
// "a equipe nao preenche", que e uma conclusao errada sobre pessoas.
//
// `lead_status` fica DE FORA em qualquer caso: e coluna da exportacao da Meta e
// vale sempre "created". Foi ela que, com `||`, curto-circuitava a leitura da
// coluna de verdade na primeira versao desta funcao.

/** Colunas de status da equipe, na ordem de confianca. `lead_status` nunca entra. */
const COLUNAS_DE_STATUS = [
  'status da lead', 'status lead', 'status do lead', 'status_da_lead', 'status',
  'situacao', 'situação', 'status atendimento',
];

/** Coluna da exportacao da Meta — nunca e o status da equipe. */
const NAO_E_STATUS_DA_EQUIPE = new Set(['lead_status', 'status_lead_meta']);

/**
 * Acha o status escrito pela equipe, mesmo quando a coluna tem nome inesperado.
 * Devolve em minusculas e sem espaco nas pontas, pronto para o de-para.
 */
export function celulaDeStatusDaEquipe(o: Record<string, string>): string {
  for (const c of COLUNAS_DE_STATUS) {
    if (NAO_E_STATUS_DA_EQUIPE.has(c)) continue;
    const v = String(o[c] ?? '').trim();
    if (v) return v.toLowerCase();
  }
  for (const [chave, valor] of Object.entries(o)) {
    const k = String(chave).toLowerCase();
    if (NAO_E_STATUS_DA_EQUIPE.has(k) || !k.includes('status')) continue;
    const v = String(valor ?? '').trim();
    if (v) return v.toLowerCase();
  }
  return '';
}

/** Os nomes que o diagnostico deve contar, para a coluna aparecer mesmo quando ninguem a le. */
export const COLUNAS_DE_STATUS_PARA_DIAGNOSTICO = [
  'lead_status', ...COLUNAS_DE_STATUS, 'observações', 'observacoes',
];


// ============================================================
// QUANDO A PLANILHA MUDA DE IDIOMA
// ============================================================
//
// Medido em 15/09/2026: a planilha do BPC foi reformatada para portugues e o
// leitor descartou **3.456 de 3.456 linhas** — 3.431 delas como "nome vazio".
// Nao era nome vazio: `nome_completo` e `full_name` tinham virado `responsavel`,
// `created_time` tinha virado `data / hora`, e `id` tinha virado `id do lead`.
// O ultimo fechamento que chegou ao CRM por esse caminho e de 11/09.
//
// Sobreviveram exatamente as duas colunas que ja eram lidas por PEDACO do nome:
// telefone (`whatsapp`) e status (`status do lead`). E a licao, de novo, a mesma
// de `celulaDeTelefone` e `celulaDeStatusDaEquipe` — so que desta vez o nome da
// coluna nao mudou por causa de um formulario reescrito a mao, mudou porque a
// planilha inteira foi traduzida. Lista exata envelhece; o de-para abaixo da
// para as duas grafias ao mesmo tempo.
//
// O NOME segue sem busca por pedaco, e agora por um motivo ainda mais concreto:
// a planilha nova tem `responsavel` (o titular) E `crianca` (o dependente) lado
// a lado. Procurar "nome" por pedaco cadastraria a crianca no lugar de quem
// assina o contrato.

/** Colunas de NOME do titular, sempre exatas. `crianca` jamais entra aqui. */
const COLUNAS_DE_NOME = [
  'nome_completo', 'full_name', 'responsável', 'responsavel',
  'nome do responsável', 'nome do responsavel', 'titular', 'nome',
];

/** Nome do titular na linha. Vazio quando nenhuma das colunas conhecidas tem valor. */
export function celulaDeNome(o: Record<string, string>): string {
  for (const c of COLUNAS_DE_NOME) {
    const v = String(o[c] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/**
 * De-para das colunas da exportacao da Meta para os nomes que a planilha usa.
 *
 * A chave e o nome canonico (o que o resto do codigo ja conhece); a lista e a
 * ordem de tentativa. Um lugar so: quando a proxima planilha for traduzida de
 * outro jeito, muda aqui e vale para todos os campos de uma vez.
 */
const DE_PARA_DAS_COLUNAS: Record<string, string[]> = {
  id: ['id', 'id do lead', 'id_do_lead', 'id da lead', 'lead id', 'lead_id'],
  created_time: ['created_time', 'data / hora', 'data/hora', 'data e hora', 'data_hora', 'data'],
  campaign_name: ['campaign_name', 'campanha', 'nome da campanha'],
  adset_name: ['adset_name', 'conjunto de anúncios', 'conjunto de anuncios', 'conjunto'],
  ad_name: ['ad_name', 'anúncio', 'anuncio', 'nome do anúncio', 'nome do anuncio'],
  form_name: ['form_name', 'formulário', 'formulario'],
  estado_civil: ['estado_civil', 'marital_status', 'estado civil'],
  platform: ['platform', 'plataforma'],
};

/** Valor de um campo da Meta na linha, seja qual for a grafia da coluna. */
export function celulaDaMeta(o: Record<string, string>, campo: keyof typeof DE_PARA_DAS_COLUNAS): string {
  for (const c of DE_PARA_DAS_COLUNAS[campo] || []) {
    const v = String(o[c] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/** Id do lead na Meta, ja limpo, venha a coluna com o nome que vier. */
export function celulaDeIdDaMeta(o: Record<string, string>): string {
  return normalizaLeadIdMeta(celulaDaMeta(o, 'id'));
}


// ============================================================
// DATA ESCRITA NA PLANILHA
// ============================================================
//
// `new Date('15/09/2026')` e `Invalid Date`. Enquanto a coluna se chamava
// `created_time` isso nao aparecia — a Meta exporta ISO. A planilha traduzida
// escreve no formato de quem preenche, e uma data ilegivel aqui nao estoura:
// cai fora da janela e a linha some, calada.
//
// Fuso fixo em -03:00 de proposito: a planilha e preenchida no Brasil. Sem ele,
// `15/09/2026 08:00` viraria 05:00 da manha em Brasilia, e uma linha da primeira
// hora do dia cairia no dia anterior.

/** Serial de data do Sheets: dias desde 30/12/1899. A faixa cobre 1955-2064. */
const SERIAL_MIN = 20000;
const SERIAL_MAX = 60000;

/**
 * Data da planilha em ISO, ou '' quando a celula nao e data.
 *
 * Aceita ISO (o que a Meta exporta), `dd/mm/aaaa [hh:mm[:ss]]` (o que gente
 * escreve) e o serial do Sheets (o que aparece quando a coluna esta formatada
 * como numero). Dia e mes sao lidos na ordem brasileira; `03/04` e 3 de abril.
 */
export function dataDaPlanilha(bruto: string | number | undefined | null): string {
  const t = String(bruto ?? '').trim();
  if (!t) return '';

  // ISO — deixa o proprio Date resolver, que e o caminho da exportacao da Meta.
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    let ano = Number(br[3]);
    if (ano < 100) ano += 2000;
    return montaEmBrasilia(ano, Number(br[2]), Number(br[1]), Number(br[4] ?? 0), Number(br[5] ?? 0), Number(br[6] ?? 0));
  }

  // Serial do Sheets. So numero puro dentro da faixa — `2026` sozinho nao e data.
  if (/^\d+([.,]\d+)?$/.test(t)) {
    const n = Number(t.replace(',', '.'));
    if (n >= SERIAL_MIN && n <= SERIAL_MAX) {
      // O serial conta dia local da planilha, nao instante UTC: le-se em UTC so
      // para separar os componentes, e remonta-se em Brasilia. Sem isso um
      // serial inteiro vira 21h do dia anterior e cai no dia errado do grafico.
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (isNaN(d.getTime())) return '';
      return montaEmBrasilia(
        d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
      );
    }
  }

  return '';
}

/**
 * Componentes de data -> ISO, tratando a hora como de Brasilia.
 *
 * Recusa o que nao existe no calendario. `31/02/2026` monta uma string bem
 * formada e o `Date` a ACEITA, rolando para 3 de marco — uma data plausivel,
 * errada, e que nada denunciaria depois. A conferencia e o ultimo dia do mes,
 * que ja cobre fevereiro e ano bissexto.
 */
function montaEmBrasilia(ano: number, mes: number, dia: number, hh: number, mm: number, ss: number): string {
  if (mes < 1 || mes > 12 || dia < 1) return '';
  if (hh > 23 || mm > 59 || ss > 59) return '';
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimoDiaDoMes) return '';
  const p = (n: number, c = 2) => String(n).padStart(c, '0');
  const d = new Date(`${p(ano, 4)}-${p(mes)}-${p(dia)}T${p(hh)}:${p(mm)}:${p(ss)}-03:00`);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Data em que o formulario foi preenchido, seja qual for a grafia da coluna. */
export function celulaDeDataDoFormulario(o: Record<string, string>): string {
  return dataDaPlanilha(celulaDaMeta(o, 'created_time'));
}


// ============================================================
// DATA DO FECHAMENTO — A COLUNA QUE AINDA NAO EXISTE
// ============================================================
//
// Medido em 15/09/2026: NENHUMA das duas planilhas tem coluna de data de
// fechamento, e no CRM 27 dos 28 fechamentos pagos nao tem pista nenhuma da data
// real (zero assinatura de ZapSign, um grupo datado). Por isso `became_client_date`
// hoje guarda o dia em que a planilha foi lida — 22 dos 28 caem em 09/09, o dia
// da primeira leitura.
//
// Esta funcao existe para o dia em que alguem criar a coluna: a partir dai a
// data verdadeira passa a valer sozinha, sem deploy novo. Enquanto a coluna nao
// existir ela devolve '' e o sync segue carimbando o dia da leitura, que com o
// cron de 60 em 60 minutos erra por menos de uma hora daqui para a frente.
//
// A coluna e reconhecida pelo nome E pelo valor: uma coluna "tem contrato?" com
// "sim" dentro nao vira data, porque `dataDaPlanilha` recusa.

const PEDACOS_DE_FECHAMENTO = [
  'fechamento', 'fechou', 'fechada', 'fechado',
  'contrato', 'assinatura', 'assinou', 'assinado',
];

/** Data em que a equipe diz que fechou, em ISO. '' quando a planilha nao diz. */
export function celulaDeDataDeFechamento(o: Record<string, string>): string {
  for (const [chave, valor] of Object.entries(o)) {
    const k = String(chave).toLowerCase();
    if (!PEDACOS_DE_FECHAMENTO.some((p) => k.includes(p))) continue;
    const iso = dataDaPlanilha(valor);
    if (iso) return iso;
  }
  return '';
}


// ============================================================
// POR QUE A LINHA CAIU
// ============================================================
//
// `isJunkName` e o filtro de telefone dizem SE a linha serve. Nao dizem por que
// nao serve, e os consertos sao opostos: `<test lead>` e ruido que deve cair,
// celular sem DDD e dado recuperavel, celula vazia e pedido na origem. Um
// contador unico ("45 descartados") esconde os tres.
//
// O `bpc-sheet-sync` ja classificava assim desde 11/09/2026 — foi o que revelou
// que as 114 linhas recusadas por telefone eram 45 celulares sem DDD e 42
// celulas vazias, e nao lixo. O caminho da API da Meta nao classificava, e por
// isso a mesma pergunta la nao tinha resposta. Estas funcoes servem aos dois.

/** Por que este nome foi recusado. Classificacao pura: nenhum valor sai daqui. */
export function motivoDeNomeRecusado(nome: string | undefined | null): string {
  const t = String(nome ?? '').trim();
  if (!t) return 'celula vazia';
  if (t.length < 3) return 'menos de 3 caracteres';
  if (t.startsWith('<test')) return 'placeholder <test';
  if (/^\.+$/.test(t)) return 'so pontos';
  return 'sem letra latina';
}

/**
 * Por que este telefone foi recusado. So a contagem de digitos sai daqui.
 *
 * `9 digitos` e celular sem DDD e `10 digitos` e fixo sem DDI — os dois sao
 * dado que existe e nao foi aproveitado. `celula vazia` e `sem digito nenhum`
 * sao pedido na origem. Ver [[grupo-incerto-nao-manda-avisa]]: a saida NUNCA e
 * adivinhar o DDD.
 */
export function motivoDeTelefoneRecusado(bruto: string | undefined | null, normalizado: string): string {
  if (!String(bruto ?? '').trim()) return 'celula vazia';
  if (!normalizado.length) return 'sem digito nenhum';
  return `${normalizado.length} digitos`;
}
