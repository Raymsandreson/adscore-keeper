/**
 * telao-narrar — Narração do telão /tv/atividades com voz de locutor.
 *
 * O telão manda a frase pronta ("Olha lá, amigos! Fulano ultrapassou Sicrano!")
 * e recebe de volta a URL de um mp3 gerado no ElevenLabs. A voz do navegador
 * (SpeechSynthesis) continua no front como fallback — se esta rota falhar, o
 * telão narra do mesmo jeito, só que mecânico.
 *
 * Cache: o mp3 é gravado no storage com o nome derivado do hash da frase +
 * voz + modelo. Frase repetida não gasta caractere nenhum no ElevenLabs — só
 * os nomes mudam, então na prática o telão converge pra poucas gerações/dia.
 *
 * Custo: ~50 caracteres por narração nova. Com o cache, algo como alguns
 * milhares de caracteres/dia num telão movimentado (faixa de dezenas de
 * dólares/mês só se a rotatividade de nomes for muito alta).
 *
 * Segurança: rota sem x-api-key (o front do telão roda anônimo), então o
 * abuso é contido por limite de tamanho da frase + teto de gerações por hora.
 * Frase longa ou fora do teto volta 400/429 e o telão cai na voz do navegador.
 */
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { supabase } from '../lib/supabase';
import { checkElevenLabsCredits, fetchWithRetry } from '../lib/elevenlabs-utils';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Voz do narrador. Trocar = setar TELAO_NARRATOR_VOICE_ID no Railway com o id
// de qualquer voz da conta. O padrão é a "Adam" (premade, grave, existe em
// toda conta ElevenLabs) — não é clone de ninguém real.
const VOICE_ID = process.env.TELAO_NARRATOR_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
// turbo_v2_5 fala português, custa metade do multilingual_v2 e responde rápido
// — o telão precisa da fala saindo enquanto o banner da ultrapassagem está lá.
// `eleven_turbo_v2_5` foi APOSENTADO pela ElevenLabs — toda chamada volta 400
// (verificado 17/08/2026: a autenticação passa, o corpo é recusado). As últimas
// narrações geradas no bucket são de 05/08/2026; de 06/08 em diante, nenhuma.
// O substituto oficial é o Flash v2.5, funcionalmente equivalente e com latência
// menor. Trocar por env var continua valendo.
const MODEL_ID = process.env.TELAO_NARRATOR_MODEL || 'eleven_flash_v2_5';

const BUCKET = 'whatsapp-media';
const MAX_CHARS = 220;

// Teto de gerações NOVAS por hora (cache não conta). Protege a fatura se a
// rota vazar pra fora do telão. Estado em memória: o Railway roda 1 processo.
const MAX_GERACOES_HORA = 80;
let janelaInicio = Date.now();
let geracoesNaJanela = 0;

function dentroDoTeto(): boolean {
  const agora = Date.now();
  if (agora - janelaInicio > 3_600_000) {
    janelaInicio = agora;
    geracoesNaJanela = 0;
  }
  return geracoesNaJanela < MAX_GERACOES_HORA;
}

function caminhoDoCache(texto: string, voiceId: string): string {
  const hash = createHash('sha1').update(`${MODEL_ID}|${voiceId}|${texto}`).digest('hex').slice(0, 24);
  return `telao-narracao/${hash}.mp3`;
}

/** Voz escolhida no painel do telão. Formato do id do ElevenLabs, nada além. */
function voiceIdValido(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9]{16,40}$/.test(v);
}

// Lista de vozes da conta, pro seletor do painel. Cache curto: a conta não
// muda de voz o tempo todo e isso evita bater na API a cada abertura.
let vozesCache: { em: number; vozes: unknown[] } | null = null;

async function listarVozes() {
  if (vozesCache && Date.now() - vozesCache.em < 10 * 60_000) return vozesCache.vozes;

  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });
  // O corpo vai junto no erro: só o status não diz nada, e este endpoint
  // responde 200 até SEM chave nenhuma (vozes públicas), então falhar COM chave
  // é anomalia que precisa do motivo para ser resolvida.
  if (!res.ok) throw new Error(`voices ${res.status} — ${(await res.text()).replace(/\s+/g, ' ').trim().slice(0, 300)}`);

  const json = (await res.json()) as { voices?: any[] };
  const vozes = (json.voices || []).map((v) => ({
    voice_id: v.voice_id,
    nome: v.name,
    categoria: v.category, // premade | cloned | generated | professional
    genero: v.labels?.gender || null,
    sotaque: v.labels?.accent || null,
    descricao: v.labels?.description || null,
    preview_url: v.preview_url || null,
  }));

  vozesCache = { em: Date.now(), vozes };
  return vozes;
}

function urlPublica(path: string): string | null {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

/** Já existe no storage? Um HEAD evita gastar caractere numa frase repetida. */
async function jaExiste(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function handler(req: Request, res: Response, _next: unknown) {
  try {
    // modo "vozes": só lista as vozes da conta pro seletor do painel.
    if (req.body?.modo === 'vozes') {
      if (!ELEVENLABS_API_KEY) return res.json({ success: false, reason: 'sem_api_key', vozes: [] });
      try {
        return res.json({ success: true, vozes: await listarVozes(), padrao: VOICE_ID });
      } catch (e) {
        console.error('[telao-narrar] listar vozes falhou:', e);
        return res.json({
          success: false,
          reason: 'listagem_falhou',
          detalhe: e instanceof Error ? e.message : String(e),
          vozes: [],
        });
      }
    }

    const texto = String(req.body?.texto ?? '').trim();
    const voiceId = voiceIdValido(req.body?.voice_id) ? req.body.voice_id : VOICE_ID;

    if (!texto) return res.status(400).json({ success: false, error: 'texto é obrigatório' });
    if (texto.length > MAX_CHARS) {
      return res.status(400).json({ success: false, error: `texto acima de ${MAX_CHARS} caracteres` });
    }
    if (!ELEVENLABS_API_KEY) {
      // Sem chave configurada não é erro do telão — ele narra com a voz do navegador.
      return res.json({ success: false, reason: 'sem_api_key' });
    }

    const path = caminhoDoCache(texto, voiceId);
    const url = urlPublica(path);
    if (!url) return res.status(500).json({ success: false, error: 'storage indisponível' });

    if (await jaExiste(url)) {
      return res.json({ success: true, audio_url: url, cached: true });
    }

    if (!dentroDoTeto()) {
      console.warn('[telao-narrar] teto de gerações/hora atingido');
      return res.status(429).json({ success: false, reason: 'teto_hora' });
    }

    const credits = await checkElevenLabsCredits(ELEVENLABS_API_KEY);
    if (!credits.has_credits) {
      return res.json({ success: false, reason: 'sem_credito' });
    }

    const ttsRes = await fetchWithRetry(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
      {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: texto,
          model_id: MODEL_ID,
          // Instável e com style alto de propósito: é locução de corrida, não
          // leitura de bula. speaker_boost dá presença pra sair num telão.
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.8,
            style: 0.65,
            use_speaker_boost: true,
            speed: 1.05,
          },
        }),
      },
    );

    if (!ttsRes.ok) {
      const detalhe = await ttsRes.text().catch(() => '');
      console.error('[telao-narrar] ElevenLabs falhou:', ttsRes.status, detalhe.slice(0, 300));
      // O motivo sai na resposta, não só no log: `elevenlabs_400` sozinho não
      // diz se o problema é modelo, voz, output_format ou plano — e sem isso o
      // diagnóstico depende de acesso ao painel do Railway.
      return res.json({
        success: false,
        reason: `elevenlabs_${ttsRes.status}`,
        detalhe: detalhe.replace(/\s+/g, ' ').trim().slice(0, 300),
        modelo: MODEL_ID,
        voz: voiceId,
      });
    }

    geracoesNaJanela++;
    const audio = Buffer.from(await ttsRes.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, audio, { contentType: 'audio/mpeg', upsert: true, cacheControl: '31536000' });

    if (upErr) {
      console.error('[telao-narrar] upload falhou:', upErr);
      return res.json({ success: false, reason: 'upload_falhou' });
    }

    console.log(`[telao-narrar] gerado (${texto.length} chars) → ${path}`);
    return res.json({ success: true, audio_url: url, cached: false });
  } catch (err) {
    console.error('[telao-narrar] erro:', err);
    return res.json({ success: false, reason: 'erro_interno' });
  }
}
