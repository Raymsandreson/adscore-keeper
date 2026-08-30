// =============================================================================
// Push dos tribunais por E-MAIL → feed do sino → reabertura seletiva do Escavador.
//
// POR QUE EXISTE (decisão do Raym, 11/08/2026):
//   A captura do Escavador custa R$ 0,20 por processo — R$ 65,80 a varredura
//   completa dos 329 — e por isso a rotina jm_esc_rotina nasceu SEM cron de
//   reabertura: reconsultar todo mundo todo dia daria ~R$ 1.974/mês.
//   Só que os tribunais já avisam de graça, em minutos, QUAIS processos
//   mexeram. Então o e-mail passa a ser o gatilho — o Escavador só é reaberto
//   para os processos que tiveram push. A conta cai de "todos os 329" para
//   "os que mexeram", que é a diferença entre R$ 65,80 e alguns centavos.
//
// DE ONDE VEM O E-MAIL (mudou em 11/08/2026):
//   Esta função lê processual_emails, que o gmail-processual-sync do Railway
//   enche de hora em hora COM O CORPO (body_text). Sem OAuth, sem segundo
//   caminho para o mesmo dado.
//
// O QUE ESTA FUNÇÃO FAZ, NESTA ORDEM:
//   1. pega os e-mails ainda não processados (vw_email_push_pendentes) — ou,
//      no modo reprocessamento, o conjunto pedido no body;
//   2. extrai as movimentações (emailPushParser: PJe em tabela, bloco
//      "Eventos:", EPROC em linha ou corrido, e-SAJ, PJe Push TRF1/TRF3,
//      PROJUDI);
//   3. casa o identificador TIPADO com lead_processes e grava no feed do sino
//      (process_updates) — de graça e na hora, sem depender de API paga;
//   3b. e-mail SEM movimentação judicial passa pela trilha ADMINISTRATIVA:
//      protocolo do INSS (inssAdministrativoParser) e identificadores com
//      âncora (SEI/MTE, demanda do SIT, ordem de serviço, IC do MPT —
//      identificadorProcessual). O tipo do identificador tem que bater com o
//      tipo do process_number cadastrado: protocolo nunca casa com CNJ;
//   3c. identificador que NÃO casou não é mais jogado fora: vira linha em
//      email_identificadores_orfaos (RPC jm_email_orfaos_upsert), de onde a
//      aba "Sem vínculo" permite vincular/criar/ignorar;
//   4. reabre no Escavador só os processos com push RECENTE.
//
// O PARSER É VERSIONADO (30/08/2026): a marca em email_push_processados guarda
// QUAL parser leu cada e-mail (parser_versao, migration 20260830210000), e
// vw_email_push_pendentes devolve para a fila quem foi lido por versão anterior.
// Sem isso, melhoria de parser só valia para o e-mail que chegasse DEPOIS dela:
// os três pushes do TRF1 do processo 1017247-47.2025.4.01.3100 estavam na base
// desde junho, foram lidos em 11/08 pelo parser que só copiava o assunto, e a
// ficha seguia dizendo "Nenhuma movimentação capturada" — 155 processos assim.
// Mudou o que emailPushParser.ts extrai? sobe jm_email_parser_versao() em +1.
//
// O ÍNDICE DE PROCESSOS É PAGINADO (30/08/2026): o PostgREST corta qualquer
// select em 1.000 linhas e a base tem 1.645 processos ativos com número. Sem
// paginação, ~39% da carteira NUNCA casava — e era sempre o mesmo pedaço
// (medido: os 4 processos de teste da tarefa estavam nas posições 1006-1626).
// `indice_processos_carregados` sai no retorno para isso nunca mais falhar
// calado.
//
// Modos:
//   { limite?: 200, reabrir_desde_dias?: 3, dry_run?: false,
//     reprocessar?: { desde?: 'YYYY-MM-DD', identificador?: string,
//                     apagar_cards?: boolean } }
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseEmailPush, soDigitos, type MovimentacaoEmail } from "../_shared/emailPushParser.ts";
import { classifyUpdates } from "../_shared/processUpdateClassifier.ts";
import { parseEmailAdministrativo } from "../_shared/inssAdministrativoParser.ts";
import { classificarEsfera } from "../_shared/esferaJustica.ts";
import {
  chaveIdentificador,
  classificarNumeroCadastrado,
  extrairIdentificadoresAdministrativos,
  type IdentificadorExtraido,
  type TipoIdentificador,
} from "../_shared/identificadorProcessual.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

const EXTERNAL_URL_DEFAULT = "https://kmedldlepwiityjsdahz.supabase.co";

function getDbClient(): SupabaseClient {
  const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || EXTERNAL_URL_DEFAULT).trim();
  const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  return createClient(url, key, { auth: { persistSession: false } });
}

interface ProcessoRow {
  id: string;
  process_number: string | null;
  title: string | null;
  lead_id: string | null;
  case_id: string | null;
  process_type: string | null;
  area: string | null;
  assuntos: string[] | null;
  classe: string | null;
  polo_ativo: string | null;
  polo_passivo: string | null;
  leads: { lead_name: string | null; case_type: string | null } | null;
}

interface EmailRow {
  gmail_message_id: string;
  subject: string | null;
  from_addr: string | null;
  body_text: string | null;
  received_at: string;
}

/** O que vira linha em email_identificadores_orfaos quando não casa. */
interface Orfao {
  identificador: string;
  tipo: TipoIdentificador;
  ocorrido_em: string;
  remetente: string | null;
  assunto: string | null;
  message_id: string;
  ocorrencias: number;
}

interface Resultado {
  emails_lidos: number;
  emails_com_processo: number;
  movimentacoes: number;
  feed_inserido: number;
  processos_casados: number;
  /** Quantas linhas vieram da trilha administrativa (INSS/SEI/MTE, não CNJ). */
  administrativos: number;
  /** Quantos processos o índice carregou — tem que bater com a base (1.645 em 30/08/2026). */
  indice_processos_carregados: number;
  identificadores_por_tipo: Record<string, number>;
  casados_por_tipo: Record<string, number>;
  orfaos_gravados: number;
  cnjs_sem_cadastro: string[];
  reabertos_escavador: number;
  pendentes_restantes: number | null;
  reprocessados: number | null;
  /** Versão do parser desta rodada (null = migration 20260830210000 não aplicada). */
  parser_versao: number | null;
  erros: string[];
}

/**
 * Índice tipado de TODOS os processos ativos com número. Paginado porque o
 * PostgREST devolve no máximo 1.000 linhas por request — o teto silencioso que
 * escondeu 39% da carteira até 30/08/2026.
 */
async function carregarIndice(ext: SupabaseClient): Promise<{
  porChave: Map<string, ProcessoRow>;
  total: number;
}> {
  const porChave = new Map<string, ProcessoRow>();
  let total = 0;
  const PAGINA = 1000;
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await ext
      .from('lead_processes')
      .select('id, process_number, title, lead_id, case_id, process_type, area, assuntos, classe, polo_ativo, polo_passivo, leads(lead_name, case_type)')
      .is('deleted_at', null)
      .not('process_number', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGINA - 1);
    if (error) throw error;
    const pagina = (data || []) as unknown as ProcessoRow[];
    total += pagina.length;
    for (const p of pagina) {
      const cls = classificarNumeroCadastrado(p.process_number);
      if (!cls) continue;
      porChave.set(chaveIdentificador(cls.tipo, cls.digitos), p);
    }
    if (pagina.length < PAGINA) break;
  }
  return { porChave, total };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const out: Resultado = {
    emails_lidos: 0, emails_com_processo: 0, movimentacoes: 0,
    feed_inserido: 0, processos_casados: 0, administrativos: 0,
    indice_processos_carregados: 0,
    identificadores_por_tipo: {}, casados_por_tipo: {}, orfaos_gravados: 0,
    cnjs_sem_cadastro: [], reabertos_escavador: 0, pendentes_restantes: null,
    reprocessados: null, parser_versao: null, erros: [],
  };

  const conta = (mapa: Record<string, number>, chave: string, n = 1) => {
    mapa[chave] = (mapa[chave] || 0) + n;
  };

  try {
    const body = await req.json().catch(() => ({}));
    const limite = Math.min(Math.max(Number(body.limite) || 200, 1), 1000);
    const reabrirDesdeDias = Math.min(Math.max(Number(body.reabrir_desde_dias) ?? 3, 0), 30);
    const dryRun = body.dry_run === true;
    const reprocessar = body.reprocessar && typeof body.reprocessar === 'object'
      ? body.reprocessar as { desde?: string; identificador?: string; apagar_cards?: boolean }
      : null;

    const ext = getDbClient();

    // Versão do parser desta rodada. Vem do banco (jm_email_parser_versao) para
    // não haver dois números para a mesma coisa: a mesma função decide o que a
    // fila devolve e o que a marca guarda.
    //
    // Erro aqui = migration 20260830210000 ainda não aplicada. Nesse caso a
    // marca vai SEM a coluna (o upsert falharia e o e-mail nunca sairia da
    // fila) e a rodada segue como antes — degrau, não parada.
    let parserVersao: number | null = null;
    {
      const { data, error } = await ext.rpc('jm_email_parser_versao');
      if (error) out.erros.push(`versao do parser indisponivel: ${error.message}`);
      else if (data !== null && data !== undefined) parserVersao = Number(data);
    }
    out.parser_versao = parserVersao;
    const marcaVersao = parserVersao === null ? {} : { parser_versao: parserVersao };

    const { porChave, total } = await carregarIndice(ext);
    out.indice_processos_carregados = total;

    // ------------------------------------------------------------------
    // De onde vêm os e-mails desta rodada
    // ------------------------------------------------------------------
    let emails: EmailRow[] = [];
    let count: number | null = null;

    if (reprocessar) {
      // Reprocessamento dirigido: por identificador (a aba "Sem vínculo" acabou
      // de vincular um processo e quer os cards retroativos) ou por janela (o
      // comparativo antes/depois dos últimos N dias).
      let q = ext
        .from('processual_emails')
        .select('gmail_message_id, subject, from_addr, body_text, received_at')
        .is('deleted_at', null)
        .order('received_at', { ascending: false })
        .limit(limite);
      if (reprocessar.desde) q = q.gte('received_at', reprocessar.desde);
      if (reprocessar.identificador) {
        const valor = String(reprocessar.identificador);
        const digitos = soDigitos(valor);
        // O e-mail pode trazer o número com ou sem máscara; procura os dois.
        q = digitos && digitos !== valor
          ? q.or(`body_text.ilike.%${valor}%,subject.ilike.%${valor}%,body_text.ilike.%${digitos}%,subject.ilike.%${digitos}%`)
          : q.or(`body_text.ilike.%${valor}%,subject.ilike.%${valor}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      emails = (data || []) as EmailRow[];
      out.reprocessados = emails.length;

      if (!dryRun && emails.length > 0) {
        const ids = emails.map((e) => e.gmail_message_id);
        // Sai da lista de processados para o parser rodar de novo…
        const { error: e1 } = await ext.from('email_push_processados').delete().in('message_id', ids);
        if (e1) out.erros.push(`reprocesso limpar processados: ${e1.message}`);
        // …e, se pedido, apaga os cards antigos DESTES e-mails (o parser novo
        // gera hash diferente do card velho — sem isso o feed duplicaria).
        // Só alcança linhas com email_message_id, que a própria função grava.
        if (reprocessar.apagar_cards) {
          const { error: e2 } = await ext
            .from('process_updates')
            .delete()
            .eq('origem', 'email_push')
            .in('email_message_id', ids);
          if (e2) out.erros.push(`reprocesso apagar cards: ${e2.message}`);
        }
      }
    } else {
      // A view já faz o anti-join com email_push_processados e ordena do mais
      // recente para o mais antigo: quem chegou agora é atendido primeiro, e o
      // histórico vai sendo drenado nas rodadas seguintes.
      const { data, error, count: c } = await ext
        .from('vw_email_push_pendentes')
        .select('gmail_message_id, subject, from_addr, body_text, received_at', { count: 'exact' })
        .limit(limite);
      if (error) throw error;
      emails = (data || []) as EmailRow[];
      count = typeof c === 'number' ? c : null;
    }

    // Texto extraído de anexos (MTE manda o ato no PDF, não no corpo). A
    // tabela pode ainda não existir/estar vazia — aí a varredura segue só no
    // corpo, sem erro.
    const textoDeAnexos = new Map<string, string>();
    if (emails.length > 0) {
      const ids = emails.map((e) => e.gmail_message_id);
      const { data: anexos } = await ext
        .from('processual_email_anexos')
        .select('gmail_message_id, texto_extraido')
        .in('gmail_message_id', ids)
        .not('texto_extraido', 'is', null);
      for (const a of (anexos || []) as Array<{ gmail_message_id: string; texto_extraido: string }>) {
        const atual = textoDeAnexos.get(a.gmail_message_id) || '';
        textoDeAnexos.set(a.gmail_message_id, `${atual}\n${a.texto_extraido || ''}`);
      }
    }

    const corteReabertura = new Date(Date.now() - reabrirDesdeDias * 86400_000);
    const semCadastro = new Set<string>();
    const cnjsParaReabrir = new Set<string>();
    // Órfãos agregados da rodada — um upsert em lote no fim, não um por e-mail.
    const orfaos = new Map<string, Orfao>();

    const registrarOrfao = (id: IdentificadorExtraido | { tipo: TipoIdentificador; valor: string; valorNormalizado: string }, email: EmailRow) => {
      // documento_sei nunca identifica processo — não vira órfão vinculável.
      if (id.tipo === 'documento_sei') return;
      const chave = chaveIdentificador(id.tipo, id.valorNormalizado);
      const atual = orfaos.get(chave);
      if (atual) {
        atual.ocorrencias++;
        if (email.received_at > atual.ocorrido_em) {
          atual.ocorrido_em = email.received_at;
          atual.remetente = email.from_addr;
          atual.assunto = email.subject;
          atual.message_id = email.gmail_message_id;
        }
      } else {
        orfaos.set(chave, {
          identificador: id.valor,
          tipo: id.tipo,
          ocorrido_em: email.received_at,
          remetente: email.from_addr,
          assunto: email.subject,
          message_id: email.gmail_message_id,
          ocorrencias: 1,
        });
      }
    };

    for (const email of emails) {
      out.emails_lidos++;
      const assunto = email.subject || '';
      const remetente = email.from_addr || '';
      const dataEmail = email.received_at.slice(0, 10);
      const recenteOSuficiente = new Date(email.received_at) >= corteReabertura;
      const corpoComAnexos = `${email.body_text || ''}\n${textoDeAnexos.get(email.gmail_message_id) || ''}`;

      const movs: MovimentacaoEmail[] = parseEmailPush({
        assunto,
        corpo: email.body_text,
        // Teto das datas do bloco de eventos: audiência designada para daqui a
        // três meses não pode virar a data da notícia.
        dataEmail,
      });

      if (movs.length === 0) {
        // ------------------------------------------------------------
        // Trilha ADMINISTRATIVA: sem CNJ ainda pode ser INSS (protocolo),
        // SEI/MTE, demanda do SIT, ordem de serviço ou IC do MPT.
        // ------------------------------------------------------------
        const admin = parseEmailAdministrativo({ assunto, corpo: email.body_text, dataEmail });
        let casadosAdmin = 0;
        let movsAdmin = admin.length;

        for (const a of admin) {
          conta(out.identificadores_por_tipo, 'protocolo_inss');
          const proc = porChave.get(chaveIdentificador('protocolo_inss', a.protocolo));
          if (!proc) {
            registrarOrfao({ tipo: 'protocolo_inss', valor: a.protocolo, valorNormalizado: a.protocolo }, email);
            continue;
          }
          casadosAdmin++;
          out.processos_casados++;
          out.administrativos++;
          conta(out.casados_por_tipo, 'protocolo_inss');

          const classificadas = classifyUpdates(
            [{
              conteudo: a.texto,
              titulo: a.titulo,
              data: a.data || dataEmail,
              // O INSS manda o status em campo próprio; não há o que adivinhar.
              categoria_forcada: a.categoria,
            }] as unknown as Parameters<typeof classifyUpdates>[0],
            { numeroCnj: proc.process_number || a.protocolo },
          );
          if (classificadas.length === 0) continue;

          const esfera = classificarEsfera({
            numeroCnj: proc.process_number,
            processType: proc.process_type,
            area: proc.area,
            assuntos: proc.assuntos,
            classe: proc.classe,
            caseType: proc.leads?.case_type ?? null,
            titulo: proc.title,
            poloAtivo: proc.polo_ativo,
            poloPassivo: proc.polo_passivo,
          });

          const linhas = classificadas.map((u) => ({
            process_id: proc.id,
            lead_id: proc.lead_id,
            case_id: proc.case_id,
            numero_cnj: proc.process_number,
            processo_titulo: proc.title || proc.leads?.lead_name || proc.process_number,
            esfera,
            origem: 'email_push',
            categoria: u.categoria,
            // O título do INSS diz o que mudou ("Requerimento 812040787 —
            // Concluída"); o rótulo genérico da categoria não diria nada.
            titulo: a.titulo,
            descricao: u.descricao,
            data_movimentacao: u.data_movimentacao,
            data_presumida: false,
            conteudo_hash: u.conteudo_hash,
            eventos: null,
            email_message_id: email.gmail_message_id,
            email_recebido_em: email.received_at,
          }));

          if (!dryRun) {
            const { error } = await ext
              .from('process_updates')
              .upsert(linhas, { onConflict: 'process_id,conteudo_hash', ignoreDuplicates: true });
            if (error) out.erros.push(`feed adm ${a.protocolo}: ${error.message}`);
            else out.feed_inserido += linhas.length;
          } else {
            out.feed_inserido += linhas.length;
          }
        }

        // Identificadores com âncora (SEI, demanda, OS, IC, CNJ sem máscara) —
        // varridos TAMBÉM sobre o texto extraído dos anexos: no MTE o ato está
        // no PDF ("Saudações, para ciência" + Despacho_2688783.pdf).
        const ids = extrairIdentificadoresAdministrativos({ assunto, corpo: corpoComAnexos });
        const documentosFilhos = ids.filter((i) => i.tipo === 'documento_sei');
        for (const id of ids) {
          if (id.tipo === 'documento_sei') continue;
          conta(out.identificadores_por_tipo, id.tipo);
          const proc = porChave.get(chaveIdentificador(id.tipo, id.valorNormalizado));
          if (!proc) {
            registrarOrfao(id, email);
            continue;
          }
          casadosAdmin++;
          movsAdmin++;
          out.processos_casados++;
          out.administrativos++;
          conta(out.casados_por_tipo, id.tipo);

          const esfera = classificarEsfera({
            numeroCnj: proc.process_number,
            processType: proc.process_type,
            area: proc.area,
            assuntos: proc.assuntos,
            classe: proc.classe,
            caseType: proc.leads?.case_type ?? null,
            titulo: proc.title,
            poloAtivo: proc.polo_ativo,
            poloPassivo: proc.polo_passivo,
          });

          const tituloCard = (assunto || `Comunicação sobre ${id.valor}`).slice(0, 200);
          const descricao = (email.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
          const classificadas = classifyUpdates(
            [{
              conteudo: descricao || tituloCard,
              titulo: tituloCard,
              // A comunicação recebida É o fato da trilha administrativa: a
              // data do e-mail aqui não é presunção, é o dia em que o órgão
              // falou com o escritório.
              data: dataEmail,
            }] as unknown as Parameters<typeof classifyUpdates>[0],
            { numeroCnj: proc.process_number || id.valorNormalizado },
          );
          if (classificadas.length === 0) continue;

          const linhas = classificadas.map((u) => ({
            process_id: proc.id,
            lead_id: proc.lead_id,
            case_id: proc.case_id,
            numero_cnj: proc.process_number,
            processo_titulo: proc.title || proc.leads?.lead_name || proc.process_number,
            esfera,
            origem: 'email_push',
            categoria: u.categoria,
            titulo: tituloCard,
            descricao: u.descricao,
            data_movimentacao: u.data_movimentacao,
            data_presumida: false,
            conteudo_hash: u.conteudo_hash,
            // Documento filho do SEI (Despacho_2688783): registrado junto do
            // card do processo pai — nunca casa processo sozinho.
            eventos: documentosFilhos.length
              ? documentosFilhos.map((d) => ({ data: dataEmail, hora: null, texto: d.valor }))
              : null,
            email_message_id: email.gmail_message_id,
            email_recebido_em: email.received_at,
          }));

          if (!dryRun) {
            const { error } = await ext
              .from('process_updates')
              .upsert(linhas, { onConflict: 'process_id,conteudo_hash', ignoreDuplicates: true });
            if (error) out.erros.push(`feed adm ${id.valor}: ${error.message}`);
            else out.feed_inserido += linhas.length;
          } else {
            out.feed_inserido += linhas.length;
          }
        }

        if (movsAdmin > 0) out.movimentacoes += movsAdmin;

        // Marca mesmo assim: sem isso o e-mail sem CNJ volta a ser lido em toda
        // rodada e nunca sai da fila. Vale também para o administrativo que não
        // casou — o requerimento não está cadastrado, e reler não muda isso
        // (quando for cadastrado, a aba "Sem vínculo" reprocessa por
        // identificador).
        if (!dryRun) {
          await ext.from('email_push_processados').upsert({
            message_id: email.gmail_message_id, assunto, remetente,
            movimentacoes: movsAdmin, casados: casadosAdmin, ...marcaVersao,
          }, { onConflict: 'message_id' });
        }
        continue;
      }
      out.emails_com_processo++;
      out.movimentacoes += movs.length;

      // Agrupa por processo: cada e-mail pode falar de vários (e-SAJ, EPROC).
      const porProcesso = new Map<string, MovimentacaoEmail[]>();
      for (const m of movs) {
        const acc = porProcesso.get(m.cnjDigitos) || [];
        acc.push(m);
        porProcesso.set(m.cnjDigitos, acc);
      }

      let casados = 0;
      for (const [digitos, doProcesso] of porProcesso) {
        conta(out.identificadores_por_tipo, 'cnj');
        const proc = porChave.get(chaveIdentificador('cnj', digitos));
        if (!proc) {
          semCadastro.add(doProcesso[0].cnj);
          registrarOrfao({ tipo: 'cnj', valor: doProcesso[0].cnj, valorNormalizado: digitos }, email);
          continue;
        }
        casados++;
        out.processos_casados++;
        conta(out.casados_por_tipo, 'cnj');
        if (recenteOSuficiente) {
          cnjsParaReabrir.add(proc.process_number || doProcesso[0].cnj);
        }

        // Reaproveita o classificador do Escavador: mesma categoria, mesmo
        // hash de dedupe. Movimento sem data no corpo (EPROC) herda a do
        // e-mail — MENOS no fallback de layout desconhecido: ali a data do
        // e-mail é chute, então fica NULA e a linha sai marcada
        // data_presumida (o front mostra "sem data", não "hoje").
        const classificadas = classifyUpdates(
          doProcesso.map((m) => ({
            conteudo: m.texto,
            data: m.data || (m.fonte === 'desconhecida' ? null : dataEmail),
          })) as unknown as Parameters<typeof classifyUpdates>[0],
          { numeroCnj: proc.process_number || digitos },
        );
        if (classificadas.length === 0) continue;

        const esfera = classificarEsfera({
          numeroCnj: proc.process_number,
          processType: proc.process_type,
          area: proc.area,
          assuntos: proc.assuntos,
          classe: proc.classe,
          caseType: proc.leads?.case_type ?? null,
          titulo: proc.title,
          poloAtivo: proc.polo_ativo,
          poloPassivo: proc.polo_passivo,
        });

        // Push agrupado (bloco "Eventos:" ou tabela Data/Movimento do TRF): o
        // e-mail inteiro é UMA movimentação com os eventos junto. Aí o título
        // deixa de ser o rótulo genérico da categoria ("Movimentação") e passa
        // a ser o evento que diz alguma coisa.
        const agrupado = doProcesso.length === 1 && (doProcesso[0].eventos?.length || 0) > 0
          ? doProcesso[0]
          : null;
        const presumida = doProcesso.some((m) => m.fonte === 'desconhecida');

        const linhas = classificadas.map((u) => ({
          process_id: proc.id,
          lead_id: proc.lead_id,
          case_id: proc.case_id,
          numero_cnj: proc.process_number,
          processo_titulo: proc.title || proc.leads?.lead_name || proc.process_number,
          esfera,
          origem: 'email_push',
          categoria: u.categoria,
          titulo: agrupado?.titulo || doProcesso[0]?.titulo || u.titulo,
          descricao: u.descricao,
          data_movimentacao: u.data_movimentacao,
          data_presumida: presumida && !u.data_movimentacao,
          conteudo_hash: u.conteudo_hash,
          eventos: agrupado?.eventos || null,
          email_message_id: email.gmail_message_id,
          email_recebido_em: email.received_at,
        }));

        if (!dryRun) {
          const { error } = await ext
            .from('process_updates')
            .upsert(linhas, { onConflict: 'process_id,conteudo_hash', ignoreDuplicates: true });
          if (error) out.erros.push(`feed ${proc.process_number}: ${error.message}`);
          else out.feed_inserido += linhas.length;
        } else {
          out.feed_inserido += linhas.length;
        }
      }

      if (!dryRun) {
        await ext.from('email_push_processados').upsert({
          message_id: email.gmail_message_id, assunto, remetente,
          movimentacoes: movs.length, casados, ...marcaVersao,
        }, { onConflict: 'message_id' });
      }
    }

    // ------------------------------------------------------------------
    // Órfãos da rodada → email_identificadores_orfaos (aba "Sem vínculo").
    // Upsert em lote via RPC: quem já existe soma ocorrências e atualiza a
    // última aparição; status (novo/ignorado/vinculado) é preservado lá.
    // ------------------------------------------------------------------
    if (!dryRun && orfaos.size > 0) {
      const { data, error } = await ext.rpc('jm_email_orfaos_upsert', {
        p_itens: [...orfaos.values()],
      });
      if (error) out.erros.push(`orfaos: ${error.message}`);
      else out.orfaos_gravados = Number(data) || orfaos.size;
    } else {
      out.orfaos_gravados = orfaos.size;
    }

    // A reabertura é o único ponto que GASTA. Fica por último, só com o que
    // casou com processo cadastrado E veio de e-mail dentro da janela.
    if (!dryRun && cnjsParaReabrir.size > 0) {
      const { data, error } = await ext.rpc('jm_esc_reabrir_por_cnj', {
        p_cnjs: [...cnjsParaReabrir],
      });
      if (error) out.erros.push(`reabertura: ${error.message}`);
      else out.reabertos_escavador = Number(data) || 0;
    }

    out.cnjs_sem_cadastro = [...semCadastro].slice(0, 50);
    // Quanto ainda falta drenar — é o número que diz se o cron de hora em hora
    // está dando conta ou se a fila só cresce.
    out.pendentes_restantes = typeof count === 'number'
      ? Math.max(count - out.emails_lidos, 0)
      : null;

    return new Response(JSON.stringify({ success: true, ...out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sync-email-push]', err);
    return new Response(
      JSON.stringify({ success: false, error: String((err as Error)?.message || err), ...out }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
