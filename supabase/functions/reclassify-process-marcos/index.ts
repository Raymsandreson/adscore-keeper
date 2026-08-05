// =============================================================================
// Reclassifica marcos já gravados usando IA (ver _shared/marcosIA.ts pro
// diagnóstico que motivou isto). Roda no Supabase EXTERNO.
//
// mode 'dry_run' (padrão) — NÃO escreve nada. Devolve a matriz
//        "tipo atual → tipo da IA" com contagem e amostras, pra revisão humana.
// mode 'apply'            — exige confirm:"RECLASSIFICAR". Só aplica troca de
//        um marco por OUTRO marco. Marco que a IA diz não existir ('nenhum')
//        é apenas REPORTADO: process_movements é append-only e não há coluna de
//        descarte hoje — remover exige decisão + migration, não pode sair daqui.
//
// Cada linha alterada carimba metadata com procedência (classificador, modelo,
// tipo anterior, confiança, motivo), porque hoje metadata está 100% nulo nas
// 799 linhas e não dá pra auditar nenhuma classificação passada.
//
// Paginação por limit/offset: 8 movimentações por chamada ao Gemini, ~2-4s cada.
// Uma invocação não dá conta das 600+ linhas dentro do tempo da edge.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";
import {
  classificarMarcosIA,
  movParaClassificar,
  type MarcoIAResultado,
  type MovParaClassificar,
} from "../_shared/marcosIA.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LIMITE_MAXIMO = 200;

/** true só para service_role — anon/usuário comum não passa. Esta função
 *  escreve em dado de cliente e gasta token de IA: não pode ser pública. */
function isServiceRole(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    );
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

interface Corpo {
  mode?: 'dry_run' | 'apply';
  limit?: number;
  offset?: number;
  confirm?: string;
  /** Restringe a um tipo atual (ex.: só auditar acordao_2grau). */
  tipo?: string;
  model?: string;
}

interface LinhaMarco {
  id: string;
  process_id: string;
  tipo_movimentacao: string;
  escavador_movimentacao_id: string | null;
  descricao: string | null;
  metadata: Record<string, unknown> | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const presented = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!isServiceRole(presented)) {
      return json({ success: false, error: 'forbidden: service role required' }, 403);
    }

    const corpo: Corpo = await req.json().catch(() => ({}));
    const mode = corpo.mode ?? 'dry_run';
    const limit = Math.min(Math.max(corpo.limit ?? 40, 1), LIMITE_MAXIMO);
    const offset = Math.max(corpo.offset ?? 0, 0);

    if (mode === 'apply' && corpo.confirm !== 'RECLASSIFICAR') {
      return json({
        success: false,
        error: 'apply reescreve marcos de processo de cliente — envie confirm: "RECLASSIFICAR"',
      }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Só as linhas que passaram pelo classificador de texto. As de
    // 'escavador_compromissos'/'escavador_audiencias' vêm do detector de
    // compromissos, não têm esse defeito e ficam de fora.
    let q = supabase
      .from('process_movements')
      .select('id, process_id, tipo_movimentacao, escavador_movimentacao_id, descricao, metadata')
      .eq('fonte', 'escavador')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (corpo.tipo) q = q.eq('tipo_movimentacao', corpo.tipo);

    const { data: linhas, error: qErr } = await q;
    if (qErr) throw qErr;
    if (!linhas?.length) {
      return json({ success: true, mode, lidas: 0, proximo_offset: null, matriz: [], amostras: [] });
    }

    // Texto cru das movimentações dos processos envolvidos. A `descricao` salva
    // em process_movements é truncada em 500 chars e NÃO guarda a
    // classificacao_predita — classificar por ela repetiria o erro original.
    const processIds = [...new Set((linhas as LinhaMarco[]).map((l) => l.process_id))];
    const { data: procs, error: pErr } = await supabase
      .from('lead_processes')
      .select('id, movimentacoes')
      .in('id', processIds);
    if (pErr) throw pErr;

    const movsPorProcesso = new Map<string, Map<string, Record<string, unknown>>>();
    for (const p of procs ?? []) {
      const mapa = new Map<string, Record<string, unknown>>();
      const arr = Array.isArray(p.movimentacoes) ? p.movimentacoes : [];
      for (const m of arr as Record<string, unknown>[]) {
        const mid = m?.id != null ? String(m.id) : null;
        if (mid) mapa.set(mid, m);
      }
      movsPorProcesso.set(p.id, mapa);
    }

    const entradas: MovParaClassificar[] = [];
    const porRef = new Map<string, LinhaMarco>();
    let semJsonb = 0;

    for (const l of linhas as LinhaMarco[]) {
      const mov = l.escavador_movimentacao_id
        ? movsPorProcesso.get(l.process_id)?.get(l.escavador_movimentacao_id)
        : undefined;
      if (!mov) { semJsonb++; continue; } // sem o texto cru não dá pra reclassificar com honestidade
      entradas.push(movParaClassificar(l.id, mov as never));
      porRef.set(l.id, l);
    }

    const resultados = await classificarMarcosIA(entradas, {
      chat: geminiChat as never,
      model: corpo.model,
    });

    // Matriz "tipo atual → tipo da IA" + amostras pra revisão humana.
    const matriz = new Map<string, number>();
    const amostras: Array<Record<string, unknown>> = [];
    const paraTrocar: Array<{ linha: LinhaMarco; ia: MarcoIAResultado }> = [];
    let concordam = 0;
    let semResposta = 0;
    let viraNenhum = 0;

    for (const [ref, linha] of porRef) {
      const ia = resultados.get(ref);
      if (!ia) { semResposta++; continue; }

      const chave = `${linha.tipo_movimentacao} → ${ia.tipo}`;
      matriz.set(chave, (matriz.get(chave) ?? 0) + 1);

      if (ia.tipo === linha.tipo_movimentacao) { concordam++; continue; }

      if (amostras.length < 40) {
        amostras.push({
          atual: linha.tipo_movimentacao,
          ia: ia.tipo,
          confianca: ia.confianca,
          motivo: ia.motivo,
          trecho: (linha.descricao || '').slice(0, 100),
        });
      }

      if (ia.tipo === 'nenhum') { viraNenhum++; continue; }
      paraTrocar.push({ linha, ia });
    }

    let atualizadas = 0;
    const erros: string[] = [];

    if (mode === 'apply') {
      for (const { linha, ia } of paraTrocar) {
        // marco_ordem NÃO é setado aqui de propósito: o trigger
        // trg_process_movements_marco_ordem dispara em UPDATE OF
        // tipo_movimentacao e recarimba pela marco_ordem_canonica().
        const { error: uErr } = await supabase
          .from('process_movements')
          .update({
            tipo_movimentacao: ia.tipo,
            metadata: {
              ...(linha.metadata ?? {}),
              classificador: 'ia',
              modelo: corpo.model || 'google/gemini-2.5-flash',
              tipo_anterior: linha.tipo_movimentacao,
              confianca: ia.confianca,
              motivo: ia.motivo,
              reclassificado_em: new Date().toISOString(),
            },
          })
          .eq('id', linha.id);
        if (uErr) { erros.push(`${linha.id}: ${uErr.message}`); continue; }
        atualizadas++;
      }
    }

    return json({
      success: true,
      mode,
      lidas: linhas.length,
      classificadas: porRef.size,
      sem_jsonb: semJsonb,
      sem_resposta_da_ia: semResposta,
      concordam,
      divergem: porRef.size - concordam - semResposta,
      vira_nenhum: viraNenhum,
      atualizadas,
      nao_aplicado_vira_nenhum: mode === 'apply' ? viraNenhum : 0,
      matriz: [...matriz.entries()]
        .map(([k, n]) => ({ transicao: k, n }))
        .sort((a, b) => b.n - a.n),
      amostras,
      erros,
      proximo_offset: linhas.length === limit ? offset + limit : null,
    });
  } catch (e) {
    console.error('reclassify-process-marcos:', e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
