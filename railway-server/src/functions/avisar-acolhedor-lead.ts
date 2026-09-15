// =============================================================================
// avisar-acolhedor-lead — leva o lead novo para o WhatsApp de quem atende.
//
// O acolhedor vive no WhatsApp, não na tela. Para saber que entrou lead do
// tráfego pago ele precisa abrir o sistema, e enquanto não abre o lead esfria.
// Esta função varre os leads recém-criados, acha o dono de cada um e manda no
// WhatsApp dele o que basta para agir sem abrir nada: quem preencheu, o nome da
// criança, as respostas de qualificação e um link `wa.me` que abre a conversa
// com o cliente JÁ COM a primeira mensagem escrita.
//
// POR QUE VARREDURA, E NÃO GATILHO NA CRIAÇÃO
// O lead nasce por DOIS caminhos (`meta-leads-sync`, da API da Meta, e
// `bpc-sheet-sync`, da planilha) que escrevem na mesma tabela. Pendurar o envio
// em cada um duplicaria a regra em dois lugares e colocaria uma chamada de rede
// dentro do laço que cria lead — onde uma falha de WhatsApp viraria falha de
// import. A varredura cobre os dois caminhos com um código só, é idempotente
// por `lead_id` e não toca no caminho quente.
//
// ENSAIO A SECO POR PADRÃO
// `dry_run` é TRUE quando não vem no corpo. Uma função que manda mensagem para
// o WhatsApp pessoal de alguém não pode disparar por acidente — nem num teste,
// nem num cron mal configurado. Para valer é explícito: POST {"dry_run": false}
//
// AS TRÊS TRAVAS CONTRA A RAJADA
//   1. `janela_minutos` (180): lead mais velho que isso não gera aviso. É o que
//      impede a primeira rodada de despejar os 2.641 leads dos últimos 30 dias.
//   2. `limite` (30 por rodada): dia de pico medido = 178 leads no board.
//   3. janela de horário (7h–21h, Brasília): aviso de madrugada faz a pessoa
//      silenciar a conversa, e conversa silenciada não entrega mais nada.
//
// CONTRATO
//   POST {
//     dry_run?: boolean = true, limite?: number = 30,
//     janela_minutos?: number = 180, board_id?: string,
//     operador?: string, ignorar_horario?: boolean = false
//   }
//   → { ok, dry_run, candidatos, enviados, falhas, sem_operador, sem_config, avisos[] }
// =============================================================================
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { casaOperador } from '../lib/leadAdsSheet';
import { montarAviso, dentroDoHorario } from '../lib/avisoLeadAcolhedor';

const JANELA_PADRAO_MIN = 180;
const LIMITE_PADRAO = 30;
const TETO_LEADS_LIDOS = 500;
/** Respiro entre envios: 30 mensagens em rajada é o que faz número virar spam. */
const PAUSA_ENTRE_ENVIOS_MS = 700;

const HORA_INICIO = Number(process.env.AVISO_LEAD_HORA_INICIO || 7);
const HORA_FIM = Number(process.env.AVISO_LEAD_HORA_FIM || 21);
/** Instância UazAPI padrão do remetente, quando a config não disser outra. */
const INSTANCIA_PADRAO = process.env.AVISO_LEAD_INSTANCIA || '';

interface ConfigAcolhedor {
  operador: string;
  board_id: string;
  nome_exibicao: string | null;
  whatsapp: string;
  instancia_remetente: string | null;
  mensagem_com_crianca: string | null;
  mensagem_sem_crianca: string | null;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Últimos 4 dígitos, para log. Número inteiro de funcionário não vai para log. */
function mascara(telefone: string): string {
  const d = String(telefone || '').replace(/\D/g, '');
  return d ? `***${d.slice(-4)}` : '—';
}

/** Manda o texto por UMA instância UazAPI, pelo nome dela. */
async function enviarPelaInstancia(
  instanceName: string,
  telefone: string,
  texto: string,
): Promise<{ ok: boolean; erro?: string }> {
  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url, is_active')
    .ilike('instance_name', instanceName)
    .limit(1);
  const inst = instances?.[0] as
    | { instance_token: string; base_url: string | null; is_active: boolean }
    | undefined;
  if (!inst) return { ok: false, erro: `instância "${instanceName}" não existe` };
  if (!inst.is_active) return { ok: false, erro: `instância "${instanceName}" está inativa` };
  if (!inst.instance_token) return { ok: false, erro: `instância "${instanceName}" sem token` };

  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  try {
    const resp = await fetch(`${base}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: inst.instance_token },
      body: JSON.stringify({ number: telefone, text: texto }),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      return { ok: false, erro: `HTTP ${resp.status} ${corpo.slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = (req.body || {}) as {
      dry_run?: boolean;
      limite?: number;
      janela_minutos?: number;
      board_id?: string;
      operador?: string;
      ignorar_horario?: boolean;
    };
    // Ausente = ensaio. Só dispara de verdade quem escreveu dry_run: false.
    const ensaio = body.dry_run !== false;
    const limite = Math.min(Math.max(Number(body.limite) || LIMITE_PADRAO, 1), 100);
    const janelaMin = Math.min(Math.max(Number(body.janela_minutos) || JANELA_PADRAO_MIN, 5), 1440);

    if (!ensaio && !body.ignorar_horario && !dentroDoHorario(new Date(), HORA_INICIO, HORA_FIM)) {
      return res.status(200).json({
        ok: true,
        pulado: `fora da janela de ${HORA_INICIO}h–${HORA_FIM}h (Brasília)`,
        enviados: 0,
      });
    }

    // 1) Quem recebe. Operador sem linha aqui não gera aviso — silêncio por
    //    ausência de cadastro, nunca por adivinhação de telefone.
    let q = supabase
      .from('acolhedor_aviso_config')
      .select(
        'operador, board_id, nome_exibicao, whatsapp, instancia_remetente, mensagem_com_crianca, mensagem_sem_crianca',
      )
      .eq('ativo', true);
    if (body.board_id) q = q.eq('board_id', body.board_id);
    if (body.operador) q = q.eq('operador', body.operador);
    const { data: configs, error: erroCfg } = await q;
    if (erroCfg) return res.status(500).json({ error: `config: ${erroCfg.message}` });
    const lista = (configs || []) as ConfigAcolhedor[];
    if (!lista.length) {
      return res.status(200).json({
        ok: true,
        aviso: 'nenhum acolhedor cadastrado em acolhedor_aviso_config (nada foi enviado)',
        enviados: 0,
      });
    }

    const porBoard = new Map<string, Map<string, ConfigAcolhedor>>();
    for (const c of lista) {
      const m = porBoard.get(c.board_id) ?? new Map<string, ConfigAcolhedor>();
      m.set(c.operador.trim().toLowerCase(), c);
      porBoard.set(c.board_id, m);
    }

    const desde = new Date(Date.now() - janelaMin * 60_000).toISOString();
    const avisos: Array<Record<string, unknown>> = [];
    let candidatos = 0;
    let enviados = 0;
    let falhas = 0;
    let semOperador = 0;
    let semConfig = 0;

    for (const [boardId, operadores] of porBoard) {
      // 2) Leads da janela. `deleted_at` fora: lead apagado não vira aviso.
      const { data: leads, error: erroLeads } = await supabase
        .from('leads')
        .select('id, lead_name, lead_phone, source, notes, campaign_name, ad_name, created_at')
        .eq('board_id', boardId)
        .is('deleted_at', null)
        .gte('created_at', desde)
        .order('created_at', { ascending: true })
        .limit(TETO_LEADS_LIDOS);
      if (erroLeads) {
        avisos.push({ board_id: boardId, erro: `leads: ${erroLeads.message}` });
        continue;
      }
      const daJanela = (leads || []) as Array<Record<string, any>>;
      if (!daJanela.length) continue;

      // 3) Quem já tem registro de aviso (enviado OU em falha) sai da lista. A
      //    consulta é por id, então não depende de ordem nem de paginação.
      const ids = daJanela.map((l) => String(l.id));
      const { data: jaAvisados } = await supabase
        .from('lead_aviso_acolhedor')
        .select('lead_id')
        .in('lead_id', ids);
      const conhecidos = new Set((jaAvisados || []).map((r: any) => String(r.lead_id)));

      for (const l of daJanela) {
        if (enviados + falhas >= limite) break;
        const leadId = String(l.id);
        if (conhecidos.has(leadId)) continue;

        const operador = casaOperador(String(l.source || ''));
        if (!operador) {
          semOperador += 1;
          continue;
        }
        const cfg = operadores.get(operador.trim().toLowerCase());
        if (!cfg) {
          semConfig += 1;
          continue;
        }

        candidatos += 1;
        const aviso = montarAviso(
          {
            lead_id: leadId,
            nome: l.lead_name,
            telefone: l.lead_phone,
            criado_em: l.created_at,
            campanha: l.campaign_name,
            anuncio: l.ad_name,
            notes: l.notes,
          },
          {
            templateComCrianca: cfg.mensagem_com_crianca,
            templateSemCrianca: cfg.mensagem_sem_crianca,
          },
        );

        if (ensaio) {
          avisos.push({
            lead_id: leadId,
            operador,
            destino: mascara(cfg.whatsapp),
            tem_nome_da_crianca: Boolean(aviso.crianca),
            falta_telefone: aviso.falta_telefone,
            texto: aviso.texto,
          });
          continue;
        }

        const instancia = cfg.instancia_remetente || INSTANCIA_PADRAO;
        if (!instancia) {
          falhas += 1;
          avisos.push({ lead_id: leadId, operador, erro: 'sem instância remetente (defina AVISO_LEAD_INSTANCIA)' });
          continue;
        }

        const r = await enviarPelaInstancia(instancia, cfg.whatsapp, aviso.texto);

        // Grava DEPOIS de tentar, com o resultado. A linha nasce mesmo em erro
        // para que a falha apareça e para que a próxima rodada não repita o
        // mesmo aviso em laço — quem conserta é gente olhando `erro`.
        const { error: erroGrava } = await supabase.from('lead_aviso_acolhedor').insert({
          lead_id: leadId,
          operador,
          instancia_remetente: instancia,
          enviado_em: r.ok ? new Date().toISOString() : null,
          erro: r.ok ? null : (r.erro || 'erro desconhecido').slice(0, 300),
          tentativas: 1,
        } as any);
        if (erroGrava && !String(erroGrava.message).includes('lead_aviso_acolhedor_lead_id_key')) {
          console.error(`[avisar-acolhedor] registro falhou lead=${leadId}: ${erroGrava.message}`);
        }

        if (r.ok) {
          enviados += 1;
          // Nome da mãe, nome da criança e telefone do cliente NÃO vão para log.
          console.log(`[avisar-acolhedor] aviso entregue lead=${leadId} operador=${operador}`);
          avisos.push({ lead_id: leadId, operador, enviado: true, tem_nome_da_crianca: Boolean(aviso.crianca) });
        } else {
          falhas += 1;
          console.warn(`[avisar-acolhedor] falhou lead=${leadId} operador=${operador}: ${r.erro}`);
          avisos.push({ lead_id: leadId, operador, enviado: false, erro: r.erro });
        }
        await espera(PAUSA_ENTRE_ENVIOS_MS);
      }
    }

    return res.status(200).json({
      ok: true,
      dry_run: ensaio,
      janela_minutos: janelaMin,
      limite,
      candidatos,
      enviados,
      falhas,
      // Lead cujo `source` não casa com operador nenhum: quem lê isso decide se
      // é funil sem dono ou palavra-chave nova (lib/leadAdsSheet OPERATOR_KEYWORDS).
      sem_operador: semOperador,
      // Operador existe, mas ninguém cadastrou o WhatsApp dele.
      sem_config: semConfig,
      avisos,
    });
  } catch (err) {
    console.error('[avisar-acolhedor-lead]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
