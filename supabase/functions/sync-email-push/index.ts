// =============================================================================
// Push dos tribunais por E-MAIL → feed do sino → reabertura seletiva do Escavador.
//
// POR QUE EXISTE (decisão do Raym, 11/08/2026):
//   A captura do Escavador custa R$ 0,20 por processo — R$ 65,80 a varredura
//   completa dos 329 — e por isso a rotina jm_esc_rotina nasceu SEM cron de
//   reabertura: reconsultar todo mundo todo dia daria ~R$ 1.974/mês.
//   Só que os tribunais já avisam de graça, em minutos, QUAIS processos
//   mexeram: são ~200 e-mails de push em 20 dias na caixa processual@.
//   Então o e-mail passa a ser o gatilho — o Escavador só é reaberto para os
//   processos que tiveram push no dia. A conta cai de "todos os 329" para
//   "os que mexeram", que é a diferença entre R$ 65,80 e alguns centavos.
//
// O QUE ESTA FUNÇÃO FAZ, NESTA ORDEM:
//   1. lê os e-mails novos de remetentes .jus.br (Gmail API, escopo readonly);
//   2. extrai as movimentações (emailPushParser: PJe, EPROC e e-SAJ);
//   3. casa o CNJ com lead_processes e grava no feed do sino (process_updates)
//      — de graça e na hora, sem depender de nenhuma API paga;
//   4. reabre no Escavador SÓ esses processos, para vir o detalhe/documentos.
//
// PRIVACIDADE: a consulta ao Gmail é restrita a remetentes .jus.br e a função
// só lê o corpo de mensagem que casa com essa busca. E-mail pessoal, cliente e
// financeiro nunca é aberto — e o parser descarta o que não tem número CNJ.
//
// Modos:
//   { dias?: 2, limite?: 100, dry_run?: false }
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

// Só remetentes de tribunal. É o que limita o que esta função enxerga da caixa.
const QUERY_BASE = 'from:jus.br';

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

async function accessTokenDaConta(refresh: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  return data.access_token || null;
}

/** Corpo em texto do e-mail: o Gmail devolve base64url, às vezes só em HTML. */
function corpoDoEmail(payload: unknown): string {
  const partes: string[] = [];
  const decodifica = (b64: string) => {
    try {
      const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  };
  const anda = (p: Record<string, any>) => {
    if (!p) return;
    const mime = String(p.mimeType || '');
    const dados = p.body?.data;
    if (dados && mime.startsWith('text/')) {
      const texto = decodifica(dados);
      partes.push(mime === 'text/html' ? htmlParaTexto(texto) : texto);
    }
    for (const filho of (p.parts || [])) anda(filho);
  };
  anda(payload as Record<string, any>);
  // text/plain primeiro: o HTML do e-SAJ vira um texto muito mais sujo.
  return partes.sort((a, b) => a.length - b.length).join('\n');
}

function htmlParaTexto(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(tr|p|div|li|table)\s*>/gi, '\n')
    .replace(/<\/\s*td\s*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n');
}

interface Resultado {
  contas: number;
  emails_lidos: number;
  emails_com_processo: number;
  movimentacoes: number;
  feed_inserido: number;
  processos_casados: number;
  cnjs_sem_cadastro: string[];
  reabertos_escavador: number;
  erros: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const out: Resultado = {
    contas: 0, emails_lidos: 0, emails_com_processo: 0, movimentacoes: 0,
    feed_inserido: 0, processos_casados: 0, cnjs_sem_cadastro: [],
    reabertos_escavador: 0, erros: [],
  };

  try {
    const body = await req.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body.dias) || 2, 1), 30);
    const limite = Math.min(Number(body.limite) || 100, 300);
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

    const { data: contas, error: errContas } = await ext
      .from('google_oauth_tokens')
      .select('user_id, refresh_token, scope')
      .not('refresh_token', 'is', null);
    if (errContas) throw errContas;

    const semCadastro = new Set<string>();
    const cnjsParaReabrir = new Set<string>();

    for (const conta of (contas || []) as Array<{ user_id: string; refresh_token: string; scope: string | null }>) {
      // Conta conectada antes do escopo do Gmail existir: ignora em silêncio —
      // ela continua servindo agenda e contatos.
      if (conta.scope && !conta.scope.includes('gmail')) continue;
      const token = await accessTokenDaConta(conta.refresh_token);
      if (!token) { out.erros.push(`token não renovou (user ${conta.user_id})`); continue; }
      out.contas++;

      const q = encodeURIComponent(`${QUERY_BASE} newer_than:${dias}d`);
      const lista = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limite}&q=${q}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then((r) => r.json()).catch(() => ({}));

      if (lista.error) {
        // 403 = escopo gmail.readonly não concedido nessa conta.
        out.erros.push(`gmail: ${lista.error.message || 'erro'}`);
        continue;
      }

      const ids: string[] = (lista.messages || []).map((m: { id: string }) => m.id);
      if (ids.length === 0) continue;

      // Já processados em execução anterior — a fila do Gmail não some sozinha.
      const { data: jaVistos } = await ext
        .from('email_push_processados')
        .select('message_id')
        .in('message_id', ids);
      const vistos = new Set((jaVistos || []).map((r: { message_id: string }) => r.message_id));

      for (const id of ids) {
        if (vistos.has(id)) continue;
        out.emails_lidos++;

        const msg = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } },
        ).then((r) => r.json()).catch(() => null);
        if (!msg || msg.error) { out.erros.push(`mensagem ${id} não lida`); continue; }

        const headers = (msg.payload?.headers || []) as Array<{ name: string; value: string }>;
        const cab = (nome: string) => headers.find((h) => h.name.toLowerCase() === nome)?.value || '';
        const assunto = cab('subject');
        const remetente = cab('from');
        const dataEmail = new Date(Number(msg.internalDate || Date.now())).toISOString().slice(0, 10);

        const movs: MovimentacaoEmail[] = parseEmailPush({ assunto, corpo: corpoDoEmail(msg.payload) });
        if (movs.length === 0) {
          if (!dryRun) {
            await ext.from('email_push_processados').upsert({
              message_id: id, assunto, remetente, movimentacoes: 0, casados: 0,
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
          cnjsParaReabrir.add(proc.process_number || doProcesso[0].cnj);

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

          const linhas = classificadas.map((u) => ({
            process_id: proc.id,
            lead_id: proc.lead_id,
            case_id: proc.case_id,
            numero_cnj: proc.process_number,
            processo_titulo: proc.title || proc.leads?.lead_name || proc.process_number,
            esfera,
            origem: 'email_push',
            categoria: u.categoria,
            titulo: u.titulo,
            descricao: u.descricao,
            data_movimentacao: u.data_movimentacao,
            conteudo_hash: u.conteudo_hash,
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
            message_id: id, assunto, remetente, movimentacoes: movs.length, casados,
          }, { onConflict: 'message_id' });
        }
      }
    }

    // A reabertura é o único ponto que GASTA. Fica por último e só com o que
    // realmente casou com processo cadastrado.
    if (!dryRun && cnjsParaReabrir.size > 0) {
      const { data, error } = await ext.rpc('jm_esc_reabrir_por_cnj', {
        p_cnjs: [...cnjsParaReabrir],
      });
      if (error) out.erros.push(`reabertura: ${error.message}`);
      else out.reabertos_escavador = Number(data) || 0;
    }

    out.cnjs_sem_cadastro = [...semCadastro].slice(0, 50);

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
