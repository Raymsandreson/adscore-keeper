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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'gemini-2.5-flash';
const BUCKET = 'jm-autos';

const SYSTEM_PROMPT = `Você lê UMA peça de processo trabalhista/cível brasileiro e devolve o que ela diz sobre DINHEIRO e sobre o ESTADO da execução.

Devolva SOMENTE um JSON com estas chaves:
- "especie": uma de COMPROVANTE_PAGAMENTO | ALVARA | MANIFESTACAO_INADIMPLENCIA | EXTINCAO_QUITACAO | CERTIDAO_TRANSITO | DECISAO | DESPACHO | ATA_AUDIENCIA | SENTENCA | ACORDO | PETICAO_INICIAL | OUTRO
  * EXTINCAO_QUITACAO: extinção da execução por acordo cumprido / obrigação satisfeita. É prova de que o dinheiro entrou.
  * CERTIDAO_TRANSITO: certidão de trânsito em julgado.
- "valor": número (use ponto decimal, sem R$ nem separador de milhar) ou null. SÓ dinheiro que ENTROU ou saiu: pago, liberado, depositado, bloqueado. Condenação NÃO entra aqui — tem campo próprio.
- "valor_condenacao": valor que a peça FIXA a pagar (indenização, dano moral, dano estético, pensão), ou null. É o que o processo passa a valer, não o que foi pago.
- "valor_custas": custas processuais fixadas, ou null.
- "valor_honorario_sucumbencial": honorário de sucumbência fixado, ou null.
- "beneficiario_valor": nome da parte a quem o valor fixado pertence, quando a peça nomear. null se for global ou não identificável.
- "data_evento": "AAAA-MM-DD" do fato (pagamento, liberação, bloqueio) ou null.
- "n_parcela": número da parcela a que o valor se refere, ou null.
- "destino_valor": COTA_CLIENTE | HONORARIO | AMBOS | INDEFINIDO.
- "inadimplencia": true SOMENTE se a peça mostra que o devedor deixou de pagar (petição do exequente noticiando descumprimento, instauração de IDPJ, desconsideração da personalidade jurídica, pedido de penhora por falta de pagamento). false caso contrário.
- "sem_bens": true se houver pesquisa/penhora negativa, "não foram encontrados bens", insolvência. false caso contrário.
- "recuperacao_judicial": true se mencionar recuperação judicial, falência ou habilitação de crédito do devedor.
- "confianca": 0 a 1, quão seguro você está da leitura.
- "resumo": 1-2 frases objetivas do que a peça decide ou noticia.

REGRAS DURAS:
1. NÃO INVENTE. Se a peça não traz o dado, use null/false. Preferir null a chutar é o comportamento correto.
2. "Homologação de acordo em execução" NÃO é inadimplência — é o oposto. "Extinção da execução" também não.
3. Mero expediente, publicação, conclusão e remessa não movem dinheiro: especie OUTRO, valor null.
4. Distinga PROMESSA de PAGAMENTO: acordo dizendo "pagará em 11 parcelas" não é comprovante. Comprovante é o que declara que JÁ foi pago/liberado.
5. Distinga FIXAR de PAGAR: acórdão que majora dano moral para R$ 300.000 preenche valor_condenacao, e valor fica null. Sentença que declara a obrigação satisfeita é EXTINCAO_QUITACAO.
6. Em litisconsórcio, se a peça fixa valor para uma parte nomeada, preencha beneficiario_valor com o nome dela.
7. Responda apenas o JSON, sem markdown.`;

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
    const { documento_id } = await req.json();
    if (!documento_id) return json({ success: false, error: 'documento_id é obrigatório' });

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

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
            generationConfig: { responseMimeType: 'application/json', temperature: 0 },
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
    });
  } catch (e) {
    return json({ success: false, error: String((e as Error)?.message || e).slice(0, 300) });
  }
});
