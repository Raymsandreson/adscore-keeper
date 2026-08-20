// =============================================================================
// jm-ler-peca — lê UMA peça dos autos e grava o que ela diz de dinheiro e de
// estado do processo em `jm_documento_leitura`.
//
// Por que existe (17/08/2026): o DataJud não publica penhora, bloqueio nem
// desconsideração — medido: ZERO movimento desses na base inteira. A
// inadimplência do caso 88 só existe como DOCUMENTO ("Despacho instauração de
// IDPJ"). Sem ler peça, 297 parcelas (R$ 583 mil) ficam em PRECISA_LER para
// sempre, e a régua nunca sabe se o dinheiro entrou.
//
// A regra de negócio que orienta a extração é do Raym: no silêncio do executado
// presume-se pago; quando fica inadimplente, o exequente se manifesta. Por isso
// o que mais importa aqui não é só "achou um valor?" — é distinguir comprovante
// de pagamento de manifestação de descumprimento.
//
// ONDE RODA: no Supabase, de propósito. O bucket `jm-autos` é privado e desta
// função (service role) ele é lido direto, sem URL assinada. O disparo em lote
// sai do próprio banco por pg_net, no mesmo desenho do `jm_esc_disparar`.
//
// NADA daqui vira valor_pago sozinho: peça é alegação, não fato conciliado.
// `jm_documento_leitura.revisado_por` é o que promove leitura a número oficial.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-jm-key',
};

const MODEL = 'gemini-2.5-flash';
const BUCKET = 'jm-autos';

const PROMPT_VERSAO = "v2-verbas-2026-08-20";

const SYSTEM_PROMPT = `Você lê UMA peça de processo trabalhista/cível brasileiro e devolve DUAS coisas:
(A) o que ela diz sobre DINHEIRO QUE ANDOU e sobre o ESTADO da execução;
(B) o que ela FIXA de valor, aberto POR PARTE e POR VERBA.

Devolva SOMENTE um JSON, sem markdown.

═══ BLOCO A — caixa e estado ═══
- "especie": COMPROVANTE_PAGAMENTO | ALVARA | MANIFESTACAO_INADIMPLENCIA | EXTINCAO_QUITACAO | CERTIDAO_TRANSITO | DECISAO | DESPACHO | ATA_AUDIENCIA | SENTENCA | SENTENCA_LIQUIDACAO | ACORDO | PETICAO_INICIAL | LAUDO_PERICIAL | CALCULO | OUTRO
  * SENTENCA_LIQUIDACAO: sentença/decisão que APURA os valores devidos. É a peça mais rica em verbas.
  * EXTINCAO_QUITACAO: extinção por acordo cumprido. Prova de que o dinheiro entrou.
- "valor": número (ponto decimal, sem R$) ou null. SÓ dinheiro que ENTROU ou SAIU: pago, liberado, depositado, bloqueado. Condenação NÃO entra aqui.
- "valor_condenacao": total que a peça FIXA a pagar, ou null. É o que o processo passa a valer.
- "valor_custas", "valor_honorario_sucumbencial": fixados, ou null.
- "beneficiario_valor": nome da parte a quem o valor pertence, se nomeada. null se global.
- "data_evento": "AAAA-MM-DD" do fato, ou null.
- "n_parcela": número da parcela, ou null.
- "destino_valor": COTA_CLIENTE | HONORARIO | AMBOS | INDEFINIDO.
- "inadimplencia": true SOMENTE se mostra que o devedor deixou de pagar (petição noticiando descumprimento, IDPJ, desconsideração da personalidade jurídica, penhora por falta de pagamento).
- "sem_bens": true se pesquisa/penhora negativa, "não foram encontrados bens", insolvência.
- "recuperacao_judicial": true se mencionar recuperação judicial, falência ou habilitação de crédito.
- "confianca": 0 a 1.
- "resumo": 1-2 frases do que a peça decide ou noticia.

═══ BLOCO B — partes e verbas ═══
- "partes": lista. UMA ENTRADA POR PARTE AUTORA/RECLAMANTE nomeada na peça, com os valores DELA.
  Lista VAZIA se a peça não fixa valor por parte. Cada entrada:
  * "nome": nome da parte autora, como está na peça.
  * "parentesco" em relação à vítima, TAXATIVO e em caixa alta:
    VÍTIMA | CÔNJUGE | FILHO | PAIS | IRMÃO | PADRASTO | ENTEADO | NETO | AVÓS | TIOS | null
    (se a parte autora é a própria vítima, use VÍTIMA)
  * "nascimento": "AAAA-MM-DD" ou null.
  * "meses_pensionamento": número de meses de pensão fixados PARA ESTA PARTE, ou null.
  * "verbas": lista das verbas DESTA PARTE. Cada uma:
    - "tipo", TAXATIVO: DANO_MORAL | DANO_ESTETICO | DANO_MATERIAL_BASE | PENSAO_MENSAL |
      HORAS_EXTRAS | ADICIONAL_INSALUBRIDADE | ADICIONAL_PERICULOSIDADE | ADICIONAL_NOTURNO |
      FGTS | VERBAS_RESCISORIAS | 13_SALARIO | FERIAS | AVISO_PREVIO | MULTA_477 | MULTA_467 |
      RETROATIVO | LUCROS_CESSANTES | DESPESAS_MEDICAS | OUTRA
    - "descricao": obrigatório quando tipo=OUTRA; o nome da verba como a peça chama. null nos demais.
    - "valor": número ou null.
    - "periodicidade": MENSAL quando for pensão/valor recorrente; UNICA nos demais.
  * DANO_MATERIAL_BASE é a BASE DE CÁLCULO mensal do pensionamento, não o total.
    Se a peça der o total e a base, traga a base em DANO_MATERIAL_BASE e o total em PENSAO_MENSAL.

═══ BLOCO C — o processo, quando a peça informar ═══
- "processo": objeto (campos ausentes = null):
  * "decisao_tipo", TAXATIVO em caixa alta: SEM DECISÃO | ACORDO ANTES DA SENTENÇA | SENTENÇA |
    ACORDO COM SENTENÇA | EMBARGOS 1º GRAU | 2º EMBARGOS 1º GRAU | ACÓRDÃO 2º GRAU |
    EMBARGOS 2º GRAU | ACORDO COM ACÓRDÃO 2º GRAU | DECISÃO TST | ACÓRDÃO TST |
    ACORDO COM ACÓRDÃO TST | DECISÃO STJ | ACÓRDÃO STJ | DECISÃO STF | ACÓRDÃO STF
  * "forma_pagamento", TAXATIVO: PARCELA ÚNICA | PARCELAMENTO | FÓRMULA DO VALOR PRESENTE | ACORDO | null
  * "hs_pct": só o número do percentual de honorário sucumbencial (ex: 15), ou null.
  * "desagio_pct": número, ou null.
  * "termo_inicial_jcm": "AAAA-MM-DD" — início de juros e correção, ou null.
  * "data_acidente": "AAAA-MM-DD" ou null.
  * "data_decisao": "AAAA-MM-DD" da decisão, ou null.
  * "orgao_julgador", "relator_juiz", "empresa_re": texto ou null.
  * "causa_acidente": descrição objetiva, ou null.
  * "vitima_profissao": texto ou null.
  * "vitima_salario": número ou null.
  * "vitima_idade": número ou null.

═══ BLOCO D — cronograma, quando a peça o estabelecer ═══
- "cronograma": lista de parcelas que a peça FIXA (acordo parcelado, pensão, plano de pagamento).
  Vazia se a peça não estabelece cronograma. Cada item:
  * "n_parcela": número.
  * "data_prevista": "AAAA-MM-DD" ou null.
  * "valor": número ou null.
  * "beneficiario": nome da parte, ou null se for global.

═══ REGRAS DURAS ═══
1. NÃO INVENTE. Se a peça não traz o dado, use null / lista vazia. Preferir null a chutar é o comportamento CORRETO e esperado.
2. FIDELIDADE AO DOCUMENTO ANEXADO. Use apenas o que está NESTA peça. Não complete com conhecimento de outras peças do processo nem com o que é "comum" nesse tipo de caso.
3. SÓ A PARTE DISPOSITIVA. Quando for decisão judicial, extraia o que o JUIZ DECIDIU — o dispositivo, que fica ao final. NÃO extraia os pedidos das partes, nem valores citados no relatório, nem teses da fundamentação. Em petição inicial, aí sim valem os pedidos. Em acordo, vale o que foi acordado.
4. CUIDADO COM QUEM É A PARTE. Não troque autor por réu, nem parte por advogado, nem parte por perito. Na dúvida sobre a quem pertence um valor, deixe beneficiario_valor null em vez de atribuir errado.
5. Distinga PROMESSA de PAGAMENTO: acordo dizendo "pagará em 11 parcelas" preenche "cronograma", não "valor". Comprovante é o que declara que JÁ foi pago.
6. Distinga FIXAR de PAGAR: acórdão que majora dano moral para R$ 300.000 preenche valor_condenacao e as verbas; "valor" fica null.
7. "Homologação de acordo em execução" NÃO é inadimplência — é o oposto. "Extinção da execução" também não.
8. Mero expediente, publicação, conclusão e remessa não movem dinheiro nem fixam verba: especie OUTRO, valor null, partes [], cronograma [].
9. Valor global sem abertura por parte: preencha valor_condenacao e deixe "partes" vazia. Não divida por igual entre as partes por conta própria.
10. As listas marcadas TAXATIVO só aceitam os valores listados, em caixa alta, sem abreviação. Se nada servir, use null.`;

interface Documento {
  id: number;
  processo_cnj: string;
  titulo: string | null;
  data_documento: string | null;
  storage_path: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verificação de origem. A função roda com `verify_jwt = false` porque quem
    // chama é o banco por pg_net, sem sessão de usuário — então a validação tem
    // que ser manual aqui. Sem isso é um endpoint público que queima Gemini e
    // lê autos de bucket privado para quem descobrir a URL.
    // O segredo mora em `jm_config` (RLS ligada, sem policy: só service role
    // alcança) e não em env var nem no código — nada de secret no repositório.
    const enviada = req.headers.get('x-jm-key') ?? '';
    const { data: cfg } = await sb
      .from('jm_config').select('valor').eq('chave', 'jm_ler_peca_key').maybeSingle();
    const esperada = (cfg as { valor?: string } | null)?.valor ?? '';
    if (!esperada || enviada !== esperada) {
      return json({ success: false, error: 'não autorizado' }, 401);
    }

    const { documento_id } = await req.json();
    if (!documento_id) return json({ success: false, error: 'documento_id é obrigatório' });

    const { data: doc, error: erroDoc } = await sb
      .from('jm_documentos')
      .select('id, processo_cnj, titulo, data_documento, storage_path')
      .eq('id', documento_id)
      .maybeSingle<Documento>();

    if (erroDoc) return json({ success: false, error: `documento: ${erroDoc.message}` });
    if (!doc) return json({ success: false, error: 'documento não encontrado' });
    if (!doc.storage_path) return json({ success: false, error: 'peça sem arquivo baixado' });

    // Bucket privado: baixa com service role em vez de assinar URL.
    const { data: arquivo, error: erroArquivo } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (erroArquivo || !arquivo) {
      return json({ success: false, error: `storage: ${erroArquivo?.message || 'sem arquivo'}` });
    }

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    // Base64 em blocos: btoa(String.fromCharCode(...bytes)) estoura a pilha em
    // PDF de alguns MB (spread de centenas de milhares de argumentos).
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(bin);

    // API do Google no formato nativo, não pelo _shared/gemini.ts: aqui o PDF vai
    // como inline_data e `responseMimeType: application/json` obriga o modelo a
    // devolver JSON puro — sem cerca de markdown para limpar depois.
    const chave = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!chave) return json({ success: false, error: 'GOOGLE_AI_API_KEY não configurada' });

    let lido: Record<string, unknown>;
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(chave)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
              role: 'user',
              parts: [
                {
                  text:
                    `Processo: ${doc.processo_cnj}\n` +
                    `Título da peça nos autos: ${doc.titulo ?? '(sem título)'}\n` +
                    `Data do documento: ${doc.data_documento ?? '(sem data)'}\n` +
                    `Leia a peça anexa e devolva o JSON conforme instruído.`,
                },
                { inline_data: { mime_type: 'application/pdf', data: base64 } },
              ],
            }],
            // temperatura 0: extração de dado de peça não é lugar de criatividade
            // maxOutputTokens explícito: o JSON do prompt v2 traz partes, verbas e
            // cronograma e ficou bem maior que o do v1. Sem teto alto o Gemini
            // corta no meio e o JSON.parse estoura — falha que aparece como
            // "leitura:" genérico e custa a chamada do mesmo jeito.
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0,
              maxOutputTokens: 8192,
            },
          }),
        },
      );
      if (!r.ok) {
        const detalhe = (await r.text()).replace(/\s+/g, ' ').slice(0, 300);
        return json({ success: false, documento_id, error: `gemini ${r.status}: ${detalhe}` });
      }
      const resposta = await r.json();
      const bruto = resposta?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      lido = JSON.parse(String(bruto));
    } catch (e) {
      return json({ success: false, documento_id, error: `leitura: ${String((e as Error)?.message).slice(0, 300)}` });
    }

    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const registro = {
      documento_id: doc.id,
      processo_cnj: doc.processo_cnj,
      especie: (lido.especie as string) ?? 'OUTRO',
      valor: num(lido.valor),
      data_evento: (lido.data_evento as string) ?? null,
      n_parcela: num(lido.n_parcela),
      destino_valor: (lido.destino_valor as string) ?? 'INDEFINIDO',
      valor_condenacao: num(lido.valor_condenacao),
      valor_custas: num(lido.valor_custas),
      valor_honorario_sucumbencial: num(lido.valor_honorario_sucumbencial),
      beneficiario_valor: (lido.beneficiario_valor as string) ?? null,
      inadimplencia: lido.inadimplencia === true,
      sem_bens: lido.sem_bens === true,
      recuperacao_judicial: lido.recuperacao_judicial === true,
      confianca: num(lido.confianca),
      resumo: (lido.resumo as string) ?? null,
      // Blocos novos: valor por parte e por verba, dados do processo e o
      // cronograma que a peça FIXA (promessa, não pagamento).
      partes: Array.isArray(lido.partes) ? lido.partes : [],
      processo: (lido.processo && typeof lido.processo === 'object') ? lido.processo : null,
      cronograma: Array.isArray(lido.cronograma) ? lido.cronograma : [],
      prompt_versao: PROMPT_VERSAO,
      // Guarda o JSON cru: se o prompt mudar, dá para reprocessar sem pagar de novo.
      texto_extraido: JSON.stringify(lido),
      modelo: MODEL,
    };

    const { error: erroGrava } = await sb
      .from('jm_documento_leitura')
      .upsert(registro, { onConflict: 'documento_id' });
    if (erroGrava) return json({ success: false, documento_id, error: `gravar: ${erroGrava.message}` });

    return json({
      success: true, documento_id, especie: registro.especie,
      valor: registro.valor, valor_condenacao: registro.valor_condenacao,
      inadimplencia: registro.inadimplencia,
      partes: (registro.partes as unknown[]).length,
      verbas: (registro.partes as { verbas?: unknown[] }[])
        .reduce((n, p) => n + (p?.verbas?.length ?? 0), 0),
      cronograma: (registro.cronograma as unknown[]).length,
    });
  } catch (e) {
    return json({ success: false, error: String((e as Error)?.message || e).slice(0, 300) });
  }
});
