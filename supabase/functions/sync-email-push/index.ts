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
//   Antes esta função chamava a API do Gmail direto, com o refresh_token de
//   google_oauth_tokens. Nunca funcionou por dois motivos somados: a função não
//   chegou a ser deployada (o cron das :35 recebia 404 em silêncio) e o único
//   token cadastrado não tem o escopo gmail — o laço pularia a conta de
//   qualquer forma.
//
//   Agora ela lê processual_emails, que o gmail-processual-sync do Railway já
//   enche de hora em hora COM O CORPO (body_text). O e-mail já está no banco;
//   buscar de novo no Gmail era um segundo caminho para o mesmo dado, com uma
//   credencial a mais para manter viva. Some a dependência de OAuth, some o
//   acesso desta função à caixa, e o denominador do painel do sino ("x de
//   2.819") passa a medir a mesma população que ela realmente processa.
//
// O QUE ESTA FUNÇÃO FAZ, NESTA ORDEM:
//   1. pega os e-mails ainda não processados (vw_email_push_pendentes);
//   2. extrai as movimentações (emailPushParser: PJe em tabela, PJe com bloco
//      "Eventos:" em linha corrida — que vira UMA linha com os eventos junto —,
//      EPROC e e-SAJ);
//   3. casa o CNJ com lead_processes e grava no feed do sino (process_updates)
//      — de graça e na hora, sem depender de nenhuma API paga;
//   4. reabre no Escavador só os processos com push RECENTE, para vir o
//      detalhe/documentos.
//
// O PASSO 4 É O ÚNICO QUE GASTA, e por isso tem janela própria
// (reabrir_desde_dias, padrão 3). O passo 1 pode varrer o histórico inteiro
// sem custo, mas reabrir processo por causa de e-mail de abril é pagar por
// notícia velha — a rodada de backfill alimenta só o feed.
//
// PRIVACIDADE: esta função não fala mais com o Gmail. Ela lê o que o sync já
// filtrou para processual_emails, e o parser descarta o que não tem CNJ.
//
// Modos:
//   { limite?: 200, reabrir_desde_dias?: 3, dry_run?: false }
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseEmailPush, soDigitos, type MovimentacaoEmail } from "../_shared/emailPushParser.ts";
import { classifyUpdates } from "../_shared/processUpdateClassifier.ts";
import { classificarEsfera } from "../_shared/esferaJustica.ts";

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

interface Resultado {
  emails_lidos: number;
  emails_com_processo: number;
  movimentacoes: number;
  feed_inserido: number;
  processos_casados: number;
  cnjs_sem_cadastro: string[];
  reabertos_escavador: number;
  pendentes_restantes: number | null;
  erros: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const out: Resultado = {
    emails_lidos: 0, emails_com_processo: 0, movimentacoes: 0,
    feed_inserido: 0, processos_casados: 0, cnjs_sem_cadastro: [],
    reabertos_escavador: 0, pendentes_restantes: null, erros: [],
  };

  try {
    const body = await req.json().catch(() => ({}));
    const limite = Math.min(Math.max(Number(body.limite) || 200, 1), 1000);
    const reabrirDesdeDias = Math.min(Math.max(Number(body.reabrir_desde_dias) ?? 3, 0), 30);
    const dryRun = body.dry_run === true;

    const ext = getDbClient();

    // Índice CNJ (só dígitos) → processo. São ~330 linhas; cabe na memória e
    // evita uma consulta por e-mail.
    const { data: processos, error: errProc } = await ext
      .from('lead_processes')
      .select('id, process_number, title, lead_id, case_id, process_type, area, assuntos, classe, polo_ativo, polo_passivo, leads(lead_name, case_type)')
      .is('deleted_at', null)
      .not('process_number', 'is', null);
    if (errProc) throw errProc;

    const porCnj = new Map<string, ProcessoRow>();
    for (const p of (processos || []) as unknown as ProcessoRow[]) {
      const d = soDigitos(p.process_number || '');
      if (d.length >= 15) porCnj.set(d, p);
    }

    // A view já faz o anti-join com email_push_processados e ordena do mais
    // recente para o mais antigo: quem chegou agora é atendido primeiro, e o
    // histórico vai sendo drenado nas rodadas seguintes.
    const { data: emails, error: errEmails, count } = await ext
      .from('vw_email_push_pendentes')
      .select('gmail_message_id, subject, from_addr, body_text, received_at', { count: 'exact' })
      .limit(limite);
    if (errEmails) throw errEmails;

    const corteReabertura = new Date(Date.now() - reabrirDesdeDias * 86400_000);
    const semCadastro = new Set<string>();
    const cnjsParaReabrir = new Set<string>();

    for (const email of (emails || []) as EmailRow[]) {
      out.emails_lidos++;
      const assunto = email.subject || '';
      const remetente = email.from_addr || '';
      const dataEmail = email.received_at.slice(0, 10);
      const recenteOSuficiente = new Date(email.received_at) >= corteReabertura;

      const movs: MovimentacaoEmail[] = parseEmailPush({
        assunto,
        corpo: email.body_text,
        // Teto das datas do bloco de eventos: audiência designada para daqui a
        // três meses não pode virar a data da notícia.
        dataEmail,
      });

      if (movs.length === 0) {
        // Marca mesmo assim: sem isso o e-mail sem CNJ volta a ser lido em toda
        // rodada e nunca sai da fila.
        if (!dryRun) {
          await ext.from('email_push_processados').upsert({
            message_id: email.gmail_message_id, assunto, remetente,
            movimentacoes: 0, casados: 0,
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
        const proc = porCnj.get(digitos);
        if (!proc) { semCadastro.add(doProcesso[0].cnj); continue; }
        casados++;
        out.processos_casados++;
        if (recenteOSuficiente) {
          cnjsParaReabrir.add(proc.process_number || doProcesso[0].cnj);
        }

        // Reaproveita o classificador do Escavador: mesma categoria, mesmo
        // hash de dedupe. Movimento sem data no corpo (EPROC) herda a do e-mail.
        const classificadas = classifyUpdates(
          doProcesso.map((m) => ({
            conteudo: m.texto,
            data: m.data || dataEmail,
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

        // Push agrupado (bloco "Eventos:"): o e-mail inteiro é UMA movimentação
        // com os eventos junto. Aí o título deixa de ser o rótulo genérico da
        // categoria ("Movimentação") e passa a ser o evento que diz alguma
        // coisa — é o que a equipe lê antes de abrir o card.
        const agrupado = doProcesso.length === 1 && (doProcesso[0].eventos?.length || 0) > 0
          ? doProcesso[0]
          : null;

        const linhas = classificadas.map((u) => ({
          process_id: proc.id,
          lead_id: proc.lead_id,
          case_id: proc.case_id,
          numero_cnj: proc.process_number,
          processo_titulo: proc.title || proc.leads?.lead_name || proc.process_number,
          esfera,
          origem: 'email_push',
          categoria: u.categoria,
          titulo: agrupado?.titulo || u.titulo,
          descricao: u.descricao,
          data_movimentacao: u.data_movimentacao,
          conteudo_hash: u.conteudo_hash,
          eventos: agrupado?.eventos || null,
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
          movimentacoes: movs.length, casados,
        }, { onConflict: 'message_id' });
      }
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
