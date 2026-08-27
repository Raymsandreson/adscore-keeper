// =============================================================================
// jm-perguntar-peca — responde UMA pergunta livre sobre UMA peça dos autos.
// Roda no projeto EXTERNO (kmedldlepwiityjsdahz), onde vive o bucket jm-autos.
//
// POR QUE EXISTE (27/08/2026, pedido do Raym na Conferência do processo):
// `jm-ler-peca` extrai um JSON fechado — espécie, valores, partes, cronograma.
// Serve para virar número, não para tirar dúvida. A pergunta que aparece com a
// trilha aberta é sempre a que o prompt não previu: "esse não-provimento é de
// mérito ou de agravo de instrumento?", "essa certidão transitou para as duas
// partes?". Aqui a peça inteira vai para o modelo e a pergunta é livre.
//
// COMO É CHAMADA: por pg_net, de dentro do banco, pela RPC `jm_perguntar_peca`.
// A autorização é o `x-jm-key` guardado em `jm_config` — mesma chave e mesmo
// desenho de `jm-ler-peca`, porque é o mesmo domínio de confiança: mesma
// função de negócio, mesmo bucket privado, mesma cota de modelo. Chave nova
// seria mais um segredo para girar sem nenhuma fronteira nova protegida.
//
// A RESPOSTA POUSA NA TABELA, não no corpo do HTTP: pg_net é assíncrono e quem
// disparou já foi embora. O front acompanha `jm_peca_pergunta` pelo id.
//
// NADA DAQUI VIRA NÚMERO. Resposta de modelo sobre peça é leitura. Para mexer
// em valor existe `jm_corrigir_valores_peca`, que exige alguém confirmar.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-jm-key',
};

const MODEL = 'gemini-2.5-flash';
const BUCKET = 'jm-autos';

/** Teto do que cabe numa requisição com o PDF em base64 sem estourar memória. */
const MAX_BYTES = 15 * 1024 * 1024;

/** Quantas perguntas anteriores da MESMA peça entram como contexto. */
const HISTORICO = 6;

const SYSTEM_PROMPT = `Você responde perguntas sobre UMA peça de processo judicial brasileiro que está anexada.

REGRAS:
1. Responda SOMENTE com o que está NESTA peça. Não complete com conhecimento
   geral de direito, com o que é comum nesse tipo de processo, nem com outras
   peças do mesmo processo.
2. Quando a peça não responde, diga exatamente isso — "a peça não diz" — e, se
   souber, diga que tipo de peça responderia. Inventar é o pior resultado
   possível aqui: quem pergunta está conferindo um número que vale dinheiro.
3. Cite o trecho em que se baseou, entre aspas e curto, quando ele existir.
4. Distinga sempre: o que a peça DECIDE (dispositivo) do que as partes PEDEM
   (relatório) e do que a fundamentação discute.
5. Distinga julgamento de MÉRITO de julgamento de recurso processual (agravo de
   instrumento, admissibilidade, embargos não conhecidos). É a confusão mais
   cara nesta tela.
6. Português do Brasil, direto, sem preâmbulo. Duas ou três frases resolvem a
   maioria das perguntas; só se alongue quando a pergunta pedir uma lista.
7. Nada de conselho sobre o que fazer, e nada de estimar valor que a peça não
   traga escrito.`;

interface Pergunta {
  id: number;
  documento_id: number;
  pergunta: string;
  marco_chave: string | null;
  marco_rotulo: string | null;
  resposta: string | null;
}

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

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let perguntaId: number | null = null;

  /** Falha também precisa pousar na linha: sem isso o front fica girando. */
  const falhar = async (erro: string) => {
    if (perguntaId) {
      await sb.from('jm_peca_pergunta')
        .update({ erro: erro.slice(0, 400), respondido_em: new Date().toISOString() })
        .eq('id', perguntaId);
    }
    return json({ success: false, error: erro });
  };

  try {
    // verify_jwt = false porque quem chama é o banco por pg_net, sem sessão de
    // usuário. A validação é esta, manual, contra o segredo de jm_config.
    const enviada = req.headers.get('x-jm-key') ?? '';
    const { data: cfg } = await sb
      .from('jm_config').select('valor').eq('chave', 'jm_ler_peca_key').maybeSingle();
    const esperada = (cfg as { valor?: string } | null)?.valor ?? '';
    if (!esperada || enviada !== esperada) {
      return json({ success: false, error: 'não autorizado' }, 401);
    }

    const body = await req.json();
    perguntaId = Number(body?.pergunta_id) || null;
    if (!perguntaId) return json({ success: false, error: 'pergunta_id é obrigatório' });

    const { data: p } = await sb
      .from('jm_peca_pergunta')
      .select('id, documento_id, pergunta, marco_chave, marco_rotulo, resposta')
      .eq('id', perguntaId).maybeSingle<Pergunta>();
    if (!p) return json({ success: false, error: 'pergunta não encontrada' });
    // Reentrega do pg_net não pode gerar segunda cobrança nem sobrescrever.
    if (p.resposta) return json({ success: true, ja_respondida: true });

    const { data: doc } = await sb
      .from('jm_documentos')
      .select('id, processo_cnj, titulo, data_documento, storage_path')
      .eq('id', p.documento_id).maybeSingle<Documento>();
    if (!doc) return await falhar('documento não encontrado');
    if (!doc.storage_path) return await falhar('peça sem arquivo baixado');

    // Bucket privado: service role baixa direto, sem URL assinada.
    const { data: arquivo, error: erroArquivo } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (erroArquivo || !arquivo) return await falhar(`storage: ${erroArquivo?.message || 'sem arquivo'}`);

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (bytes.length > MAX_BYTES) {
      return await falhar(`peça de ${(bytes.length / 1048576).toFixed(1)} MB — grande demais para ler inteira`);
    }
    // Base64 em blocos: o spread de centenas de milhares de argumentos estoura
    // a pilha em PDF de alguns MB.
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(bin);

    const chave = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!chave) return await falhar('GOOGLE_AI_API_KEY não configurada');

    // O que já foi perguntado sobre ESTA peça vira histórico de conversa. Sem
    // isso, "e no caso da segunda autora?" chega ao modelo sem antecedente.
    const { data: antes } = await sb
      .from('jm_peca_pergunta')
      .select('pergunta, resposta')
      .eq('documento_id', p.documento_id)
      .not('resposta', 'is', null)
      .lt('id', p.id)
      .order('id', { ascending: false })
      .limit(HISTORICO);

    const contexto =
      `Processo: ${doc.processo_cnj}\n` +
      `Título da peça nos autos: ${doc.titulo ?? '(sem título)'}\n` +
      `Data do documento: ${doc.data_documento ?? '(sem data)'}\n` +
      (p.marco_rotulo
        ? `Na régua do escritório, esta peça é a prova do marco "${p.marco_rotulo}".\n`
        : '') +
      `\nPergunta: ${p.pergunta}`;

    const contents: unknown[] = [];
    for (const a of [...(antes || [])].reverse()) {
      contents.push({ role: 'user', parts: [{ text: String(a.pergunta) }] });
      contents.push({ role: 'model', parts: [{ text: String(a.resposta) }] });
    }
    contents.push({
      role: 'user',
      parts: [
        { text: contexto },
        { inline_data: { mime_type: 'application/pdf', data: base64 } },
      ],
    });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(chave)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          // Temperatura baixa, mas não zero: aqui é resposta em texto, e 0 deixa
          // o modelo repetindo o enunciado da pergunta.
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
      },
    );
    if (!r.ok) {
      const detalhe = (await r.text()).replace(/\s+/g, ' ').slice(0, 300);
      return await falhar(`gemini ${r.status}: ${detalhe}`);
    }
    const resposta = await r.json();
    const texto = String(
      resposta?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x?.text ?? '').join('') ?? '',
    ).trim();
    if (!texto) return await falhar('o modelo não devolveu resposta');

    const { error: erroGrava } = await sb
      .from('jm_peca_pergunta')
      .update({ resposta: texto, modelo: MODEL, erro: null, respondido_em: new Date().toISOString() })
      .eq('id', p.id);
    if (erroGrava) return json({ success: false, error: `gravar: ${erroGrava.message}` });

    return json({ success: true, pergunta_id: p.id, caracteres: texto.length });
  } catch (e) {
    return await falhar(String((e as Error)?.message || e).slice(0, 300));
  }
});
