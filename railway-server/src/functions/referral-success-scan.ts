// Varre as indicações atrás de notícia boa e pede autorização para contá-la.
//
// Roda em três passos, cada um independente do anterior — se um falhar, os
// outros ainda avançam na rodada seguinte:
//
//   1) CASAR    indicação → lead que o indicado virou (o elo que nunca existiu)
//   2) DETECTAR desfecho no caso desse lead
//   3) PEDIR    ao próprio indicado autorização para contar a quem o indicou
//
// O que este arquivo NÃO faz: enviar o aviso ao indicador. Quem envia é o
// `referral-thanks-dispatch`, depois do "pode contar". Separado de propósito —
// detectar é barato e pode rodar sempre; avisar terceiro é irreversível.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import {
  CONSENT_VALIDADE_DIAS,
  ehInequivoco,
  escolherDesfecho,
  mascarar,
  textoPedidoDeConsentimento,
} from '../lib/referral-sucesso';
import { enviarPelaInstanciaDaIndicacao } from '../lib/referral-envio';

/**
 * Chave de aviso desligada por padrão.
 *
 * Esta função manda mensagem para cliente sem ninguém no meio. Subir código não
 * pode ser o mesmo ato que ligar disparo — deploy acontece a cada merge, e um
 * merge distraído viraria mensagem na casa de gente de verdade. Com o padrão
 * desligado, publicar é inofensivo e ligar é uma variável de ambiente, que
 * também é o rollback mais rápido que existe: desligar não precisa de deploy.
 */
const ENVIO_LIGADO = (process.env.REFERRAL_AVISO || '').toLowerCase() === 'on';

/**
 * Teto de pedidos de autorização por rodada.
 *
 * Na primeira rodada, TODO desfecho já existente no banco aparece de uma vez —
 * é um backlog inteiro virando mensagem no mesmo minuto. Hoje o backlog é zero
 * (medido em 15/09/2026: nenhuma das 129 indicações casadas com lead tem
 * deferimento ou acordo), mas isso é sorte de calendário, não garantia. O teto
 * faz a fila escoar em rodadas, e um número que dispara 200 mensagens numa hora
 * é um número banido pelo WhatsApp.
 */
const LIMITE_POR_RODADA = Number(process.env.REFERRAL_AVISO_LIMITE || 20);

/**
 * Quantas indicações sem lead tentamos casar por rodada.
 *
 * É um RODÍZIO, não um top-N: a fila é ordenada por `match_attempted_at` com
 * NULLS FIRST e o carimbo cai em toda tentativa, casando ou não. A primeira
 * versão pegava as 500 mais NOVAS e, como "não casou" deixa o lead nulo, as
 * mesmas 500 voltavam à fila para sempre — as mais antigas nunca eram olhadas.
 * Conferido no banco antes do conserto: os 6 deferimentos que existem hoje
 * estavam TODOS na faixa faminta. O scan rodaria eternamente sem achar nada, e
 * o sintoma seria indistinguível de "não há o que avisar".
 */
const LIMITE_CASAMENTO = 500;

/** Idem para a busca de desfecho. Também rodízio, nunca top-N. */
const LIMITE_DETECCAO = 1000;

const digitos = (v?: string | null) => (v || '').replace(/\D/g, '');
const chave8 = (v?: string | null) => digitos(v).slice(-8);

interface Corpo {
  /** Conta e explica, sem gravar nem enviar nada. */
  dry_run?: boolean;
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  const dryRun = Boolean((req.body as Corpo | undefined)?.dry_run);
  const agora = new Date();

  try {
    const casados = await casarComLeads(dryRun);
    const detectados = await detectarDesfechos(dryRun);
    const pedidos = await pedirAutorizacoes(dryRun, agora);
    const expirados = await expirarPedidosAntigos(dryRun, agora);

    return ok({
      success: true,
      dry_run: dryRun,
      envio_ligado: ENVIO_LIGADO,
      casados,
      detectados,
      pedidos,
      expirados,
    });
  } catch (err) {
    console.error('[indicacoes/sucesso] erro:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};

// ============================================================================
// PASSO 1 — casar indicação com o lead que o indicado virou
// ============================================================================

/**
 * Dois caminhos, nesta ordem:
 *
 *   a) `indicated_contact_id` → `contact_leads`. É o elo explícito: alguém já
 *      disse que este contato é deste lead. Quando existe, é o melhor que há.
 *   b) últimos 8 dígitos do telefone contra `leads.phone_match_key` — a MESMA
 *      coluna gerada que o resto do sistema usa para casar telefone. Não
 *      invento critério novo: se o sistema inteiro casa por 8 dígitos, casar
 *      aqui por 9 criaria dois universos de "mesma pessoa".
 *
 * Por que 8 dígitos e não o número inteiro: o nono dígito do celular e o DDI
 * entram e saem conforme a origem do cadastro. Casar pelo número cheio perde a
 * maioria dos pares reais.
 *
 * Quando mais de um lead casa, NADA é gravado como certo: fica
 * `match_confidence='ambigua'` e o lead continua nulo. Avisar o indicador sobre
 * o desfecho da pessoa errada é pior que não avisar — é notícia falsa sobre um
 * terceiro, e não tem como desfazer.
 */
async function casarComLeads(dryRun: boolean) {
  const { data: pendentes } = await supabase
    .from('referrals')
    .select('id, indicated_phone, indicated_contact_id')
    .is('converted_lead_id', null)
    // Rodízio: quem nunca foi tentado na frente, depois o carimbo mais velho.
    .order('match_attempted_at', { ascending: true, nullsFirst: true })
    .order('shared_at', { ascending: false })
    .limit(LIMITE_CASAMENTO);

  const linhas = (pendentes || []) as Array<{ id: string; indicated_phone: string; indicated_contact_id: string | null }>;
  if (!linhas.length) return { olhadas: 0, casadas: 0, ambiguas: 0 };

  // --- caminho (a): contato já ligado a lead
  const contactIds = [...new Set(linhas.map((l) => l.indicated_contact_id).filter(Boolean))] as string[];
  const leadPorContato = new Map<string, string[]>();
  for (const bloco of emBlocos(contactIds, 200)) {
    const { data } = await supabase.from('contact_leads').select('contact_id, lead_id').in('contact_id', bloco);
    for (const r of (data || []) as Array<{ contact_id: string; lead_id: string }>) {
      if (!r.lead_id) continue;
      const atual = leadPorContato.get(r.contact_id) || [];
      if (!atual.includes(r.lead_id)) atual.push(r.lead_id);
      leadPorContato.set(r.contact_id, atual);
    }
  }

  // --- caminho (b): telefone
  const chaves = [...new Set(linhas.map((l) => chave8(l.indicated_phone)).filter((k) => k.length === 8))];
  const leadPorChave = new Map<string, string[]>();
  for (const bloco of emBlocos(chaves, 200)) {
    const { data } = await supabase.from('leads').select('id, phone_match_key').in('phone_match_key', bloco);
    for (const r of (data || []) as Array<{ id: string; phone_match_key: string }>) {
      const atual = leadPorChave.get(r.phone_match_key) || [];
      atual.push(r.id);
      leadPorChave.set(r.phone_match_key, atual);
    }
  }

  // O carimbo do rodízio cai em TODAS as linhas olhadas, inclusive as que não
  // casaram — é ele que faz a fila girar. Numa tacada só: 500 UPDATEs
  // individuais por rodada seriam 500 idas ao banco para não gravar nada útil.
  const agoraISO = new Date().toISOString();
  if (!dryRun) {
    await supabase
      .from('referrals')
      .update({ match_attempted_at: agoraISO })
      .in('id', linhas.map((l) => l.id));
  }

  let casadas = 0;
  let ambiguas = 0;
  for (const l of linhas) {
    const porContato = l.indicated_contact_id ? leadPorContato.get(l.indicated_contact_id) || [] : [];
    const porTelefone = leadPorChave.get(chave8(l.indicated_phone)) || [];
    const metodo: 'contact_id' | 'phone8' | null =
      porContato.length ? 'contact_id' : porTelefone.length ? 'phone8' : null;
    if (!metodo) continue;

    const achados = metodo === 'contact_id' ? porContato : porTelefone;
    if (achados.length > 1) {
      ambiguas++;
      if (!dryRun) {
        await supabase.from('referrals').update({ match_method: metodo, match_confidence: 'ambigua' }).eq('id', l.id);
      }
      continue;
    }

    casadas++;
    if (dryRun) continue;
    await supabase
      .from('referrals')
      .update({
        converted_lead_id: achados[0],
        converted_at: agoraISO,
        match_method: metodo,
        match_confidence: 'alta',
      })
      .eq('id', l.id);
  }

  return { olhadas: linhas.length, casadas, ambiguas };
}

// ============================================================================
// PASSO 2 — o caso do indicado deu certo?
// ============================================================================

async function detectarDesfechos(dryRun: boolean) {
  const { data: comLead } = await supabase
    .from('referrals')
    .select('id, converted_lead_id')
    .not('converted_lead_id', 'is', null)
    .is('success_detected_at', null)
    // Rodízio, pelo mesmo motivo do passo 1: esta fila CRESCE e nunca esvazia
    // (indicado cujo caso nunca ganha fica aqui para sempre), então um top-N
    // sobre ordem fixa pararia de olhar as mais antigas assim que passasse do
    // teto — em silêncio, meses depois.
    .order('success_scanned_at', { ascending: true, nullsFirst: true })
    .limit(LIMITE_DETECCAO);

  const linhas = (comLead || []) as Array<{ id: string; converted_lead_id: string }>;
  if (!linhas.length) return { olhadas: 0, com_desfecho: 0, para_revisar: 0 };

  // Carimbo do rodízio em todas as olhadas, achando desfecho ou não.
  const agoraISO = new Date().toISOString();
  if (!dryRun) {
    await supabase
      .from('referrals')
      .update({ success_scanned_at: agoraISO })
      .in('id', linhas.map((l) => l.id));
  }

  const leadIds = [...new Set(linhas.map((l) => l.converted_lead_id))];

  // Uma consulta por tabela para TODOS os leads — não uma por indicação.
  // Com 1.416 indicações, o laço ingênuo seriam 2.832 idas ao banco por rodada.
  const inssPorLead = new Map<string, any[]>();
  for (const bloco of emBlocos(leadIds, 200)) {
    const { data } = await supabase
      .from('inss_admin_processes')
      .select('id, lead_id, benefit_type, servico, protocol_date')
      .in('lead_id', bloco)
      .eq('resultado', 'deferido')
      .is('deleted_at', null);
    for (const r of (data || []) as any[]) {
      inssPorLead.set(r.lead_id, [...(inssPorLead.get(r.lead_id) || []), r]);
    }
  }

  const marcosPorLead = new Map<string, any[]>();
  for (const bloco of emBlocos(leadIds, 200)) {
    const { data } = await supabase
      .from('process_movements')
      .select('id, lead_id, tipo_movimentacao, data_movimentacao')
      .in('lead_id', bloco)
      .in('tipo_movimentacao', ['pagamento', 'acordo', 'sentenca_1grau'])
      .is('descartado_em', null);
    for (const r of (data || []) as any[]) {
      marcosPorLead.set(r.lead_id, [...(marcosPorLead.get(r.lead_id) || []), r]);
    }
  }

  let comDesfecho = 0;
  let paraRevisar = 0;
  for (const l of linhas) {
    const desfecho = escolherDesfecho({
      inssDeferidos: inssPorLead.get(l.converted_lead_id) || [],
      marcos: marcosPorLead.get(l.converted_lead_id) || [],
    });
    if (!desfecho) continue;

    comDesfecho++;
    const inequivoco = ehInequivoco(desfecho.tipo);
    if (!inequivoco) paraRevisar++;
    if (dryRun) continue;

    await supabase
      .from('referrals')
      .update({
        success_kind: desfecho.tipo,
        success_label: desfecho.rotulo,
        success_ref: desfecho.ref,
        success_at: desfecho.data,
        success_detected_at: agoraISO,
        // Sentença vai direto para a fila humana e nunca pede autorização
        // sozinha: primeiro alguém confirma que a sentença foi favorável.
        thanks_status: inequivoco ? null : 'revisar',
      })
      .eq('id', l.id);
  }

  return { olhadas: linhas.length, com_desfecho: comDesfecho, para_revisar: paraRevisar };
}

// ============================================================================
// PASSO 3 — pedir ao indicado autorização para contar
// ============================================================================

async function pedirAutorizacoes(dryRun: boolean, agora: Date) {
  const { data: prontos } = await supabase
    .from('referrals')
    .select(
      'id, indicated_name, indicated_phone, referrer_name, referrer_phone, referrer_sender_phone, ' +
        'success_label, success_kind, match_confidence, instance_name',
    )
    .not('success_detected_at', 'is', null)
    .is('consent_status', null)
    .is('thanks_status', null)
    // Descartada por um humano = não incomoda o cliente com o pedido.
    .neq('status', 'descartado')
    .order('success_detected_at', { ascending: true })
    .limit(LIMITE_POR_RODADA);

  const linhas = (prontos || []) as any[];
  const resultado = { candidatos: linhas.length, pedidos: 0, sem_destino: 0, pulados: 0 };
  if (!linhas.length) return resultado;

  for (const r of linhas) {
    // Casamento ambíguo nunca chega aqui (fica sem converted_lead_id), mas a
    // conferência é barata e o erro que ela evita é irreversível.
    if (r.match_confidence !== 'alta') {
      resultado.pulados++;
      if (!dryRun) await supabase.from('referrals').update({ thanks_status: 'revisar' }).eq('id', r.id);
      continue;
    }

    // Sem privado do indicador, não há a quem avisar depois — não faz sentido
    // incomodar o cliente com um pedido de autorização que não vai a lugar nenhum.
    const destinoFuturo = r.referrer_sender_phone || r.referrer_phone;
    if (!destinoFuturo || !r.indicated_phone) {
      resultado.sem_destino++;
      if (!dryRun) await supabase.from('referrals').update({ thanks_status: 'revisar' }).eq('id', r.id);
      continue;
    }

    const texto = textoPedidoDeConsentimento({
      nomeDoIndicado: r.indicated_name,
      nomeDoIndicador: r.referrer_name,
      rotuloDoDesfecho: r.success_label || 'seu caso deu certo',
    });

    if (dryRun || !ENVIO_LIGADO) {
      resultado.pulados++;
      continue;
    }

    const envio = await enviarPelaInstanciaDaIndicacao({
      telefone: r.indicated_phone,
      texto,
      instanceName: r.instance_name || null,
    });

    if (!envio.ok) {
      console.warn('[indicacoes/sucesso] pedido de autorização não saiu', envio.erro, mascarar(r.indicated_phone));
      await supabase
        .from('referrals')
        .update({ thanks_status: 'revisar', thanks_erro: `pedido de autorização não saiu: ${envio.erro}` })
        .eq('id', r.id);
      continue;
    }

    const externalId = envio.externalId;
    await supabase
      .from('referrals')
      .update({
        consent_status: 'pedido',
        consent_asked_at: agora.toISOString(),
        consent_message_id: externalId,
      })
      .eq('id', r.id);

    // A mensagem aparece na conversa como qualquer outra. Falhar aqui é
    // cosmético — o pedido JÁ saiu e já está gravado na indicação —, então o
    // erro vira aviso e não derruba a rodada.
    const { error: erroDoRegistro } = await supabase.from('whatsapp_messages').insert({
      phone: r.indicated_phone,
      instance_name: r.instance_name,
      message_text: texto,
      message_type: 'text',
      direction: 'outbound',
      status: 'sent',
      external_message_id: externalId,
      action_source: 'referral_consent_ask',
      action_source_detail: String(r.id),
    } as any);
    if (erroDoRegistro) {
      console.warn('[indicacoes/sucesso] não registrei a mensagem na conversa:', erroDoRegistro.message);
    }

    resultado.pedidos++;
  }

  return resultado;
}

// ============================================================================
// Silêncio não é autorização
// ============================================================================

async function expirarPedidosAntigos(dryRun: boolean, agora: Date) {
  const corte = new Date(agora.getTime() - CONSENT_VALIDADE_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('referrals')
    .select('id')
    .eq('consent_status', 'pedido')
    .lt('consent_asked_at', corte)
    .limit(500);

  const ids = ((data || []) as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length || dryRun) return ids.length;

  await supabase
    .from('referrals')
    .update({ consent_status: 'expirado', consent_answered_at: agora.toISOString() })
    .in('id', ids);
  return ids.length;
}

function emBlocos<T>(itens: T[], tamanho: number): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}
