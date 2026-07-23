import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Sparkles, Loader2, Flag, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/functionRouter';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { startOfDay, startOfWeek, startOfMonth } from 'date-fns';

// "Mensagem pra todos" — dispara, de uma vez, a mensagem coach personalizada
// de cada assessor do ranking de um time. Reusa o Railway `performance-coach`:
// `analyze` (1 por pessoa, em paralelo limitado) monta as mensagens; `send`
// (1 por pessoa) posta no chat interno e/ou WhatsApp. O gestor revisa/edita
// cada mensagem e escolhe os canais antes de disparar. Nada é enviado sozinho.

export type BroadcastPeriod = 'hoje' | 'semana' | 'mes';

interface Props {
  teamId: string | null;   // null quando grupo === 'gerencial' ou "todos os times"
  grupo: string | null;    // 'gerencial' | null
  teamName: string;
  period: BroadcastPeriod;
  onClose: () => void;
}

type RowStatus = 'generating' | 'ready' | 'error' | 'sending' | 'sent' | 'failed';

interface PersonRow {
  nome: string;
  position: number;
  passos: number;
  concluidas: number;
  atrasadas: number;
  mensagem: string;
  toUserId: string | null;
  hasWhatsapp: boolean;
  include: boolean;
  status: RowStatus;
  error?: string;
}

interface RankRow {
  nome: string;
  passos: number;
  concluidas: number;
  atrasadas: number;
}
interface AnalyzeResponse {
  success: boolean;
  position: number;
  total: number;
  mensagem: string;
  to_user_id: string | null;
  has_whatsapp?: boolean;
  error?: string;
}
interface SendResponse {
  success: boolean;
  results?: {
    chat?: { ok: boolean; error?: string };
    whatsapp?: { ok: boolean; error?: string };
  };
  error?: string;
}

function periodSince(p: BroadcastPeriod): Date {
  const now = new Date();
  if (p === 'hoje') return startOfDay(now);
  if (p === 'mes') return startOfMonth(now);
  return startOfWeek(now, { weekStartsOn: 1 });
}
const periodLabelPt: Record<BroadcastPeriod, string> = { hoje: 'hoje', semana: 'semana', mes: 'mês' };

/** Roda `worker` sobre `items` com no máximo `limit` em paralelo. */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

export default function TeamBroadcastDialog({ teamId, grupo, teamName, period, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [viaChat, setViaChat] = useState(true);
  const [viaWhatsapp, setViaWhatsapp] = useState(false);
  const [sending, setSending] = useState(false);
  const [sender, setSender] = useState<{ id: string; name: string } | null>(null);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const sinceIso = periodSince(period).toISOString();
  const startedRef = useRef(false);

  // Remetente (quem aprova/dispara) — precisa estar logado no Cloud.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const { data: profile } = await supabase
        .from('profiles').select('full_name').eq('user_id', session.user.id).maybeSingle();
      setSender({ id: session.user.id, name: profile?.full_name || session.user.email || 'Gestor' });
    })();
  }, []);

  const patch = useCallback((nome: string, upd: Partial<PersonRow>) => {
    setRows((rs) => rs.map((r) => (r.nome === nome ? { ...r, ...upd } : r)));
  }, []);

  const generateOne = useCallback(async (nome: string) => {
    patch(nome, { status: 'generating', error: undefined });
    try {
      const { data, error } = await cloudFunctions.invoke<AnalyzeResponse>('performance-coach', {
        body: {
          nome,
          p_since: sinceIso,
          p_team_id: teamId,
          p_grupo: grupo,
          period_label: periodLabelPt[period],
        },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Falha ao gerar');
      patch(nome, {
        status: 'ready',
        mensagem: data.mensagem,
        toUserId: data.to_user_id,
        hasWhatsapp: !!data.has_whatsapp,
        // Sem perfil resolvido → não dá pra enviar; sai do disparo por padrão.
        include: data.to_user_id ? true : false,
        error: data.to_user_id ? undefined : 'sem perfil pra enviar',
      });
    } catch (e) {
      patch(nome, { status: 'error', include: false, error: e instanceof Error ? e.message : 'Falha ao gerar' });
    }
  }, [patch, sinceIso, teamId, grupo, period]);

  // Carrega o ranking do time e gera a mensagem de cada pessoa (paralelo ≤3).
  const loadAndGenerate = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setDoneAt(null);
    try {
      await ensureExternalSession();
      const { data: payload, error } = await (externalSupabase as any).rpc('tv_atividades_ranking', {
        p_since: sinceIso,
        p_team_id: teamId,
        p_grupo: grupo,
      });
      if (error) throw error;
      const ranking: RankRow[] = payload?.ranking || [];
      if (!ranking.length) {
        setRows([]);
        setLoadError('Sem atividades no período pra esse time.');
        return;
      }
      const initial: PersonRow[] = ranking.map((r, i) => ({
        nome: r.nome,
        position: i + 1,
        passos: r.passos,
        concluidas: r.concluidas,
        atrasadas: r.atrasadas,
        mensagem: '',
        toUserId: null,
        hasWhatsapp: false,
        include: true,
        status: 'generating',
      }));
      setRows(initial);
      setLoading(false);
      await mapLimit(ranking.map((r) => r.nome), 3, (nome) => generateOne(nome));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Falha ao carregar o ranking');
    } finally {
      setLoading(false);
    }
  }, [sinceIso, teamId, grupo, generateOne]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    loadAndGenerate();
  }, [loadAndGenerate]);

  const selectable = rows.filter((r) => r.toUserId && r.status !== 'sent');
  const selectedCount = rows.filter((r) => r.include && r.toUserId).length;
  const anyGenerating = rows.some((r) => r.status === 'generating');
  const noChannel = !viaChat && !viaWhatsapp;

  const sendAll = async () => {
    if (!sender || sending || noChannel) return;
    const targets = rows.filter((r) => r.include && r.toUserId && r.mensagem.trim() && r.status !== 'sent');
    if (!targets.length) return;
    setSending(true);
    try {
      await mapLimit(targets, 3, async (r) => {
        patch(r.nome, { status: 'sending', error: undefined });
        try {
          const { data, error } = await cloudFunctions.invoke<SendResponse>('performance-coach', {
            body: {
              mode: 'send',
              to_user_id: r.toUserId,
              message: r.mensagem.trim(),
              sender_id: sender.id,
              sender_name: sender.name,
              via_chat: viaChat,
              // Só manda no WhatsApp de quem tem número.
              via_whatsapp: viaWhatsapp && r.hasWhatsapp,
            },
          });
          if (error || !data) throw new Error(error?.message || 'Falha ao enviar');
          const res = data.results || {};
          const fails: string[] = [];
          if (res.chat && !res.chat.ok) fails.push(`chat: ${res.chat.error || 'falhou'}`);
          if (res.whatsapp && !res.whatsapp.ok) fails.push(`WhatsApp: ${res.whatsapp.error || 'falhou'}`);
          if (fails.length && !(res.chat?.ok || res.whatsapp?.ok)) throw new Error(fails.join(' · '));
          if (data.success === false && !fails.length) throw new Error(data.error || 'Falha ao enviar');
          patch(r.nome, { status: 'sent', error: fails.length ? `parcial — ${fails.join(' · ')}` : undefined });
        } catch (e) {
          patch(r.nome, { status: 'failed', error: e instanceof Error ? e.message : 'Falha ao enviar' });
        }
      });
      setDoneAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setSending(false);
    }
  };

  const sentCount = rows.filter((r) => r.status === 'sent').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;

  const overlay = (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-slate-900/95 px-5 py-4">
          <Flag className="h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">🏁 Mensagem pra todos — {teamName}</div>
            <div className="text-xs text-white/50">
              Coach personalizado por pessoa · ranking de {periodLabelPt[period]} · revise antes de disparar
            </div>
          </div>
          <button onClick={loadAndGenerate} disabled={loading || anyGenerating || sending}
            className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white transition disabled:opacity-40" title="Regenerar tudo">
            <RefreshCw className={cn('h-5 w-5', (loading || anyGenerating) && 'animate-spin')} />
          </button>
          <button onClick={onClose} className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white transition" title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-white/60">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando o ranking de {teamName}…
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{loadError}</div>
          ) : (
            rows.map((r) => (
              <div key={r.nome} className={cn(
                'rounded-xl border p-3 transition',
                r.include ? 'border-amber-400/25 bg-amber-400/[0.05]' : 'border-white/10 bg-white/[0.03] opacity-70',
              )}>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={r.include}
                      disabled={!r.toUserId || r.status === 'generating' || r.status === 'sent'}
                      onChange={(e) => patch(r.nome, { include: e.target.checked })}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span className="text-xs font-black tabular-nums text-white/40">{r.position}º</span>
                    <span className="truncate font-bold text-sm">{r.nome}</span>
                    <span className="hidden sm:inline text-[11px] text-white/40 shrink-0">
                      {r.passos}p · {r.concluidas}c · {r.atrasadas}atr
                    </span>
                  </label>
                  <StatusPill row={r} />
                </div>

                {r.status === 'generating' ? (
                  <div className="mt-2 flex items-center gap-2 px-1 py-3 text-xs text-white/50">
                    <Loader2 className="h-4 w-4 animate-spin" /> gerando mensagem…
                  </div>
                ) : r.status === 'error' ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    <span>{r.error || 'falha ao gerar'}</span>
                    <button onClick={() => generateOne(r.nome)} className="font-bold underline hover:text-rose-200">tentar de novo</button>
                  </div>
                ) : (
                  <textarea
                    value={r.mensagem}
                    onChange={(e) => patch(r.nome, { mensagem: e.target.value })}
                    disabled={r.status === 'sending' || r.status === 'sent'}
                    rows={5}
                    className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-slate-950/60 p-2.5 text-xs leading-relaxed outline-none focus:border-amber-400/50 disabled:opacity-60"
                  />
                )}
                {(r.status === 'failed' || (r.status === 'sent' && r.error)) && (
                  <div className={cn('mt-1.5 text-[11px]', r.status === 'failed' ? 'text-rose-300' : 'text-amber-300')}>
                    {r.status === 'failed' ? '⚠ ' : ''}{r.error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Rodapé — canais + disparo */}
        {!loading && !loadError && (
          <div className="border-t border-white/10 bg-slate-900/95 px-5 py-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={viaChat} onChange={(e) => setViaChat(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                💬 Chat interno
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={viaWhatsapp} onChange={(e) => setViaWhatsapp(e.target.checked)} className="h-4 w-4 accent-emerald-400" />
                📱 WhatsApp <span className="text-[10px] text-white/40">(só quem tem número)</span>
              </label>
              <div className="ml-auto text-[11px] text-white/50">
                {doneAt
                  ? <span className="text-emerald-400 font-bold">✅ {sentCount} enviada(s){failedCount ? ` · ${failedCount} falha(s)` : ''} às {doneAt}</span>
                  : !sender ? 'Entre no sistema pra disparar'
                    : `${selectedCount} selecionada(s) de ${selectable.length}`}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-bold text-white/60 transition hover:text-white">
                Fechar
              </button>
              <button
                onClick={sendAll}
                disabled={!sender || sending || anyGenerating || noChannel || selectedCount === 0}
                className="flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-slate-900 transition hover:bg-amber-300 disabled:opacity-40"
                title={noChannel ? 'Escolha ao menos um canal' : undefined}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? 'Enviando…' : `Enviar pra ${selectedCount || 'todos'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function StatusPill({ row }: { row: PersonRow }) {
  if (row.status === 'sent') {
    return <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Enviada</span>;
  }
  if (row.status === 'sending') {
    return <span className="flex shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-400"><Loader2 className="h-3 w-3 animate-spin" /> Enviando</span>;
  }
  if (row.status === 'failed') {
    return <span className="flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black text-rose-400"><AlertTriangle className="h-3 w-3" /> Falhou</span>;
  }
  if (!row.toUserId && row.status === 'ready') {
    return <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/40">sem perfil</span>;
  }
  if (row.status === 'ready') {
    return <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-black text-amber-400"><Sparkles className="h-3 w-3" /> Pronta</span>;
  }
  return null;
}
