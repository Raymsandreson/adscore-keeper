// =============================================================================
// Lê ATAS DE AUDIÊNCIA (PDF) e extrai o ACORDO HOMOLOGADO — data, valor,
// parcelas, devedor e se é acordo parcial.
//
// POR QUE ESTA FUNÇÃO EXISTE
// Acordo é o marco mais fraco da régua (57% de acerto contra o gabarito) e o de
// efeito financeiro mais direto: é ele que joga o recebível de PROJETADO para
// A RECEBER. A fraqueza tem causa conhecida e não se conserta com código de
// movimentação: acordo feito em audiência muitas vezes NÃO gera movimentação
// nenhuma. O caso que provou isso é o 0016074-62.2016.5.16.0014 — R$ 400.000 em
// 27 parcelas, homologado em 09/11/2016, e a única fonte é "Termo de audiência
// PJe ID 1a976f1", digitado à mão. Nas 97 movimentações baixadas do processo,
// nada.
//
// Há 362 atas de audiência já baixadas (336 com PDF em storage) cobrindo 79
// processos. É onde o acordo mora.
//
// A EXTRAÇÃO NÃO ENTRA NA RÉGUA SOZINHA. Grava em pop_marco_extracoes com
// revisado=false. Alguém confere e aprova antes de virar marco. Motivo: um
// falso "acordo homologado" move o processo de estação E reclassifica dinheiro
// no relatório do fundo. Falso negativo aqui custa muito menos que falso
// positivo — o prompt reflete isso.
//
// Body: { documento_id?, processo_cnj?, limit?, redo?, dry_run? }
//   documento_id  → uma ata específica
//   processo_cnj  → todas as atas daquele processo
//   (nenhum)      → fila: atas ainda não extraídas, respeitando limit (padrão 20)
//   redo          → reprocessa quem já tem extração
//   dry_run       → não grava, só devolve o que a IA respondeu
// =============================================================================
import type { RequestHandler } from 'express';
import { geminiChat } from '../lib/gemini';
import { supabase } from '../lib/supabase';

const MODEL = process.env.EXTRACT_AI_MODEL || 'google/gemini-3.6-flash';
const BUCKET = 'jm-autos';
const MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_LIMIT = 20;
const MARCO_CHAVE = 'acordo_homologado';

const SYSTEM = `Você lê ATAS DE AUDIÊNCIA da Justiça do Trabalho brasileira e responde UMA pergunta: houve ACORDO HOMOLOGADO nesta audiência?

RESPONDA "houve": true SOMENTE se o juízo HOMOLOGOU um acordo nesta ata.
São sinais de acordo homologado: "homologo o acordo", "homologa-se a conciliação",
"acordo homologado", "conciliação frutífera" seguida dos termos do ajuste, ou a ata
que registra as cláusulas do acordo e a chancela do juiz.

RESPONDA "houve": false quando:
- a conciliação foi INFRUTÍFERA, rejeitada, ou "não houve acordo";
- houve apenas PROPOSTA, tentativa, ou prazo para as partes avaliarem;
- a audiência foi adiada, redesignada, cancelada, ou as partes não compareceram;
- é audiência de instrução, com depoimentos e testemunhas, sem acordo;
- o acordo é mencionado como fato PASSADO de outro processo ou de outra audiência.

Proposta de acordo NÃO é acordo. Sem a homologação do juízo, é ato das partes.

ACORDO PARCIAL: é comum haver mais de um réu e o acordo alcançar só um deles,
com o processo PROSSEGUINDO contra os demais. Quando for esse o caso, marque
"parcial": true e escreva em "prossegue_contra" o nome de quem continua no polo
passivo. Isso é decisivo: o processo não acabou.

VALORES: extraia o valor TOTAL do acordo e, se houver parcelamento, o número de
parcelas e o valor de cada uma. Se o acordo divide valores por reclamante
(litisconsórcio — cônjuge, filhos, pais), liste em "por_reclamante" o nome e o
valor de cada um. Não some, não calcule, não estime: copie o que está escrito.
Se um número não estiver na ata, use null. NUNCA invente valor.

DATA: "data_homologacao" é a data da audiência em que o acordo foi homologado,
no formato AAAA-MM-DD. Se a ata não trouxer a data, use null.

CONFIANÇA: "alta" quando o texto é explícito ("homologo o acordo" + cláusulas);
"media" quando o acordo aparece mas faltam termos ou a redação é ambígua;
"baixa" quando o documento está ilegível, truncado ou você ficou em dúvida.

Na dúvida entre houve/não houve, responda false com confianca "baixa" e explique
em "motivo". Falso negativo aqui custa pouco — alguém confere depois. Falso
positivo move o processo de estação e reclassifica dinheiro no relatório do fundo.

Responda APENAS um objeto JSON:
{
  "houve": true|false,
  "data_homologacao": "AAAA-MM-DD"|null,
  "valor_total": number|null,
  "n_parcelas": number|null,
  "valor_parcela": number|null,
  "devedor": string|null,
  "parcial": true|false,
  "prossegue_contra": string|null,
  "por_reclamante": [{"nome": string, "valor": number|null}],
  "confianca": "alta"|"media"|"baixa",
  "motivo": string,
  "trecho": string
}
"trecho" é a citação literal (até 300 caracteres) que sustenta a resposta — o
pedaço da ata onde está a homologação. Se houve=false, cite o trecho que mostra
o desfecho da audiência.`;

interface AtaRow {
  id: number;
  processo_cnj: string;
  titulo: string | null;
  data_documento: string | null;
  storage_path: string | null;
}

interface Extraido {
  houve: boolean;
  data_homologacao: string | null;
  valor_total: number | null;
  n_parcelas: number | null;
  valor_parcela: number | null;
  devedor: string | null;
  parcial: boolean;
  prossegue_contra: string | null;
  por_reclamante: { nome: string; valor: number | null }[];
  confianca: 'alta' | 'media' | 'baixa';
  motivo: string;
  trecho: string;
}

/** Extrai o objeto JSON da resposta, tolerando cerca de ```json e texto em volta. */
function parseObjeto(raw: string): Record<string, unknown> | null {
  const limpo = (raw || '').replace(/```json\s*|```/gi, '').trim();
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    const v = JSON.parse(limpo.slice(ini, fim + 1));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numeroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dataOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizar(o: Record<string, unknown>): Extraido {
  const conf = String(o.confianca ?? 'baixa');
  const lista = Array.isArray(o.por_reclamante) ? o.por_reclamante : [];
  return {
    houve: o.houve === true,
    data_homologacao: dataOuNull(o.data_homologacao),
    valor_total: numeroOuNull(o.valor_total),
    n_parcelas: numeroOuNull(o.n_parcelas),
    valor_parcela: numeroOuNull(o.valor_parcela),
    devedor: o.devedor ? String(o.devedor).slice(0, 200) : null,
    parcial: o.parcial === true,
    prossegue_contra: o.prossegue_contra ? String(o.prossegue_contra).slice(0, 200) : null,
    por_reclamante: lista.map((r) => {
      const item = (r || {}) as Record<string, unknown>;
      return { nome: String(item.nome ?? '').slice(0, 200), valor: numeroOuNull(item.valor) };
    }).filter((r) => r.nome),
    confianca: conf === 'alta' || conf === 'media' ? conf : 'baixa',
    motivo: String(o.motivo ?? '').slice(0, 500),
    trecho: String(o.trecho ?? '').slice(0, 300),
  };
}

async function lerAta(ata: AtaRow): Promise<Extraido | { erro: string }> {
  if (!ata.storage_path) return { erro: 'documento sem storage_path' };

  const { data: signed, error: signErr } = await supabase
    .storage.from(BUCKET).createSignedUrl(ata.storage_path, 300);
  if (signErr || !signed?.signedUrl) {
    return { erro: `signed url: ${signErr?.message || 'sem url'}` };
  }

  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) return { erro: `download ${resp.status}` };
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return { erro: `PDF grande demais (${buffer.byteLength} bytes)` };
  if (buffer.byteLength === 0) return { erro: 'PDF vazio' };

  const base64 = Buffer.from(buffer).toString('base64');

  const contexto = [
    `Processo: ${ata.processo_cnj}`,
    ata.data_documento ? `Data do documento no sistema: ${ata.data_documento}` : null,
    'Leia a ata anexada e responda o JSON pedido.',
  ].filter(Boolean).join('\n');

  const r = await geminiChat({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: contexto },
          { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } },
        ],
      },
    ],
    temperature: 0,
    // Folgado de propósito: com pouco teto o thinking do Gemini 3.x come o
    // orçamento e a resposta volta truncada no meio do JSON.
    max_tokens: 4096,
    thinking_budget: 0,
    response_json: true,
  });

  const texto = r?.choices?.[0]?.message?.content ?? '';
  const obj = parseObjeto(typeof texto === 'string' ? texto : JSON.stringify(texto));
  if (!obj) return { erro: 'resposta da IA não é JSON' };
  return normalizar(obj);
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const { documento_id, processo_cnj, limit, redo, dry_run } = (req.body || {}) as {
      documento_id?: number;
      processo_cnj?: string;
      limit?: number;
      redo?: boolean;
      dry_run?: boolean;
    };

    let q = supabase
      .from('jm_documentos')
      .select('id, processo_cnj, titulo, data_documento, storage_path')
      .ilike('titulo', '%ata da audi%')
      .not('storage_path', 'is', null);

    if (documento_id) q = q.eq('id', documento_id);
    else if (processo_cnj) q = q.eq('processo_cnj', processo_cnj);

    const teto = Math.min(Number(limit) || DEFAULT_LIMIT, 100);
    // Universo inteiro, não teto*3: com uma janela curta, assim que os primeiros
    // N documentos já estão extraídos a fila volta vazia e os seguintes nunca
    // são vistos — foi o que aconteceu ao parar em 210 de 336. São poucas
    // centenas de linhas leves (id, cnj, título, data, path); o corte real é o
    // .slice(0, teto) depois de tirar o que já foi feito.
    const { data: atas, error } = await q.order('data_documento', { ascending: false }).limit(5000);
    if (error) throw error;
    if (!atas?.length) return ok({ success: true, lidas: 0, detalhe: 'nenhuma ata com PDF encontrada' });

    // Pula o que já foi extraído, salvo redo.
    let fila = atas as AtaRow[];
    if (!redo) {
      const { data: jaFeitos } = await supabase
        .from('pop_marco_extracoes')
        .select('documento_id')
        .eq('marco_chave', MARCO_CHAVE)
        .in('documento_id', fila.map((a) => a.id));
      const feitos = new Set((jaFeitos || []).map((r: { documento_id: number }) => r.documento_id));
      fila = fila.filter((a) => !feitos.has(a.id));
    }
    fila = fila.slice(0, teto);

    const resultados: Record<string, unknown>[] = [];
    let comAcordo = 0;
    let erros = 0;

    for (const ata of fila) {
      const r = await lerAta(ata);

      if ('erro' in r) {
        erros++;
        resultados.push({ documento_id: ata.id, processo_cnj: ata.processo_cnj, erro: r.erro });
        continue;
      }
      if (r.houve) comAcordo++;

      resultados.push({
        documento_id: ata.id,
        processo_cnj: ata.processo_cnj,
        houve: r.houve,
        data: r.data_homologacao,
        valor_total: r.valor_total,
        parcial: r.parcial,
        confianca: r.confianca,
        motivo: r.motivo,
      });

      if (dry_run) continue;

      const { error: upErr } = await supabase.from('pop_marco_extracoes').upsert({
        documento_id: ata.id,
        processo_cnj: ata.processo_cnj,
        marco_chave: MARCO_CHAVE,
        houve: r.houve,
        // Sem data na ata, cai para a data do documento — que é a da audiência.
        data_extraida: r.data_homologacao || ata.data_documento,
        dados: {
          valor_total: r.valor_total,
          n_parcelas: r.n_parcelas,
          valor_parcela: r.valor_parcela,
          devedor: r.devedor,
          parcial: r.parcial,
          prossegue_contra: r.prossegue_contra,
          por_reclamante: r.por_reclamante,
        },
        confianca: r.confianca,
        motivo: r.motivo,
        trecho: r.trecho,
        modelo: MODEL,
        revisado: false,
      }, { onConflict: 'documento_id,marco_chave' });

      if (upErr) {
        erros++;
        console.error(`[extract-acordo-from-ata] upsert doc ${ata.id}:`, upErr.message);
      }
    }

    console.log(`extract-acordo-from-ata: ${fila.length} ata(s), ${comAcordo} com acordo, ${erros} erro(s)`);
    return ok({
      success: true,
      lidas: fila.length,
      com_acordo: comAcordo,
      erros,
      restam: Math.max(0, atas.length - fila.length),
      dry_run: !!dry_run,
      resultados,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('extract-acordo-from-ata error:', msg);
    return ok({ success: false, error: msg });
  }
};
