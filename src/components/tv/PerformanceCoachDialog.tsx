import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Send, Sparkles, Flag, Loader2, MessageCircleQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/functionRouter';
import { supabase } from '@/integrations/supabase/client';

// Coach de desempenho do telão /tv/atividades.
// Abre ao clicar num assessor do ranking: o diretor pergunta "por quê?",
// a IA analisa os dados (via performance-coach no Railway) e sugere uma
// mensagem estilo Corrida Maluca 🏁 que só é enviada no chat interno
// depois que o diretor aprovar (e estiver logado — o telão pode rodar anônimo).

interface CoachRow {
  nome: string;
  passos: number;
  concluidas: number;
  atrasadas: number;
  aprov_pct: number | null;
  chat_resp_seg: number | null;
  ativo_seg: number;
  ocioso_seg: number;
}

interface QA {
  question: string;
  answer: string;
}

interface Props {
  row: CoachRow;
  rank: number;
  since: string; // ISO do início do período (mesmo p_since da RPC)
  teamId: string | null;
  grupo: string | null;
  periodLabel: string;
  onClose: () => void;
}

interface AnalyzeResponse {
  success: boolean;
  position: number;
  total: number;
  ahead: { nome: string; passos: number } | null;
  behind: { nome: string; passos: number } | null;
  analise: string;
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

export default function PerformanceCoachDialog({ row, rank, since, teamId, grupo, periodLabel, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QA[]>([]);
  const [mensagem, setMensagem] = useState('');
  const [mensagemEdited, setMensagemEdited] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [hasWhatsapp, setHasWhatsapp] = useState(false);
  const [viaChat, setViaChat] = useState(true);
  const [viaWhatsapp, setViaWhatsapp] = useState(false);
  const [meta, setMeta] = useState<{ position: number; total: number; ahead: AnalyzeResponse['ahead']; behind: AnalyzeResponse['behind'] } | null>(null);
  const [question, setQuestion] = useState('');
  const [sender, setSender] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const mensagemEditedRef = useRef(false);
  mensagemEditedRef.current = mensagemEdited;

  // Sessão do Cloud (quem aprova/envia). Telão pode estar deslogado.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const { data: profile } = await supabase
        .from('profiles').select('full_name').eq('user_id', session.user.id).maybeSingle();
      setSender({ id: session.user.id, name: profile?.full_name || session.user.email || 'Diretoria' });
    })();
  }, []);

  const analyze = useCallback(async (q?: string) => {
    setError(null);
    const { data, error: err } = await cloudFunctions.invoke<AnalyzeResponse>('performance-coach', {
      body: {
        nome: row.nome,
        p_since: since,
        p_team_id: teamId,
        p_grupo: grupo,
        period_label: periodLabel,
        question: q || undefined,
      },
    });
    if (err || !data?.success) {
      throw new Error(data?.error || err?.message || 'Falha na análise');
    }
    setMeta({ position: data.position, total: data.total, ahead: data.ahead, behind: data.behind });
    setToUserId(data.to_user_id);
    setHasWhatsapp(!!data.has_whatsapp);
    setHistory((h) => [...h, {
      question: q || `Por que ${row.nome.split(' ')[0]} está com esse desempenho?`,
      answer: data.analise,
    }]);
    // Não sobrescreve mensagem que o diretor já editou na mão.
    if (!mensagemEditedRef.current) setMensagem(data.mensagem);
  }, [row.nome, since, teamId, grupo, periodLabel]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { await analyze(); } catch (e) {
        setError(e instanceof Error ? e.message : 'Falha na análise');
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setQuestion('');
    try { await analyze(q); } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na análise');
    } finally { setAsking(false); }
  };

  const sendMessage = async () => {
    if (!sender || !toUserId || !mensagem.trim() || sending || (!viaChat && !viaWhatsapp)) return;
    setSending(true);
    setError(null);
    try {
      const { data, error: err } = await cloudFunctions.invoke<SendResponse>('performance-coach', {
        body: {
          mode: 'send',
          to_user_id: toUserId,
          message: mensagem.trim(),
          sender_id: sender.id,
          sender_name: sender.name,
          via_chat: viaChat,
          via_whatsapp: viaWhatsapp,
        },
      });
      if (err || !data) throw new Error(err?.message || 'Falha ao enviar');
      const r = data.results || {};
      const fails: string[] = [];
      if (r.chat && !r.chat.ok) fails.push(`chat: ${r.chat.error || 'falhou'}`);
      if (r.whatsapp && !r.whatsapp.ok) fails.push(`WhatsApp: ${r.whatsapp.error || 'falhou'}`);
      if (fails.length) {
        const okChannels = [r.chat?.ok && 'chat interno', r.whatsapp?.ok && 'WhatsApp'].filter(Boolean);
        throw new Error(
          (okChannels.length ? `Enviado no ${okChannels.join(' e ')}, mas ` : '') + fails.join(' · ')
        );
      }
      setSentAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar');
    } finally {
      setSending(false);
    }
  };

  const sendDisabledReason = !sender
    ? 'Entre no sistema pra enviar (telão está sem login)'
    : !toUserId
      ? 'Não achei o perfil dessa pessoa pra enviar no chat'
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <Flag className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">{row.nome}</div>
            <div className="text-xs text-white/50">
              {meta ? `${meta.position}º de ${meta.total} na corrida` : `${rank}º no ranking`} · {row.passos} passos ·{' '}
              <span className="text-emerald-400">{row.concluidas} concl.</span> ·{' '}
              <span className="text-rose-400">{row.atrasadas} atras.</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white transition" title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-white/60">
              <Loader2 className="h-5 w-5 animate-spin" />
              Analisando os dados de {row.nome.split(' ')[0]}…
            </div>
          ) : (
            <>
              {/* Análises (pergunta → resposta) */}
              {history.map((qa, i) => (
                <div key={i} className="rounded-xl bg-white/[0.04] border border-white/5 p-4">
                  <div className="flex items-start gap-2 text-xs font-semibold text-sky-400">
                    <MessageCircleQuestion className="h-4 w-4 shrink-0 mt-0.5" />
                    {qa.question}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-white/85 whitespace-pre-wrap">{qa.answer}</p>
                </div>
              ))}

              {/* Pergunta livre */}
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
                  placeholder="Pergunte… ex.: por que ela tá com tanto tempo ocioso?"
                  className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none placeholder:text-white/30 focus:border-sky-400/50"
                />
                <button
                  onClick={ask}
                  disabled={!question.trim() || asking}
                  className="rounded-full bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400 disabled:opacity-40"
                >
                  {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Perguntar'}
                </button>
              </div>

              {/* Mensagem sugerida (Corrida Maluca) */}
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-400">
                  <Sparkles className="h-4 w-4" />
                  Mensagem sugerida — 🏁 Corrida da {periodLabel}
                </div>
                <textarea
                  value={mensagem}
                  onChange={(e) => { setMensagem(e.target.value); setMensagemEdited(true); }}
                  rows={6}
                  className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-slate-950/60 p-3 text-sm leading-relaxed outline-none focus:border-amber-400/50"
                />
                {/* Canais de envio */}
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={viaChat}
                      onChange={(e) => setViaChat(e.target.checked)}
                      className="h-4 w-4 accent-amber-400"
                    />
                    💬 Chat interno
                  </label>
                  <label className={cn('flex items-center gap-2', hasWhatsapp ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed')}>
                    <input
                      type="checkbox"
                      checked={viaWhatsapp}
                      disabled={!hasWhatsapp}
                      onChange={(e) => setViaWhatsapp(e.target.checked)}
                      className="h-4 w-4 accent-emerald-400"
                    />
                    📱 WhatsApp {!hasWhatsapp && <span className="text-[10px] text-white/40">(sem número no perfil)</span>}
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-white/40">
                    {sentAt
                      ? `✅ Enviado às ${sentAt}`
                      : sendDisabledReason
                        || (!viaChat && !viaWhatsapp
                          ? 'Escolha ao menos um canal'
                          : `Vai pro ${[viaChat && 'privado do chat interno', viaWhatsapp && 'WhatsApp'].filter(Boolean).join(' e ')} de ${row.nome.split(' ')[0]}, em seu nome`)}
                  </span>
                  <button
                    onClick={sendMessage}
                    disabled={!!sendDisabledReason || !mensagem.trim() || sending || !!sentAt || (!viaChat && !viaWhatsapp)}
                    className={cn(
                      'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition',
                      sentAt
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-400 text-slate-900 hover:bg-amber-300 disabled:opacity-40'
                    )}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {sentAt ? 'Enviado' : 'Aprovar e enviar'}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
