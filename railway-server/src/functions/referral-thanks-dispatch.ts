// Lê a resposta do cliente e, com o "pode contar", avisa quem indicou.
//
// Dois passos:
//   1) LER   as respostas dos pedidos de autorização em aberto
//   2) AVISAR quem indicou, agrupando todos os desfechos do mesmo indicador
//
// Este é o arquivo que fala com um TERCEIRO sobre o caso de um cliente. Todas
// as travas moram aqui e nenhuma delas é opcional:
//   · só sai com `consent_status='sim'` gravado, com data
//   · vai para o PRIVADO do indicador, nunca para o grupo de onde veio o cartão
//   · só dentro da janela de 8h–20h de Brasília
//   · no máximo uma mensagem por indicador a cada 30 dias
//   · `thanks_enviado_at` trava o reenvio, mesmo com duas rodadas em paralelo
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { geminiChat } from '../lib/gemini';
import { enviarPelaInstanciaDaIndicacao } from '../lib/referral-envio';
import { variantesDeTelefone } from '../lib/whatsapp-leitura';
import {
  DIAS_ENTRE_AVISOS,
  dentroDaJanela,
  interpretarResposta,
  mascarar,
  passaramOsDias,
  textoDoAviso,
  type DesfechoParaContar,
} from '../lib/referral-sucesso';

/** Mesma chave do scan: publicar não liga disparo; ligar é variável de ambiente. */
const ENVIO_LIGADO = (process.env.REFERRAL_AVISO || '').toLowerCase() === 'on';

/** Avisos por rodada. Ver o comentário do teto no `referral-success-scan`. */
const LIMITE_POR_RODADA = Number(process.env.REFERRAL_AVISO_LIMITE || 20);

const digitos = (v?: string | null) => (v || '').replace(/\D/g, '');

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  const dryRun = Boolean((req.body as { dry_run?: boolean } | undefined)?.dry_run);
  const agora = new Date();

  try {
    const respostas = await lerRespostas(dryRun);

    if (!dentroDaJanela(agora)) {
      return ok({ success: true, dry_run: dryRun, respostas, enviados: 0, motivo: 'fora da janela 8h-20h' });
    }

    const enviados = await avisarIndicadores(dryRun, agora);
    return ok({ success: true, dry_run: dryRun, envio_ligado: ENVIO_LIGADO, respostas, ...enviados });
  } catch (err) {
    console.error('[indicacoes/aviso] erro:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

// ============================================================================
// PASSO 1 — o cliente respondeu o quê?
// ============================================================================

/**
 * Lê o que o cliente respondeu depois do pedido.
 *
 * Determinístico primeiro, IA só na dúvida: "pode sim" não precisa de modelo de
 * linguagem, e 90% das respostas são assim. Quando nem a regra nem a IA se
 * decidem, o pedido FICA EM ABERTO e expira sozinho em 5 dias — não existe
 * caminho em que a dúvida vira autorização.
 */
async function lerRespostas(dryRun: boolean) {
  const { data } = await supabase
    .from('referrals')
    .select('id, indicated_phone, indicated_name, consent_asked_at, instance_name')
    .eq('consent_status', 'pedido')
    .order('consent_asked_at', { ascending: true })
    .limit(200);

  const linhas = (data || []) as any[];
  const conta = { lidas: 0, sim: 0, nao: 0, sem_resposta: 0, via_ia: 0 };
  if (!linhas.length) return conta;

  for (const r of linhas) {
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('message_text, created_at')
      .in('phone', variantesDeTelefone(digitos(r.indicated_phone)))
      .eq('direction', 'inbound')
      .gt('created_at', r.consent_asked_at)
      .order('created_at', { ascending: true })
      .limit(5);

    const textos = ((msgs || []) as Array<{ message_text: string | null }>)
      .map((m) => (m.message_text || '').trim())
      .filter(Boolean);

    if (!textos.length) {
      conta.sem_resposta++;
      continue;
    }
    conta.lidas++;

    const juntos = textos.join(' ');
    let veredito = interpretarResposta(juntos);
    if (veredito === 'indefinido') {
      veredito = await perguntarAIA(juntos);
      if (veredito !== 'indefinido') conta.via_ia++;
    }
    if (veredito === 'indefinido') {
      conta.sem_resposta++;
      continue;
    }

    if (veredito === 'sim') conta.sim++;
    else conta.nao++;
    if (dryRun) continue;

    await supabase
      .from('referrals')
      .update({
        consent_status: veredito,
        consent_answered_at: new Date().toISOString(),
        // A frase do cliente sobre a própria privacidade fica guardada para
        // auditar uma classificação errada. Não vai para log, só para o banco.
        consent_reply_text: juntos.slice(0, 500),
        thanks_status: veredito === 'sim' ? 'agendado' : null,
      })
      .eq('id', r.id);
  }

  return conta;
}

/**
 * A IA só responde SIM, NAO ou DUVIDA. Qualquer outra coisa vira DUVIDA — e
 * DUVIDA não autoriza nada. Um modelo que alucina aqui custa o sigilo de um
 * cliente, então o prompt fecha a porta em vez de pedir bom senso.
 */
async function perguntarAIA(resposta: string): Promise<'sim' | 'nao' | 'indefinido'> {
  if (!process.env.GOOGLE_AI_API_KEY) return 'indefinido';
  try {
    const j = await geminiChat({
      model: 'google/gemini-3.6-flash',
      messages: [
        {
          role: 'system',
          content: [
            'Perguntamos a um cliente de um escritório de advocacia se podemos contar à pessoa que o indicou que o caso dele deu certo.',
            'Leia a resposta dele e diga se é autorização.',
            'Responda SOMENTE uma palavra: SIM, NAO ou DUVIDA.',
            'Use DUVIDA sempre que a resposta for sobre outro assunto, ambígua, condicional, ou você não tiver certeza.',
            'Na dúvida, DUVIDA. Não tente adivinhar a intenção.',
          ].join('\n'),
        },
        { role: 'user', content: resposta.slice(0, 1000) },
      ],
      temperature: 0,
      max_tokens: 5,
    });
    const t = String(j?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    if (t.startsWith('SIM')) return 'sim';
    if (t.startsWith('NAO') || t.startsWith('NÃO')) return 'nao';
    return 'indefinido';
  } catch (e: any) {
    console.warn('[indicacoes/aviso] IA não classificou a resposta:', e?.message);
    return 'indefinido';
  }
}

// ============================================================================
// PASSO 2 — avisar quem indicou
// ============================================================================

async function avisarIndicadores(dryRun: boolean, agora: Date) {
  const { data } = await supabase
    .from('referrals')
    .select(
      'id, referrer_name, referrer_phone, referrer_sender_phone, referrer_group_id, ' +
        'indicated_name, success_label, instance_name',
    )
    .eq('consent_status', 'sim')
    .eq('thanks_status', 'agendado')
    .is('thanks_enviado_at', null)
    // Indicação que alguém marcou como "não era indicação" (cartório,
    // fornecedor, número errado) não vira aviso — e é por isso que o
    // `status: 'convertido'` gravado no fim não atropela um descarte humano.
    .neq('status', 'descartado')
    .limit(200);

  const linhas = (data || []) as any[];
  const conta = { enviados: 0, indicacoes_cobertas: 0, bloqueados_30d: 0, erros: 0, sem_destino: 0 };
  if (!linhas.length) return conta;

  // Uma mensagem por PESSOA, não por indicação. Quem indicou cinco pessoas que
  // deram certo no mesmo mês recebe uma notícia com cinco linhas, não cinco
  // mensagens seguidas — que é como um número vira spam e depois vira banido.
  const porDestino = new Map<string, any[]>();
  for (const r of linhas) {
    // SEMPRE o privado. `referrer_group_id` fica só no rastro: o cliente
    // autorizou contar a quem o indicou, não ao grupo inteiro de onde o cartão
    // saiu (997 das 1.416 indicações vieram de grupo).
    const destino = digitos(r.referrer_sender_phone) || digitos(r.referrer_phone);
    if (!destino) {
      conta.sem_destino++;
      continue;
    }
    porDestino.set(destino, [...(porDestino.get(destino) || []), r]);
  }

  // Quem já recebeu aviso nos últimos 30 dias, numa consulta só.
  const corte = new Date(agora.getTime() - DIAS_ENTRE_AVISOS * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentes } = await supabase
    .from('referrals')
    .select('referrer_phone, referrer_sender_phone, thanks_enviado_at')
    .not('thanks_enviado_at', 'is', null)
    .gt('thanks_enviado_at', corte);
  const avisadoRecentemente = new Map<string, string>();
  for (const r of (recentes || []) as any[]) {
    for (const t of [digitos(r.referrer_sender_phone), digitos(r.referrer_phone)]) {
      if (!t) continue;
      const anterior = avisadoRecentemente.get(t);
      if (!anterior || r.thanks_enviado_at > anterior) avisadoRecentemente.set(t, r.thanks_enviado_at);
    }
  }

  let feitos = 0;
  for (const [destino, grupo] of porDestino) {
    if (feitos >= LIMITE_POR_RODADA) break;

    if (!passaramOsDias(avisadoRecentemente.get(destino), agora)) {
      conta.bloqueados_30d += grupo.length;
      if (!dryRun) {
        await supabase
          .from('referrals')
          .update({ thanks_status: 'bloqueado' })
          .in('id', grupo.map((g) => g.id));
      }
      continue;
    }

    const desfechos: DesfechoParaContar[] = grupo.map((g) => ({
      nomeDoIndicado: g.indicated_name,
      rotulo: g.success_label || 'o caso deu certo',
    }));
    const base = textoDoAviso({ nomeDoIndicador: grupo[0].referrer_name, desfechos });
    const texto = (await humanizar(base)) || base;

    if (dryRun || !ENVIO_LIGADO) {
      conta.indicacoes_cobertas += grupo.length;
      continue;
    }

    const envio = await enviarPelaInstanciaDaIndicacao({
      telefone: destino,
      texto,
      instanceName: grupo[0].instance_name || null,
    });

    if (!envio.ok) {
      conta.erros++;
      console.warn('[indicacoes/aviso] envio não saiu', envio.erro, mascarar(destino));
      await supabase
        .from('referrals')
        .update({ thanks_status: 'erro', thanks_erro: envio.erro || 'falha no envio', thanks_texto: texto })
        .in('id', grupo.map((g) => g.id));
      continue;
    }

    const externalId = envio.externalId;
    const quando = new Date().toISOString();
    await supabase
      .from('referrals')
      .update({
        thanks_status: 'enviado',
        thanks_texto: texto,
        thanks_enviado_at: quando,
        thanks_message_id: externalId,
        thanks_grupo_id: grupo[0].referrer_group_id || null,
        status: 'convertido',
      })
      .in('id', grupo.map((g) => g.id));

    // Cosmético: o aviso já saiu e já está travado em `thanks_enviado_at`.
    const { error: erroDoRegistro } = await supabase.from('whatsapp_messages').insert({
      phone: destino,
      instance_name: grupo[0].instance_name,
      message_text: texto,
      message_type: 'text',
      direction: 'outbound',
      status: 'sent',
      external_message_id: externalId,
      action_source: 'referral_thanks',
      action_source_detail: String(grupo[0].id),
    } as any);
    if (erroDoRegistro) {
      console.warn('[indicacoes/aviso] não registrei a mensagem na conversa:', erroDoRegistro.message);
    }

    avisadoRecentemente.set(destino, quando);
    conta.enviados++;
    conta.indicacoes_cobertas += grupo.length;
    feitos++;
    console.log('[indicacoes/aviso] enviado', { destino: mascarar(destino), indicacoes: grupo.length });
  }

  return conta;
}

/**
 * A IA dá naturalidade ao texto; o determinístico já estava correto sem ela.
 * Falhou, veio vazio, veio longo demais? Fica o original — ninguém deixa de
 * receber notícia boa por causa de API de terceiro. Mesma escolha do
 * `montarTextoMensagemCliente` do INSS.
 *
 * Reescrever é o único trabalho da IA aqui: ela não decide QUEM recebe, não
 * decide SE recebe e não tem acesso a dado nenhum além do texto já aprovado.
 */
async function humanizar(base: string): Promise<string | null> {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  try {
    const j = await geminiChat({
      model: 'google/gemini-3.6-flash',
      messages: [
        {
          role: 'system',
          content: [
            'Reescreva a mensagem de WhatsApp abaixo com tom de pessoa, não de empresa.',
            'Regras:',
            '- Mantenha EXATAMENTE os mesmos fatos, nomes e desfechos. Não acrescente nenhum.',
            '- Não prometa resultado a ninguém, não fale de valor, prazo ou direito.',
            '- Não peça novas indicações de forma explícita.',
            '- Português brasileiro, curto, no máximo 6 linhas.',
            'Responda só com o texto final.',
          ].join('\n'),
        },
        { role: 'user', content: base },
      ],
      temperature: 0.5,
      max_tokens: 400,
    });
    const t = String(j?.choices?.[0]?.message?.content || '').trim();
    if (!t || t.length > base.length * 2.5) return null;
    return t;
  } catch {
    return null;
  }
}
