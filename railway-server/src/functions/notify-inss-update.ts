import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import {
  classifyResultado,
  exigeProcuracao,
  extrairPontosPendentes,
  separarPendencias,
} from '../lib/inss-despacho';
import {
  ASSESSOR_INSS,
  ASSESSOR_PROTOCOLO,
  donoDaAtualizacaoInss,
  type DonoAtividade,
} from '../lib/inss-roteamento';
import { avisoDeFalhaNoEnvio, avisoDeVinculoSuspeito } from '../lib/inss-falha-envio';
import { mandarAudioDaMensagem } from '../lib/inss-audio';
import { conferirNomeDoSegurado } from '../lib/inss-nome-confere';
import {
  classificarMensagemCliente,
  dentroDaJanela,
  eventoElegivelParaZap,
  exigenciaDeAgendamentoDePericia,
  mensagemVaiAoCliente,
} from '../lib/inss-mensagem-cliente';
import {
  descreverErro,
  enviarAudioAoGrupo,
  enviarDocumentoAoGrupo,
  enviarTextoAoGrupo,
  jaAvisouEsseTipo,
  LEGENDA_PROCURACAO,
  montarTextoMensagemCliente,
  resolverGrupoDoLead,
} from '../lib/inss-zap';
import { buscarProcuracaoDoCliente } from '../lib/inss-procuracao';

/**
 * Quando chega um update do INSS para processo já vinculado:
 *  1) cria atividade no caso (Dar andamento)
 *  2) envia zap humanizado no grupo do lead via UazAPI
 *
 * Body: { process_id: string, force_history_id?: string }
 */

/**
 * Rótulo canônico de caso/processo em atividade: "<número> - <título>".
 * Mesmo formato do `formatProcessLabel` do front (`src/lib/processLabel.ts`),
 * reescrito aqui porque o railway-server não compartilha o bundle do app.
 */
function formatLabel(numero?: string | null, titulo?: string | null): string {
  const trim = (v?: string | null) => (v || '').replace(/^[\s\-–—]+/, '').replace(/[\s\-–—]+$/, '');
  return [numero, titulo].map(trim).filter(Boolean).join(' - ');
}

const onlyDigits = (v?: string | null) => (v || '').replace(/\D/g, '');

/**
 * Acha em `lead_processes` o processo do requerimento do INSS.
 *
 * `inss_admin_processes` e `lead_processes` são tabelas distintas e o elo entre
 * elas é o número do requerimento gravado em `process_number` — que ali não tem
 * formato garantido (pode vir com ponto/traço), daí a comparação por dígitos.
 * Procura primeiro no caso e só depois no lead inteiro, para não pegar processo
 * de outro caso do mesmo cliente.
 */
async function findLeadProcess(
  caseId: string | null,
  leadId: string | null,
  requerimento?: string | null,
): Promise<{ id: string; title: string | null; process_number: string | null } | null> {
  const alvo = onlyDigits(requerimento);
  if (!alvo) return null;
  // Duas colunas guardam o requerimento: `process_number` (cadastro antigo, que
  // mistura CNJ e requerimento) e `protocolo_administrativo` (a coluna própria,
  // preenchida em 275 processos no backfill de 25/08/2026). Conferir só a
  // primeira deixava 106 das 399 atividades sem processo vinculado.
  const cols = 'id, title, process_number, protocolo_administrativo';
  const casa = (p: any) =>
    onlyDigits(p.process_number) === alvo || onlyDigits(p.protocolo_administrativo) === alvo;

  if (caseId) {
    const { data: doCaso } = await supabase.from('lead_processes').select(cols).eq('case_id', caseId);
    const noCaso = (doCaso || []).find(casa);
    if (noCaso) return noCaso as any;
  }
  if (!leadId) return null;
  const { data: doLead } = await supabase.from('lead_processes').select(cols).eq('lead_id', leadId);
  return ((doLead || []).find(casa) as any) || null;
}

/**
 * Marca o evento como notificado. As colunas `zap_*` chegaram na migration
 * 20260826120000 — se o código subir antes dela, o UPDATE inteiro falharia e o
 * evento voltaria à fila a cada rodada, duplicando atividade. Aqui a marcação
 * é o que não pode falhar: se o patch de zap for recusado, grava só o notified
 * e deixa o motivo no log.
 */
async function marcarNotificado(
  ids: string[],
  quando: string,
  zapPatch: Record<string, any>,
): Promise<void> {
  const { error } = await supabase
    .from('inss_status_history')
    .update({ notified: true, notified_at: quando, ...zapPatch })
    .in('id', ids);
  if (!error) return;
  console.warn('[notify-inss-update] update com zap_* falhou, gravando só notified:', error.message);
  await supabase
    .from('inss_status_history')
    .update({ notified: true, notified_at: quando })
    .in('id', ids);
}

export const handler: RequestHandler = async (req, res) => {
  const processId: string | undefined = req.body?.process_id;
  // Vínculo recém-descoberto por robô (match-inss-orphans) não avisa cliente:
  // o e-mail do INSS pode ser de meses atrás e ninguém revisou o casamento.
  // A atividade nasce igual, com o aviso de que o cliente não foi avisado.
  const semMensagem: boolean = req.body?.sem_mensagem === true;
  if (!processId) {
    return res.status(200).json({ success: false, error: 'process_id required' });
  }

  try {
    // Carrega processo + ultimos updates não notificados
    const { data: proc, error: procErr } = await supabase
      .from('inss_admin_processes')
      .select('*, legal_cases:case_id(id, case_number, title, lead_id)')
      .eq('id', processId)
      .maybeSingle();
    if (procErr || !proc) {
      return res.status(200).json({ success: false, error: procErr?.message || 'process not found' });
    }
    const caseInfo: any = proc.legal_cases;
    const leadId: string | null = proc.lead_id || caseInfo?.lead_id || null;

    // Até 25/08/2026 requerimento sem caso saía daqui sem atividade nenhuma —
    // 546 dos 986 estão nesse estado, ou seja, mais da metade dos e-mails do
    // INSS não virava tarefa de ninguém. Agora basta ter LEAD: a atividade
    // nasce ligada a ele e o caso entra depois, quando o vínculo for feito.
    // Sem lead e sem caso não há onde pendurar, e a fila de vínculo
    // (match-inss-orphans) é quem resolve.
    if (!proc.case_id && !leadId) {
      return res.status(200).json({ success: false, error: 'process without case and without lead' });
    }

    // Pega updates não notificados (último primeiro), até 5
    const { data: pending } = await supabase
      .from('inss_status_history')
      .select('id, from_status, to_status, email_subject, email_received_at, despacho')
      .eq('process_id', processId)
      .eq('notified', false)
      .order('email_received_at', { ascending: false })
      .limit(5);

    if (!pending || pending.length === 0) {
      return res.status(200).json({ success: true, message: 'nothing to notify' });
    }

    const latest = pending[0];

    // 1) Cria atividade no Externo
    // "Concluída" sozinho não diz o desfecho: o INSS só manda o veredito no
    // Despacho do corpo, que o sync já classificou em proc.resultado.
    // O veredito não vem do INSS pronto: "Concluída" é tudo que o assunto diz, e
    // deferido/indeferido está no texto do Despacho. `proc.resultado` guarda o
    // que o sync classificou, mas ficou nulo em 21 das 111 conclusões — daí a
    // segunda tentativa, classificando o despacho deste evento na hora.
    const RESULTADO_LABELS: Record<string, string> = {
      deferido: 'DEFERIDO',
      indeferido: 'INDEFERIDO',
      arquivado_decurso: 'arquivado por exigência não cumprida',
    };
    const ehConclusao = /conclu[íi]d/i.test(latest.to_status || '');
    const resultado = ehConclusao
      ? (proc.resultado || classifyResultado(latest.despacho) || null)
      : null;
    const statusLabel = ehConclusao
      ? `Conclusão — ${resultado ? RESULTADO_LABELS[resultado] : 'sem veredito no despacho'}`
      : latest.to_status;
    // Exigência sem o texto vira "vá ver no Meu INSS". Os pontos pendentes saem
    // do próprio despacho (preenchido em 552 das 592 exigências).
    const ehExigencia = /exig[êe]nc/i.test(latest.to_status || '');
    const pontosPendentes = ehExigencia ? extrairPontosPendentes(latest.despacho) : null;

    // Duas separações antes de escrever qualquer coisa:
    //  - agendamento de perícia é tarefa NOSSA (ligar no 135 / Meu INSS), então
    //    a atividade nasce como tarefa e o cliente não recebe nada;
    //  - o que é pendência de procuração sai da mensagem e fica só na atividade.
    // Ver lib/inss-mensagem-cliente e lib/inss-despacho.
    const agendarPericia =
      ehExigencia && exigenciaDeAgendamentoDePericia({ pontosPendentes, despacho: latest.despacho });
    const pendencias = separarPendencias(pontosPendentes);

    // O INSS deixou de aceitar a procuração assinada pelo ZapSign e passou a
    // pedir assinatura manuscrita — 65 exigências, em 58 requerimentos. O PDF
    // preenchido e SEM assinatura já existe (`original_file_url`), então não se
    // gera nada: acha-se o documento do cliente e manda para ele imprimir e
    // assinar à caneta. Sem chave exata a busca devolve null de propósito; ver
    // lib/inss-procuracao.
    const pedeProcuracao = ehExigencia && exigeProcuracao(pontosPendentes);
    const procuracao = pedeProcuracao
      ? await buscarProcuracaoDoCliente({
          leadId,
          cpfSegurado: proc.cpf_segurado,
          nomeSegurado: proc.nome_segurado,
        })
      : null;

    const activityTitle = agendarPericia
      ? `Agendar perícia no INSS — requerimento ${proc.requerimento_number}`
      : `INSS atualizou ${proc.requerimento_number}: ${statusLabel}`;
    // O nome do lead é o que diz a matéria ("Família 400" e "CASO 146" são
    // trabalhistas; "PREV 1800" é previdenciário) — ver lib/inss-roteamento.
    let leadName: string | null = null;
    let victimName: string | null = null;
    let groupName: string | null = null;
    if (leadId) {
      const { data: lead } = await supabase
        .from('leads').select('lead_name, victim_name').eq('id', leadId).maybeSingle();
      leadName = lead?.lead_name || null;
      victimName = (lead as any)?.victim_name || null;
      const { data: grupos } = await supabase
        .from('lead_whatsapp_groups').select('group_name').eq('lead_id', leadId);
      groupName = (grupos || []).map((g: any) => g.group_name).filter(Boolean).join(' ') || null;
    }

    // O vínculo protocolo→lead é palpite de robô. Antes de escrever qualquer
    // coisa, confere se o segurado do e-mail é mesmo a pessoa desse lead — ver
    // lib/inss-nome-confere.
    const conferencia = conferirNomeDoSegurado(proc.nome_segurado, {
      victimName,
      leadName,
      groupName,
    });
    if (conferencia.veredito === 'conflito') {
      console.warn(
        `[notify-inss-update] vinculo suspeito req=${proc.requerimento_number}: ${conferencia.motivo}`,
      );
    }
    const dono = donoDaAtualizacaoInss({ status: latest.to_status, leadName });

    // Quando não há pendência nossa no meio, o bloco sai igual ao de sempre —
    // 485 das 557 exigências com despacho (medido em 27/08/2026).
    const blocoPendencias = !pontosPendentes
      ? ''
      : pendencias.escritorio
        ? [
            pendencias.cliente ? `\n📋 O CLIENTE PRECISA MANDAR:\n${pendencias.cliente}` : '',
            `\n🏢 PENDÊNCIA DO ESCRITÓRIO (não foi para o grupo do cliente):\n${pendencias.escritorio}`,
            pendencias.cliente
              ? ''
              : '\nNada sobrou para o cliente providenciar, então nenhuma mensagem foi enviada ao grupo.',
          ].filter(Boolean).join('\n')
        : `\n📋 PENDÊNCIAS APONTADAS PELO INSS:\n${pontosPendentes}`;

    // O bloco da procuração é o roteiro da pessoa: com o PDF em mãos, o link
    // para imprimir; sem ele, o pedido explícito para escolher o documento
    // certo — nunca um palpite por semelhança de nome (ver lib/inss-procuracao).
    const blocoProcuracao = !pedeProcuracao
      ? ''
      : procuracao
        ? [
            '\n📄 PROCURAÇÃO PARA ASSINAR À MÃO:',
            procuracao.url,
            `(${procuracao.documentName || 'procuração'}${
              procuracao.outorganteName ? ` — outorgante ${procuracao.outorganteName}` : ''
            }, localizada pelo ${procuracao.via}.)`,
            'Este é o PDF já preenchido e SEM assinatura eletrônica: é só imprimir, assinar à ' +
              'caneta e anexar ao Meu INSS.',
          ].join('\n')
        : [
            '\n📄 O INSS PEDIU PROCURAÇÃO ASSINADA À MÃO — NÃO LOCALIZEI A DESTE CLIENTE.',
            'Nenhuma procuração do ZapSign bate com o vínculo do lead, o CPF nem o nome do ' +
              'segurado deste requerimento. Isso é comum em BPC e maternidade, em que o segurado ' +
              'é a criança e quem assinou a procuração foi a mãe.',
            'Abra a conversa do cliente no WhatsApp → menu ⋮ → "Procuração para assinar à mão", ' +
              'escolha o documento certo e mande. O robô NÃO chuta por semelhança de nome: já foi ' +
              'medido e isso entregaria a procuração de outra pessoa. Se este cliente nunca teve ' +
              'procuração, gere uma nova por "Gerar Documento para Assinatura".',
          ].join('\n');

    // Classificar antes de redigir a atividade: a descrição precisa saber se o
    // evento é DECISÃO (deferimento, indeferimento) ou andamento para dar o
    // peso certo ao aviso de vínculo suspeito. `classificarMensagemCliente` é
    // pura e só depende de `resultado` e `pendencias`, já calculados acima.
    const entrada = {
      status: latest.to_status,
      resultado,
      despacho: latest.despacho,
      // Só o lado do cliente vai para a IA e para o texto fixo; o que é nosso
      // ficou na atividade.
      pontosPendentes: pendencias.cliente,
      nome: proc.nome_segurado,
      beneficio: proc.benefit_type,
      requerimento: proc.requerimento_number,
    };
    const tipoMensagem = classificarMensagemCliente(entrada);

    const activityDesc = [
      agendarPericia
        ? '📞 TAREFA DO ESCRITÓRIO: o INSS mandou AGENDAR a perícia. Ligue no 135 ou agende pelo Meu INSS. O cliente não foi avisado — quem marca somos nós; avise a data a ele depois de marcada.'
        : '',
      `Status mudou de "${latest.from_status || 'sem status anterior'}" → "${statusLabel}".`,
      blocoPendencias,
      blocoProcuracao,
      `\nAssunto do email: ${latest.email_subject}\nRecebido em: ${latest.email_received_at}`,
      caseInfo ? `\nCaso: ${caseInfo.case_number || ''} — ${caseInfo.title || ''}` : '',
      conferencia.veredito === 'conflito'
        ? avisoDeVinculoSuspeito({ motivo: conferencia.motivo, tipo: tipoMensagem })
        : '',
    ].filter(Boolean).join('\n');

    // Vínculo com caso e processo: até 17/08/2026 o insert levava só `lead_id`,
    // e 205 das 252 atividades nasceram órfãs — todas com caso disponível (o
    // guard lá em cima já barra processo sem `case_id`). O caso ia como texto na
    // descrição, então a atividade caía na lista sem caso nem nº de processo.
    // O processo casa pelo número do requerimento, que já está no título.
    const process = await findLeadProcess(proc.case_id, leadId, proc.requerimento_number);

    const { data: atividade } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      title: activityTitle,
      description: activityDesc,
      activity_type: 'notificacao',
      status: 'pendente',
      priority: 'normal',
      assigned_to: dono.id,
      assigned_to_name: dono.name,
      deadline: new Date().toISOString().slice(0, 10),
      case_id: proc.case_id,
      case_title: formatLabel(caseInfo?.case_number, caseInfo?.title) || null,
      process_id: process?.id || null,
      process_title: process ? formatLabel(process.process_number, process.title) || null : null,
      // Carimbo de origem: é robô que cria esta atividade. A tela lê isto para
      // mostrar o símbolo do robô (src/lib/activityRobot.ts).
      action_source: 'system',
      action_source_detail: 'Robô do INSS',
    } as any).select('id, description').maybeSingle();

    // 2) Mensagem para o grupo do cliente
    //
    // O grupo tem o cliente e a equipe. Nem todo evento vira mensagem, e o que
    // vira só sai entre 8h e 20h — ver lib/inss-mensagem-cliente. O que não pode
    // sair agora fica gravado como 'agendado' e o cron dispatch-inss-zap manda
    // quando a janela abrir; nada se perde e nada chega de madrugada.
    let zapPatch: Record<string, any> = { zap_status: 'silencio' };
    let sentToGroup = false;
    let procuracaoEnviada = false;
    let humanText: string | null = null;

    if (tipoMensagem) {
      if (conferencia.veredito === 'conflito') {
        // Nome do segurado briga com o do lead: a mensagem iria para o grupo de
        // outro cliente. Fica registrada para conferência humana, não sai.
        zapPatch = {
          zap_status: 'suspeito',
          zap_tipo: tipoMensagem,
          zap_erro: conferencia.motivo,
        };
      } else if (agendarPericia) {
        // Quem liga para o 135 é o escritório (pedido do usuário, 27/08/2026).
        // A tarefa está na atividade; o cliente só é avisado da data depois de
        // marcada, por uma pessoa.
        zapPatch = { zap_status: 'pericia_escritorio', zap_tipo: tipoMensagem };
      } else if (pendencias.escritorio && !pendencias.cliente) {
        // A exigência inteira era pendência nossa (17 das 557 no histórico):
        // mandar "o INSS pediu documentos" sem dizer quais só assusta.
        zapPatch = { zap_status: 'so_escritorio', zap_tipo: tipoMensagem };
      } else if (semMensagem) {
        zapPatch = { zap_status: 'vinculo_retroativo', zap_tipo: tipoMensagem };
      } else if (!eventoElegivelParaZap(latest.email_received_at)) {
        // Ativação sem retroatividade (pedido do usuário, 26/08/2026): evento
        // anterior ao corte nunca vira mensagem, mesmo que só agora tenha sido
        // processado. São 1.480 eventos antigos nunca notificados no histórico.
        zapPatch = { zap_status: 'retroativo', zap_tipo: tipoMensagem };
      } else if (await jaAvisouEsseTipo(processId, tipoMensagem)) {
        zapPatch = { zap_status: 'repetido', zap_tipo: tipoMensagem };
      } else if (!mensagemVaiAoCliente(tipoMensagem)) {
        // Deferimento (decisão do usuário, 04/09/2026): a boa notícia não sai
        // sozinha. Vira tarefa de quem vai conversar com o cliente — ver o
        // bloco de atividades logo abaixo.
        zapPatch = { zap_status: 'so_equipe', zap_tipo: tipoMensagem };
      } else {
        const destino = await resolverGrupoDoLead(leadId, { nomeSegurado: proc.nome_segurado });
        if (destino.erro) {
          zapPatch = { zap_status: 'sem_grupo', zap_tipo: tipoMensagem, zap_erro: destino.erro };
        } else {
          const { texto, via } = await montarTextoMensagemCliente(tipoMensagem, entrada);
          humanText = texto;
          if (!dentroDaJanela(new Date())) {
            zapPatch = { zap_status: 'agendado', zap_tipo: tipoMensagem, zap_texto: texto };
          } else {
            const sent = await enviarTextoAoGrupo({
              group_jid: destino.grupo.group_jid,
              text: texto,
              instance_name: destino.grupo.instance_name,
            });
            sentToGroup = sent.ok;
            // O PDF vai DEPOIS do texto: a mensagem explica o que o INSS pediu,
            // o anexo chega em seguida. Falha no anexo não derruba o aviso — o
            // texto já está no grupo e o link continua na atividade.
            if (sent.ok && procuracao) {
              const doc = await enviarDocumentoAoGrupo({
                group_jid: destino.grupo.group_jid,
                file_url: procuracao.url,
                doc_name: 'procuracao-para-assinar.pdf',
                caption: LEGENDA_PROCURACAO,
                instance_name: sent.instancia || destino.grupo.instance_name,
              });
              procuracaoEnviada = doc.ok;
              if (!doc.ok) {
                console.warn(
                  `[notify-inss-update] procuração não foi ao grupo: ${descreverErro(doc)}`,
                );
              }
            }
            // O áudio vai DEPOIS do texto, pela mesma instância. É acréscimo:
            // falhar aqui não desfaz o aviso, que já está no grupo. Ver
            // lib/inss-audio — áudio genérico só sai quando o despacho trata de
            // um assunto só; caso contrário narra o próprio texto enviado.
            let audioPatch: Record<string, any> = {};
            if (sent.ok) {
              audioPatch = await mandarAudioDaMensagem({
                tipo: tipoMensagem,
                fonte: pendencias.cliente || latest.despacho,
                texto,
                group_jid: destino.grupo.group_jid,
                instancia: sent.instancia || destino.grupo.instance_name,
              });
            }
            zapPatch = sent.ok
              ? {
                  zap_status: 'enviado',
                  zap_tipo: tipoMensagem,
                  zap_texto: texto,
                  zap_enviado_at: new Date().toISOString(),
                  ...audioPatch,
                }
              : {
                  zap_status: 'erro',
                  zap_tipo: tipoMensagem,
                  zap_texto: texto,
                  zap_erro: descreverErro(sent),
                };
          }
          console.log(
            `[notify-inss-update] zap tipo=${tipoMensagem} via=${via} status=${zapPatch.zap_status}`,
          );
        }
      }
    }

    // 2.1) Sem grupo confiável, quem precisa agir é gente: o aviso vai na
    // atividade que acabou de nascer. Pedido do usuário (31/08/2026): na dúvida
    // sobre qual é o grupo, não arrisca mandar — avisa para vincularem o grupo
    // ao lead. São 102 dos 623 leads com requerimento INSS sem vínculo, e sem
    // este aviso a falha só aparecia no `zap_erro`, que ninguém lê.
    if (zapPatch.zap_status === 'vinculo_retroativo' && atividade?.id) {
      await supabase
        .from('lead_activities')
        .update({
          description:
            `${atividade.description || activityDesc}\n\n` +
            '🔗 ESTE REQUERIMENTO ACABOU DE GANHAR DONO. O robô ligou o requerimento a este lead pelo ' +
            'nome do segurado — antes disso o e-mail do INSS não era tarefa de ninguém. O CLIENTE NÃO ' +
            'FOI AVISADO: confira se o requerimento é mesmo deste lead e, se for, avise-o do que está ' +
            'escrito acima. Daqui para frente as atualizações deste requerimento saem sozinhas.',
        })
        .eq('id', atividade.id);
    }

    // Deferimento: ninguém recebe zap, e as DUAS pessoas do fluxo previdenciário
    // precisam saber (pedido do usuário, 04/09/2026) — Luana, que protocolou, e
    // José, que toca o pós-protocolo. A atividade que já nasceu ficou com o
    // dono de sempre; aqui ela ganha o roteiro e sai uma irmã para quem faltou.
    if (zapPatch.zap_status === 'so_equipe' && atividade?.id) {
      const roteiro =
        '\n\n🎉 O INSS APROVOU ESTE PEDIDO. O cliente NÃO foi avisado pelo robô: quem dá a ' +
        'notícia é uma pessoa.\nFale com ele no grupo, confira os valores e combine o que o ' +
        'escritório precisa para acompanhar o pagamento. Se for preciso acessar o Meu INSS do ' +
        'cliente, combine isso por voz com ele — não peça senha por escrito no grupo.';
      await supabase
        .from('lead_activities')
        .update({ description: `${atividade.description || activityDesc}${roteiro}` })
        .eq('id', atividade.id);

      const avisar: DonoAtividade[] = [ASSESSOR_INSS, ASSESSOR_PROTOCOLO].filter(
        (p) => p.id !== dono.id,
      );
      for (const pessoa of avisar) {
        const { error } = await supabase.from('lead_activities').insert({
          lead_id: leadId,
          title: activityTitle,
          description:
            `${activityDesc}${roteiro}\n\n👥 ${dono.name} recebeu esta mesma tarefa — ` +
            'combinem quem fala com o cliente para ele não ser procurado duas vezes.',
          activity_type: 'notificacao',
          status: 'pendente',
          priority: 'normal',
          assigned_to: pessoa.id,
          assigned_to_name: pessoa.name,
          deadline: new Date().toISOString().slice(0, 10),
          case_id: proc.case_id,
          case_title: formatLabel(caseInfo?.case_number, caseInfo?.title) || null,
          process_id: process?.id || null,
          process_title: process ? formatLabel(process.process_number, process.title) || null : null,
          action_source: 'system',
          action_source_detail: 'Robô do INSS',
        } as any);
        if (error) {
          console.warn(`[notify-inss-update] atividade de deferimento para ${pessoa.name} falhou: ${error.message}`);
        }
      }
    }

    // Dois desfechos em que o cliente NÃO foi avisado e o robô não pode
    // resolver sozinho: o WhatsApp recusou o envio, ou o nome do segurado não
    // bate com o do lead e mandar poria a informação no grupo de outro cliente.
    //
    // Os dois eram mudos — viviam num `console.warn` e numa coluna que ninguém
    // lê, enquanto o desfecho mais seguro (`sem_grupo`) já gritava na atividade.
    // A assimetria era o defeito. Medido em 04/09/2026: 38 parados por nome
    // divergente (17 indeferimentos, 7 deferimentos) e 2 por envio recusado.
    //
    // O José é avisado mesmo quando a atividade é de outra pessoa (pedido do
    // usuário): ele toca o pós-protocolo e decide se fala com o cliente à mão.
    // Só o envio recusado entra aqui. O vínculo suspeito já é conhecido ANTES de
    // a atividade nascer, então o aviso dele vai na própria descrição — repetir
    // aqui daria dois avisos iguais na mesma atividade.
    const avisoDeNaoEntrega =
      zapPatch.zap_status === 'erro'
        ? avisoDeFalhaNoEnvio({ zapErro: zapPatch.zap_erro, tipo: tipoMensagem })
        : null;

    if (avisoDeNaoEntrega && atividade?.id) {
      await supabase
        .from('lead_activities')
        .update({ description: `${atividade.description || activityDesc}${avisoDeNaoEntrega}` })
        .eq('id', atividade.id);

      if (dono.id !== ASSESSOR_INSS.id) {
        const { error } = await supabase.from('lead_activities').insert({
          lead_id: leadId,
          title: activityTitle,
          description:
            `${activityDesc}${avisoDeNaoEntrega}\n\n👥 ${dono.name} recebeu esta mesma tarefa — ` +
            'combinem quem fala com o cliente para ele não ser procurado duas vezes.',
          activity_type: 'notificacao',
          status: 'pendente',
          priority: 'normal',
          assigned_to: ASSESSOR_INSS.id,
          assigned_to_name: ASSESSOR_INSS.name,
          deadline: new Date().toISOString().slice(0, 10),
          case_id: proc.case_id,
          case_title: formatLabel(caseInfo?.case_number, caseInfo?.title) || null,
          process_id: process?.id || null,
          process_title: process ? formatLabel(process.process_number, process.title) || null : null,
          action_source: 'system',
          action_source_detail: 'Robô do INSS',
        } as any);
        if (error) {
          console.warn(
            `[notify-inss-update] aviso de não entrega para ${ASSESSOR_INSS.name} falhou: ${error.message}`,
          );
        }
      }
    }

    if (zapPatch.zap_status === 'sem_grupo' && atividade?.id) {
      const aviso =
        '\n\n📵 O CLIENTE NÃO FOI AVISADO — este lead não tem grupo de WhatsApp confiável ' +
        `vinculado (${zapPatch.zap_erro}).\n` +
        'Vincule o grupo certo ao lead (ficha do lead → WhatsApp → vincular grupo) e avise o ' +
        'cliente desta atualização por aqui. Depois de vinculado, as próximas mensagens saem sozinhas.';
      await supabase
        .from('lead_activities')
        .update({ description: `${atividade.description || activityDesc}${aviso}` })
        .eq('id', atividade.id);
    }

    // O PDF existe mas não chegou ao cliente (mensagem agendada para a janela,
    // envio recusado pela instância, ou o evento nem virou mensagem). Quem abre
    // a atividade precisa saber que o anexo ficou por conta dela.
    if (procuracao && !procuracaoEnviada && atividade?.id) {
      const motivo =
        zapPatch.zap_status === 'agendado'
          ? 'a mensagem ficou agendada para a janela de 8h às 20h e o PDF vai junto com ela'
          : `a mensagem não saiu (${zapPatch.zap_status})`;
      await supabase
        .from('lead_activities')
        .update({
          description:
            `${atividade.description || activityDesc}\n\n` +
            `📎 O PDF DA PROCURAÇÃO AINDA NÃO CHEGOU AO CLIENTE: ${motivo}. ` +
            'Se precisar adiantar, mande o link acima no grupo.',
        })
        .eq('id', atividade.id);
    }

    // 3) Marca como notificado. Só o evento mais recente pode virar mensagem;
    // os outros do lote entram como 'suprimido' pra ninguém achar que sumiram.
    const agora = new Date().toISOString();
    await marcarNotificado([latest.id], agora, zapPatch);
    const antigos = pending.slice(1).map((p) => p.id);
    if (antigos.length > 0) {
      await marcarNotificado(antigos, agora, { zap_status: 'suprimido' });
    }
    const ids = pending.map((p) => p.id);

    return res.status(200).json({
      success: true,
      activity_created: true,
      group_message_sent: sentToGroup,
      procuracao_enviada: procuracaoEnviada,
      humanized_preview: humanText?.slice(0, 200),
      notified_count: ids.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notify-inss-update] error:', msg);
    return res.status(200).json({ success: false, error: msg });
  }
};
