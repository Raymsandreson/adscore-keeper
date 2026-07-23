import { useState, lazy, Suspense } from 'react';
import { useCall } from '@/contexts/CallContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useProfilesList } from '@/hooks/useProfilesList';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/functionRouter';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Sparkles, ChevronDown, ChevronUp, Plus, Phone } from 'lucide-react';
import { toast } from 'sonner';
import type { ActivityDraft } from '@/components/activities/ActivityFullSheet';

const ActivityFullSheet = lazy(() =>
  import('@/components/activities/ActivityFullSheet').then((m) => ({ default: m.ActivityFullSheet })),
);

interface SuggestedActivity {
  title?: string;
  activity_type?: string;
  priority?: string;
  deadline?: string;
  lead_name?: string;
  assignee_name?: string;
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  notes?: string;
}

type Phase = 'ask' | 'processing' | 'result';

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Aparece depois de encerrar uma ligação gravada. Pergunta se quer transcrever;
 * ao confirmar, sobe o áudio, chama a IA e mostra resumo + transcrição + as
 * atividades sugeridas, cada uma cadastrável no formulário único (ActivityFullSheet).
 */
export function CallSummaryDialog() {
  const { pendingRecording, clearPendingRecording } = useCall();
  const { user } = useAuthContext();
  const { types } = useActivityTypes();
  const profiles = useProfilesList();

  const [phase, setPhase] = useState<Phase>('ask');
  const [summary, setSummary] = useState('');
  const [transcript, setTranscript] = useState('');
  const [activities, setActivities] = useState<SuggestedActivity[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);

  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const rec = pendingRecording;

  const reset = () => {
    setPhase('ask');
    setSummary('');
    setTranscript('');
    setActivities([]);
    setShowTranscript(false);
    clearPendingRecording();
  };

  const handleTranscribe = async () => {
    if (!rec) return;
    setPhase('processing');
    try {
      // 1) sobe o áudio pro bucket (mesmo usado pelos áudios do chat da equipe)
      const path = `${user?.id || 'anon'}/call_${Date.now()}.webm`;
      const { error: upErr } = await supabase.storage
        .from('team-chat-media')
        .upload(path, rec.blob, { contentType: rec.blob.type || 'audio/webm' });
      if (upErr) throw new Error('Falha ao enviar o áudio: ' + upErr.message);

      const { data: urlData } = supabase.storage.from('team-chat-media').getPublicUrl(path);
      const audioUrl = urlData?.publicUrl;
      if (!audioUrl) throw new Error('Não foi possível obter a URL do áudio.');

      // 2) transcreve + resume + propõe atividades (Railway)
      const memberNames = profiles.map((p) => p.full_name).filter(Boolean) as string[];
      const { data, error } = await cloudFunctions.invoke('call-to-activities', {
        body: {
          audio_url: audioUrl,
          activity_types: types.filter((t) => t.is_active).map((t) => ({ key: t.key, label: t.label })),
          member_names: memberNames,
          other_party: rec.remoteName,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao processar a ligação.');

      setSummary(data.summary || '');
      setTranscript(data.transcript || '');
      setActivities(Array.isArray(data.activities) ? data.activities : []);
      setPhase('result');
    } catch (e: any) {
      console.error('[CallSummaryDialog] erro:', e);
      toast.error(e?.message || 'Não foi possível processar a ligação.');
      setPhase('ask');
    }
  };

  const openActivity = (a: SuggestedActivity) => {
    const assignee = a.assignee_name
      ? profiles.find((p) => (p.full_name || '').trim().toLowerCase() === String(a.assignee_name).trim().toLowerCase())
      : null;
    const originNote = `— Origem: ligação com ${rec?.remoteName || 'colega'} (equipe) —${transcript ? `\n${transcript}` : ''}`;
    setDraft({
      title: a.title || '',
      activity_type: a.activity_type || '',
      priority: a.priority || 'normal',
      deadline: a.deadline || undefined,
      lead_name: a.lead_name || undefined,
      assigned_to: assignee?.user_id || undefined,
      assigned_to_name: assignee?.full_name || undefined,
      what_was_done: a.what_was_done || '',
      current_status_notes: a.current_status || '',
      next_steps: a.next_steps || '',
      notes: [a.notes || '', originNote].filter(Boolean).join('\n\n'),
    });
    setSheetOpen(true);
  };

  if (!rec) {
    // Mantém o sheet montado enquanto ele fecha, mas sem gravação pendente não há dialog.
    return sheetOpen && draft ? (
      <Suspense fallback={null}>
        <ActivityFullSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          activityId={null}
          mode="create"
          draft={draft}
          onCreated={() => { setSheetOpen(false); toast.success('Atividade cadastrada'); }}
        />
      </Suspense>
    ) : null;
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) reset(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-green-600" />
              Ligação com {rec.remoteName}
            </DialogTitle>
            <DialogDescription>
              Duração {fmtDur(rec.durationSec)}. {phase === 'ask' && 'Quer transcrever e resumir esta conversa?'}
            </DialogDescription>
          </DialogHeader>

          {phase === 'ask' && (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={reset}>Descartar</Button>
              <Button onClick={handleTranscribe} className="gap-1.5">
                <Sparkles className="h-4 w-4" /> Transcrever e resumir
              </Button>
            </DialogFooter>
          )}

          {phase === 'processing' && (
            <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Transcrevendo e resumindo a ligação…</p>
            </div>
          )}

          {phase === 'result' && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {summary && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Resumo</p>
                  <p className="text-sm whitespace-pre-wrap">{summary}</p>
                </div>
              )}

              {transcript && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowTranscript((v) => !v)}
                    className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {showTranscript ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Transcrição completa
                  </button>
                  {showTranscript && (
                    <p className="text-xs whitespace-pre-wrap mt-1 text-muted-foreground border rounded-md p-2 bg-muted/30">
                      {transcript}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Atividades sugeridas {activities.length > 0 ? `(${activities.length})` : ''}
                </p>
                {activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma atividade proposta a partir desta ligação.</p>
                ) : (
                  <div className="space-y-2">
                    {activities.map((a, i) => (
                      <div key={i} className="border rounded-lg p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{a.title || 'Atividade'}</p>
                          {a.next_steps && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.next_steps}</p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-1 text-[10px] text-muted-foreground">
                            {a.assignee_name && <span className="rounded bg-muted px-1.5 py-0.5">👤 {a.assignee_name}</span>}
                            {a.deadline && <span className="rounded bg-muted px-1.5 py-0.5">📅 {a.deadline}</span>}
                            {a.priority && a.priority !== 'normal' && (
                              <span className="rounded bg-muted px-1.5 py-0.5">⚑ {a.priority}</span>
                            )}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => openActivity(a)}>
                          <Plus className="h-3.5 w-3.5" /> Cadastrar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={reset}>Fechar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {sheetOpen && draft && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            activityId={null}
            mode="create"
            draft={draft}
            onCreated={() => { setSheetOpen(false); toast.success('Atividade cadastrada'); }}
          />
        </Suspense>
      )}
    </>
  );
}
