// =============================================================================
// Classificação de MARCOS processuais por IA (Gemini Flash).
//
// POR QUE existe, já que escavadorMarcos.ts já classifica:
// o parser determinístico só olha os primeiros 180 caracteres (HEAD_CHARS) e
// decide por palavra-chave. Auditoria de 05/08/2026 sobre as 603 linhas de
// `fonte='escavador'` que deu pra cruzar com o jsonb cru:
//
//   acordao_2grau     96 linhas — 9 são acórdão de verdade. O resto é
//                     "Certidão de Publicação" (12), "Disponibilização no DJE"
//                     (10), "Contrarrazões" (9), "Recurso Ordinário" (6)…
//   acordao_superior  20 linhas — NENHUMA é acórdão de tribunal superior;
//                     são interposições de RE e remessas.
//   acordo            54 linhas — "de Conciliação" (6) e "Una" (3) são
//                     AUDIÊNCIAS virando acordo, o que empurra o processo da
//                     estação 2/4 direto pra 6.
//   pagamento         44 linhas — "Levantamento da Suspensão" casa a keyword
//                     'levantamento' e vira pagamento.
//   transito_julgado  15 linhas — único marco confiável hoje.
//
// A raiz não é a janela de 180 chars, é semântica: a lista de keywords não
// distingue A DECISÃO do ATO DA PARTE que a provoca nem do EXPEDIENTE que a
// publica. "Contrarrazões da apelação" contém 'apelacao'; "Recurso Ordinário"
// também. Nenhuma janela de texto conserta isso — por isso IA.
//
// Contrato: este módulo NÃO grava nada e NÃO decide sozinho. Devolve
// tipo + confiança + motivo; quem chama compara com o determinístico e decide.
// =============================================================================

import type { EscavadorMovimentacao } from './escavadorMarcos.ts';

/** As 10 estações canônicas + 'nenhum'. Mesma escala de marco_ordem_canonica() no banco. */
export type MarcoIATipo =
  | 'peticao_inicial'
  | 'audiencia_conciliacao'
  | 'pericia'
  | 'audiencia_instrucao'
  | 'sentenca_1grau'
  | 'acordo'
  | 'acordao_2grau'
  | 'acordao_superior'
  | 'transito_julgado'
  | 'pagamento'
  | 'nenhum';

/** Espelha public.marco_ordem_canonica(). O banco continua sendo a autoridade:
 *  o trigger trg_process_movements_marco_ordem recarimba em INSERT e UPDATE. */
export const MARCO_ORDEM_CANONICA: Record<Exclude<MarcoIATipo, 'nenhum'>, number> = {
  peticao_inicial: 1,
  audiencia_conciliacao: 2,
  pericia: 3,
  audiencia_instrucao: 4,
  sentenca_1grau: 5,
  acordo: 6,
  acordao_2grau: 7,
  acordao_superior: 8,
  transito_julgado: 9,
  pagamento: 10,
};

const TIPOS_VALIDOS = new Set<string>([...Object.keys(MARCO_ORDEM_CANONICA), 'nenhum']);

export interface MovParaClassificar {
  /** Chave estável do chamador (id da linha, índice, o que for). Volta intacta. */
  ref: string;
  predita: string | null;
  titulo: string | null;
  texto: string;
}

export interface MarcoIAResultado {
  ref: string;
  tipo: MarcoIATipo;
  confianca: 'alta' | 'media' | 'baixa';
  motivo: string;
}

// Lote pequeno por decisão anterior desta base (triagem de notícias, jul/2026):
// acima de 8 itens o Flash começa a devolver resultado no índice errado. Aqui o
// dano seria pior — marco trocado entre processos de clientes diferentes — então
// além do lote curto cada item leva um `ref` explícito que precisa voltar.
const LOTE = 8;
/** Teto por movimentação. Inteiro teor de acórdão passa de 50k chars e não agrega. */
const MAX_CHARS = 3000;

const SYSTEM = `Você classifica movimentações processuais brasileiras em MARCOS do ciclo de vida do processo.

Os marcos possíveis (use exatamente estes rótulos):
- peticao_inicial: o ajuizamento/distribuição ORIGINAL da ação. Conta a primeira distribuição, a autuação, a certidão de distribuição e o "Distribuído por sorteio" de ABERTURA do processo.
- audiencia_conciliacao: audiência de conciliação designada ou realizada.
- pericia: perícia designada, realizada, ou laudo pericial juntado.
- audiencia_instrucao: audiência de instrução (ou "una") designada ou realizada.
- sentenca_1grau: SENTENÇA de mérito ou extintiva proferida em 1º grau.
- acordo: acordo HOMOLOGADO pelo juízo (ou sentença que homologa acordo).
- acordao_2grau: ACÓRDÃO PROFERIDO por tribunal de 2º grau (TRT, TJ, TRF).
- acordao_superior: ACÓRDÃO PROFERIDO por tribunal superior (TST, STJ, STF).
- transito_julgado: trânsito em julgado certificado.
- pagamento: quitação efetiva — alvará EXPEDIDO, RPV/precatório PAGO, levantamento de valores, comprovante de pagamento.
- nenhum: qualquer outra coisa.

REGRA CENTRAL — só é marco o ATO DECISÓRIO DO JUÍZO ou o FATO CONSUMADO.

EXCEÇÃO ÚNICA E IMPORTANTE: peticao_inicial. O ajuizamento é ato da parte e sua
distribuição é expediente de cartório, e mesmo assim É MARCO — é a estação 1 da régua,
o nascimento do processo. Não descarte o ajuizamento por ser "ato da parte" ou
"expediente de cartório". A regra central vale para as estações 2 a 10.

Não são marcos:
1. ATOS DAS PARTES depois do ajuizamento: recurso interposto (apelação, recurso ordinário, RE, REsp), contrarrazões, embargos, impugnação, manifestação, pedido, juntada de petição avulsa. Interpor recurso NÃO é ter acórdão. Pedir alvará NÃO é receber.
2. EXPEDIENTES DE CARTÓRIO: certidão de publicação, disponibilização no Diário da Justiça, intimação, remessa, conclusão, decurso de prazo, alteração de classe, expedição de mandado, inclusão em pauta de julgamento. (A autuação e a certidão de distribuição do ajuizamento ficam de fora desta lista — ver a exceção acima.)
3. MENÇÕES NO CORPO: sentença que diz "após o trânsito em julgado, arquive-se" NÃO é trânsito em julgado. Condenação "ao pagamento de" NÃO é pagamento.

Armadilhas conhecidas nesta base:
- "Distribuído por sorteio" é AJUIZAMENTO quando abre o processo, e é apenas remessa ao relator quando o processo JÁ SUBIU ao tribunal (o texto cita relator, câmara, turma, desembargador ou o recurso em julgamento). Só nesse segundo caso → nenhum. Na dúvida entre os dois, prefira peticao_inicial: existe uma guarda posterior que descarta ajuizamento com data posterior a um marco mais avançado.
- Acórdão que ANULA sentença, converte em diligência ou extingue o recurso É acórdão do tribunal → acordao_2grau. Não exija mérito.
- "Cumprimento de sentença" / "Execução" é fase posterior, NÃO é sentenca_1grau.
- "Levantamento da suspensão"/"dessobrestamento" é retomada do processo, não levantamento de dinheiro → nenhum.
- "Audiência de Conciliação", "Audiência Una", "Certidão de audiência realizada" são audiências, NÃO acordo. Só marque acordo se houver acordo HOMOLOGADO.
- Movimentação sigilosa/confidencial sem conteúdo → nenhum.
- O texto costuma começar com o timbre do tribunal ("PODER JUDICIÁRIO…"). Ignore o timbre e leia o teor.

Na dúvida, responda "nenhum". Falso negativo custa pouco; falso positivo move o processo de estação e mente no painel de metas.

Responda APENAS um array JSON, um objeto por item recebido, com as chaves:
"ref" (o mesmo ref que veio), "tipo", "confianca" ("alta"|"media"|"baixa"), "motivo" (até 12 palavras).
Devolva um objeto para CADA ref recebido, sem inventar refs.`;

function montarLote(itens: MovParaClassificar[]): string {
  return itens.map((it) => {
    const partes = [`### ref: ${it.ref}`];
    if (it.predita) partes.push(`Classificação do provedor: ${it.predita}`);
    if (it.titulo) partes.push(`Título: ${it.titulo}`);
    partes.push(`Teor: ${(it.texto || '').slice(0, MAX_CHARS)}`);
    return partes.join('\n');
  }).join('\n\n');
}

/** Extrai o array JSON da resposta, tolerando cerca de ```json e texto em volta. */
function parseArray(raw: string): unknown[] {
  const limpo = raw.replace(/```json\s*|```/gi, '').trim();
  const ini = limpo.indexOf('[');
  const fim = limpo.lastIndexOf(']');
  if (ini < 0 || fim <= ini) return [];
  try {
    const v = JSON.parse(limpo.slice(ini, fim + 1));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export interface ClassificarOpts {
  /** Injetado pelo chamador (edge usa geminiChat de _shared/gemini.ts). */
  chat: (opts: {
    model?: string;
    messages: unknown[];
    temperature?: number;
    max_tokens?: number;
    thinking_budget?: number;
  }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
  model?: string;
  /** Chamado a cada lote — só pra log de progresso. */
  onLote?: (feitos: number, total: number) => void;
}

/**
 * Classifica em lotes de 8. Um lote que falhar ou vier inconsistente é
 * DESCARTADO (os refs dele simplesmente não aparecem no Map) — nunca cai num
 * palpite. O chamador trata ausência como "mantém o que já estava".
 */
export async function classificarMarcosIA(
  movs: MovParaClassificar[],
  opts: ClassificarOpts,
): Promise<Map<string, MarcoIAResultado>> {
  const out = new Map<string, MarcoIAResultado>();
  if (!movs.length) return out;

  for (let i = 0; i < movs.length; i += LOTE) {
    const lote = movs.slice(i, i + LOTE);
    const refsEsperados = new Set(lote.map((l) => l.ref));

    try {
      const resp = await opts.chat({
        model: opts.model || 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: montarLote(lote) },
        ],
        temperature: 0,
        max_tokens: 2048,
        // Flash em lote: thinking come o orçamento de saída e trunca o JSON.
        thinking_budget: 0,
      });

      const texto = resp?.choices?.[0]?.message?.content ?? '';
      for (const item of parseArray(texto)) {
        const o = item as Record<string, unknown>;
        const ref = String(o?.ref ?? '');
        const tipo = String(o?.tipo ?? '');
        // Ref que não foi enviado = alucinação ou embaralhamento: ignora.
        if (!refsEsperados.has(ref) || out.has(ref)) continue;
        if (!TIPOS_VALIDOS.has(tipo)) continue;
        const conf = String(o?.confianca ?? 'baixa');
        out.set(ref, {
          ref,
          tipo: tipo as MarcoIATipo,
          confianca: conf === 'alta' || conf === 'media' ? conf : 'baixa',
          motivo: String(o?.motivo ?? '').slice(0, 120),
        });
      }
    } catch (e) {
      console.error('[marcosIA] lote falhou:', e instanceof Error ? e.message : String(e));
      // Segue pro próximo lote: perder 8 classificações não justifica abortar tudo.
    }

    opts.onLote?.(Math.min(i + LOTE, movs.length), movs.length);
  }

  return out;
}

/** Monta o item de entrada a partir da movimentação crua do Escavador. */
export function movParaClassificar(ref: string, mov: EscavadorMovimentacao): MovParaClassificar {
  return {
    ref,
    predita: mov.classificacao_predita?.nome?.trim() || null,
    titulo: (mov.titulo || mov.tipo || '').toString().trim() || null,
    texto: (mov.conteudo || mov.descricao || '').toString(),
  };
}
