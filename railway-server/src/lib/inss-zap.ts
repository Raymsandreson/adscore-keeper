// ============================================================================
// Envio da mensagem do INSS para o grupo do cliente: resolver grupo, redigir
// e entregar. Vive fora do handler porque o despachante da fila (fora da
// janela de 8h–20h) precisa exatamente das mesmas funções.
// ============================================================================

import { supabase } from './supabase';
import { geminiChat } from './gemini';
import {
  escolherCandidatas,
  jidDeGrupo,
  normalizarNome,
} from './inss-zap-destino';
import { conferirGrupoDoLead } from './inss-grupo-certeza';
export { escolherCandidatas, jidDeGrupo, descreverErro } from './inss-zap-destino';
import { descreverErro } from './inss-zap-destino';
import {
  fallbackMensagemCliente,
  promptMensagemCliente,
  mascararDocumentos,
  type EntradaMensagemCliente,
  type TipoMensagemCliente,
} from './inss-mensagem-cliente';

export interface GrupoDestino {
  group_jid: string;
  group_name: string | null;
  instance_name: string | null;
}

/**
 * Grupo do lead, com a MESMA política do front (`src/lib/leadWhatsAppTarget.ts`):
 * um grupo vinculado manda; vários, só se o campo legado `leads.whatsapp_group_id`
 * desempatar; sem desempate, RECUSA.
 *
 * Até 26/08/2026 aqui era `.limit(1)` sem ordenação — 36 leads têm mais de um
 * grupo (35 com dois, 1 com quatro) e a linha que voltasse primeiro decidia.
 * Mensagem no grupo errado é vazamento de dado de cliente para outro cliente,
 * então na dúvida não se manda.
 *
 * Sem NENHUMA linha na tabela, cai no campo legado `leads.whatsapp_group_id` —
 * ver `grupoDoCampoLegado`.
 */
export async function resolverGrupoDoLead(
  leadId: string | null | undefined,
  opcoes?: { nomeSegurado?: string | null },
): Promise<{ grupo: GrupoDestino; erro?: undefined } | { grupo?: undefined; erro: string }> {
  if (!leadId) return { erro: 'sem lead' };
  const { data, error } = await supabase
    .from('lead_whatsapp_groups')
    .select('group_jid, group_name, instance_name')
    .eq('lead_id', leadId);
  if (error) return { erro: `falha ao ler grupos: ${error.message}` };
  const grupos = (data || []).filter((g: any) => g.group_jid) as GrupoDestino[];
  if (grupos.length === 0) return grupoDoCampoLegado(leadId, opcoes?.nomeSegurado);
  if (grupos.length === 1) return { grupo: grupos[0] };

  const { data: lead } = await supabase
    .from('leads')
    .select('whatsapp_group_id')
    .eq('id', leadId)
    .maybeSingle();
  const legado = (lead as any)?.whatsapp_group_id as string | undefined;
  const escolhido = legado ? grupos.find((g) => g.group_jid === legado) : undefined;
  if (escolhido) return { grupo: escolhido };
  return { erro: `lead com ${grupos.length} grupos e sem desempate` };
}

/**
 * Último recurso: o JID que mora em `leads.whatsapp_group_id`.
 *
 * 102 dos 623 leads com requerimento INSS não têm linha em
 * `lead_whatsapp_groups` (a tabela nova só é preenchida por quem cria o grupo
 * pelo app, pela tela do lead ou por backfill pontual), e em 23 deles o campo
 * legado guarda o grupo certo, vivo e com instância nossa dentro. Era esse o
 * buraco do PREV 584: indeferimento de 31/08/2026 que nunca chegou ao cliente.
 *
 * O campo sozinho não basta para mandar. Três exigências, todas obrigatórias:
 *  - JID de grupo de verdade (`@g.us`; o campo também guarda "PENDING:...");
 *  - o grupo tem que estar no `whatsapp_groups_index`, que é a varredura real
 *    do WhatsApp — JID fóssil de grupo que não existe mais não vira mensagem;
 *  - o nome do grupo tem que conferir com o lead e com o segurado do e-mail
 *    (`conferirGrupoDoLead`).
 *
 * Falhou qualquer uma: devolve erro e o cliente NÃO recebe nada. Quem resolve é
 * gente, pela atividade que o `notify-inss-update` deixa pedindo o vínculo.
 */
async function grupoDoCampoLegado(
  leadId: string,
  nomeSegurado?: string | null,
): Promise<{ grupo: GrupoDestino; erro?: undefined } | { grupo?: undefined; erro: string }> {
  const { data: lead } = await supabase
    .from('leads')
    .select('lead_name, whatsapp_group_id')
    .eq('id', leadId)
    .maybeSingle();
  const legado = ((lead as any)?.whatsapp_group_id || '').trim();
  if (!/@g\.us$/.test(legado)) return { erro: 'lead sem grupo vinculado' };

  // A varredura grava uma linha por instância que enxerga o grupo; a mais
  // recente é a que prova que o grupo ainda existe.
  const { data: noIndice } = await supabase
    .from('whatsapp_groups_index')
    .select('contact_name, instance_name, updated_at')
    .eq('group_jid', legado)
    .order('updated_at', { ascending: false })
    .limit(1);
  const doIndice = noIndice?.[0] as any;
  if (!doIndice) {
    return { erro: 'grupo do cadastro antigo não aparece na varredura do WhatsApp' };
  }

  const confere = conferirGrupoDoLead({
    leadName: (lead as any)?.lead_name,
    groupName: doIndice.contact_name,
    nomeSegurado,
  });
  if (!confere.ok) return { erro: `grupo do cadastro antigo não confere: ${confere.motivo}` };

  console.log(`[inss-zap] grupo pelo campo legado (${confere.motivo})`);
  return {
    grupo: {
      group_jid: legado,
      group_name: doIndice.contact_name || null,
      instance_name: doIndice.instance_name || null,
    },
  };
}

/**
 * Instâncias que podem falar nesse grupo, em ordem de preferência.
 *
 * Grupo da firma tem VÁRIAS instâncias-membro e cada mensagem é espelhada por
 * todas elas, então o histórico é a única fonte confiável de quem ainda está
 * dentro. Mesma regra do `src/lib/whatsappGroupInstance.ts` do front, que
 * nasceu de dois incidentes de mensagem saindo pela instância errada.
 *
 * Instância que parou de espelhar há mais de 7 dias (enquanto o grupo seguiu
 * ativo) provavelmente saiu — escolhê-la dá NOT_IN_GROUP.
 */
export async function instanciasCandidatasDoGrupo(
  groupJid: string,
  preferida?: string | null,
): Promise<string[]> {
  const phone = (groupJid || '').replace(/@.*$/, '').replace(/\D/g, '');
  const out: string[] = [];
  const push = (n?: string | null) => {
    if (n && !out.some((x) => normalizarNome(x) === normalizarNome(n))) out.push(n);
  };
  push(preferida);
  if (!phone) return out;

  const { data } = await supabase
    .from('whatsapp_messages')
    .select('instance_name, created_at')
    .eq('phone', phone)
    .not('instance_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(150);
  const rows = (data || []) as { instance_name: string; created_at: string }[];
  for (const nome of escolherCandidatas(rows)) push(nome);
  return out;
}

/** Manda o texto por UMA instância. */
export async function enviarTextoUazapi(args: {
  group_jid: string;
  text: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  let q = supabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .eq('is_active', true);
  if (args.instance_name) q = q.eq('instance_name', args.instance_name);
  const { data: instances } = await q.limit(1);
  const inst = instances?.[0];
  if (!inst) return { ok: false, status: 0, body: 'no active instance' };
  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  const resp = await fetch(`${base}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    body: JSON.stringify({ number: jidDeGrupo(args.group_jid), text: args.text }),
  });
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text().catch(() => null);
  }
  return { ok: resp.ok, status: resp.status, body };
}

/** Manda um documento (PDF) por UMA instância. */
export async function enviarDocumentoUazapi(args: {
  group_jid: string;
  file_url: string;
  caption?: string;
  doc_name?: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  let q = supabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .eq('is_active', true);
  if (args.instance_name) q = q.eq('instance_name', args.instance_name);
  const { data: instances } = await q.limit(1);
  const inst = instances?.[0];
  if (!inst) return { ok: false, status: 0, body: 'no active instance' };
  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  const resp = await fetch(`${base}/send/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    body: JSON.stringify({
      number: jidDeGrupo(args.group_jid),
      type: 'document',
      file: args.file_url,
      ...(args.doc_name ? { docName: args.doc_name } : {}),
      ...(args.caption ? { text: args.caption } : {}),
    }),
  });
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text().catch(() => null);
  }
  return { ok: resp.ok, status: resp.status, body };
}

/**
 * Legenda que acompanha o PDF da procuração — uma só, importada pelos três
 * lugares que enviam (notify-inss-update, dispatch-inss-zap e o envio manual
 * do inss-procuracao-vincular). Estava copiada nos três, e ela precisa ser
 * idêntica em todos: é por esta frase que se audita, no espelho das mensagens,
 * se o PDF chegou ao cliente — três cópias que divergem deixam a auditoria cega.
 *
 * O passo a passo é numerado e diz ONDE assinar porque a versão anterior ("é só
 * imprimir, assinar à caneta") deixava em aberto justamente as duas coisas que o
 * INSS recusa: assinatura fora da linha e imagem de assinatura colada. O rótulo
 * da linha muda de modelo para modelo — "OUTORGANTE" quando o titular assina,
 * "REPRESENTANTE GERAL" quando é a mãe pelo filho menor —, então o texto cita os
 * dois; citar um só manda metade dos clientes procurar uma palavra que não está
 * na folha deles.
 */
export const LEGENDA_PROCURACAO = [
  '*PROCURAÇÃO PARA ASSINAR À MÃO* ✍️',
  '',
  'O INSS deixou de aceitar assinatura eletrônica neste pedido. Precisamos da sua assinatura feita à caneta, no papel.',
  '',
  '*Passo a passo:*',
  '',
  '*1.* Imprima o arquivo em anexo.',
  '',
  '*2.* No fim do documento tem uma linha em branco, logo acima da palavra *OUTORGANTE* (em alguns modelos aparece *REPRESENTANTE GERAL*). É exatamente ali que a assinatura deve ficar: em cima dessa linha, e em nenhum outro lugar da folha.',
  '',
  '*3.* Assine com caneta azul ou preta, o mais *parecido possível com a assinatura do seu RG ou CNH* — o INSS compara as duas.',
  '',
  '*4.* Tire foto de *todas as páginas*, com boa luz e a folha inteira aparecendo, e mande aqui nesta conversa.',
  '',
  '⚠️ Não vale assinatura digital, digitada ou colada como imagem. Tem que ser de próprio punho.',
  '',
  'Qualquer dúvida, é só responder por aqui.',
].join('\n');

/**
 * Manda o PDF da procuração ao grupo, com o mesmo rodízio de instâncias do
 * texto — o grupo tem várias instâncias-membro e só quem está dentro consegue
 * enviar.
 */
export async function enviarDocumentoAoGrupo(args: {
  group_jid: string;
  file_url: string;
  caption?: string;
  doc_name?: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any; instancia?: string; tentativas: number }> {
  const candidatas = await instanciasCandidatasDoGrupo(args.group_jid, args.instance_name);
  if (candidatas.length === 0) {
    const r = await enviarDocumentoUazapi(args);
    return { ...r, tentativas: 1 };
  }
  let ultimo: { ok: boolean; status: number; body?: any } = { ok: false, status: 0 };
  let tentativas = 0;
  for (const inst of candidatas.slice(0, 4)) {
    tentativas++;
    ultimo = await enviarDocumentoUazapi({ ...args, instance_name: inst });
    if (ultimo.ok) return { ...ultimo, instancia: inst, tentativas };
    console.warn(`[inss-zap] envio de documento falhou por "${inst}": ${descreverErro(ultimo)}`);
  }
  return { ...ultimo, tentativas };
}

/**
 * Manda uma nota de voz por UMA instância.
 *
 * `type: 'ptt'` é obrigatório: áudio mandado como `audio` comum chega no iPhone
 * como "Este áudio não está mais disponível" (incidente 13/07/2026). E o
 * arquivo vai em mp3 de propósito — a UazAPI reencoda o que não é ogg, e o
 * reencode dela toca em iOS, enquanto ogg saído do nosso ffmpeg não toca em
 * bitrate nenhum (matriz de testes de 21/07/2026).
 */
export async function enviarAudioUazapi(args: {
  group_jid: string;
  file_url: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  let q = supabase
    .from('whatsapp_instances')
    .select('id, instance_name, instance_token, base_url')
    .eq('is_active', true);
  if (args.instance_name) q = q.eq('instance_name', args.instance_name);
  const { data: instances } = await q.limit(1);
  const inst = instances?.[0];
  if (!inst) return { ok: false, status: 0, body: 'no active instance' };
  const base = (inst.base_url || 'https://abraci.uazapi.com').replace(/\/$/, '');
  const resp = await fetch(`${base}/send/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: inst.instance_token },
    body: JSON.stringify({
      number: jidDeGrupo(args.group_jid),
      type: 'ptt',
      file: args.file_url,
    }),
  });
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text().catch(() => null);
  }
  return { ok: resp.ok, status: resp.status, body };
}

/**
 * Nota de voz para o grupo, tentando as instâncias-membro na mesma ordem do
 * texto. Recebe a instância que ENTREGOU o texto: áudio e texto têm que sair
 * pelo mesmo número, senão o grupo vê a mensagem de um remetente e o áudio de
 * outro (incidente FAMÍLIA 250, 04/08/2026).
 */
export async function enviarAudioAoGrupo(args: {
  group_jid: string;
  file_url: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any; instancia?: string; tentativas: number }> {
  const candidatas = await instanciasCandidatasDoGrupo(args.group_jid, args.instance_name);
  if (candidatas.length === 0) {
    const r = await enviarAudioUazapi(args);
    return { ...r, tentativas: 1 };
  }
  let ultimo: { ok: boolean; status: number; body?: any } = { ok: false, status: 0 };
  let tentativas = 0;
  for (const inst of candidatas.slice(0, 4)) {
    tentativas++;
    ultimo = await enviarAudioUazapi({ ...args, instance_name: inst });
    if (ultimo.ok) return { ...ultimo, instancia: inst, tentativas };
    console.warn(`[inss-zap] áudio falhou por "${inst}": ${descreverErro(ultimo)}`);
  }
  return { ...ultimo, tentativas };
}

/**
 * Envia tentando as instâncias-membro do grupo, uma a uma.
 *
 * Sem isto o envio ia pela "primeira instância ativa" que o banco devolvesse —
 * entre 26 — que quase nunca é membro do grupo: o primeiro envio real do
 * recurso, em 26/08/2026, morreu com 503 exatamente assim. Erro numa instância
 * não é veredito sobre o grupo; é motivo para tentar a próxima.
 */
export async function enviarTextoAoGrupo(args: {
  group_jid: string;
  text: string;
  instance_name?: string | null;
}): Promise<{ ok: boolean; status: number; body?: any; instancia?: string; tentativas: number }> {
  const candidatas = await instanciasCandidatasDoGrupo(args.group_jid, args.instance_name);
  if (candidatas.length === 0) {
    const r = await enviarTextoUazapi({ group_jid: args.group_jid, text: args.text });
    return { ...r, tentativas: 1 };
  }
  let ultimo: { ok: boolean; status: number; body?: any } = { ok: false, status: 0 };
  let tentativas = 0;
  for (const inst of candidatas.slice(0, 4)) {
    tentativas++;
    ultimo = await enviarTextoUazapi({ group_jid: args.group_jid, text: args.text, instance_name: inst });
    if (ultimo.ok) return { ...ultimo, instancia: inst, tentativas };
    console.warn(`[inss-zap] envio falhou por "${inst}": ${descreverErro(ultimo)}`);
  }
  return { ...ultimo, tentativas };
}

/**
 * Texto final da mensagem. A IA reescreve o despacho do INSS em linguagem
 * simples; qualquer falha (sem chave, timeout, resposta vazia) cai no texto
 * determinístico, que já é uma mensagem correta — cliente nunca fica sem aviso
 * por causa de API de terceiro. A máscara de documento roda nos dois caminhos.
 */
export async function montarTextoMensagemCliente(
  tipo: TipoMensagemCliente,
  entrada: EntradaMensagemCliente,
): Promise<{ texto: string; via: 'ia' | 'fallback' }> {
  const prompt = promptMensagemCliente(tipo, entrada);
  if (prompt && process.env.GOOGLE_AI_API_KEY) {
    try {
      const j = await geminiChat({
        model: 'google/gemini-3.6-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
      });
      const txt = j?.choices?.[0]?.message?.content?.trim();
      if (txt) return { texto: mascararDocumentos(txt), via: 'ia' };
    } catch (e) {
      console.warn('[inss-zap] IA falhou, usando texto fixo:', e instanceof Error ? e.message : e);
    }
  }
  return { texto: mascararDocumentos(fallbackMensagemCliente(tipo, entrada)), via: 'fallback' };
}

/**
 * Já avisamos esse cliente sobre esse mesmo desfecho? 108 pares
 * (processo, status) se repetem no histórico — um deles 7 vezes — e 164 eventos
 * repetem status já visto. Sem esta trava o grupo recebe a mesma notícia de novo.
 */
export async function jaAvisouEsseTipo(processId: string, tipo: TipoMensagemCliente): Promise<boolean> {
  const { data } = await supabase
    .from('inss_status_history')
    .select('id')
    .eq('process_id', processId)
    .eq('zap_tipo', tipo)
    .in('zap_status', ['enviado', 'agendado'])
    .limit(1);
  return (data?.length || 0) > 0;
}
