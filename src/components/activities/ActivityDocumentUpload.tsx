import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Upload, Loader2, Sparkles, Info, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/functionRouter';
import {
  callFieldTextToHtml,
  stripHtmlToText,
  type ActivityCallContext,
  type ActivityCallFields,
} from './ActivityCallRecorder';

interface Props {
  context: ActivityCallContext;
  onFields: (fields: ActivityCallFields) => void;
  activityId?: string | null;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
  /** Controle externo de abertura (ex: dropdown menu pai). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type Phase = 'idle' | 'uploading' | 'processing' | 'done';

const ACCEPTED = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown';
const MAX_MB = 15;

export function ActivityDocumentUpload({ context, onFields, activityId, leadId, caseId, processId, open: openProp, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [phase, setPhase] = useState<Phase>('idle');
  const [pastedText, setPastedText] = useState('');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setPastedText('');
    setPickedFile(null);
    setError(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const collectExtraContext = useCallback(async () => {
    // Mesma coleta de contexto usada em ActivityCallRecorder (previous_activities + chat).
    let previousActivities: any[] = [];
    let chatMessages: any[] = [];
    try {
      if (processId || caseId || leadId) {
        let q = externalSupabase
          .from('lead_activities')
          .select('id, title, activity_type, status, what_was_done, current_status_notes, next_steps, deadline, created_at')
          .order('created_at', { ascending: false })
          .limit(8);
        if (processId) q = q.eq('process_id', processId);
        else if (caseId) q = q.eq('case_id', caseId);
        else q = q.eq('lead_id', leadId as string);
        if (activityId) q = q.neq('id', activityId);
        const { data: acts } = await q;
        previousActivities = (acts || []).map((a: any) => ({
          title: a.title,
          status: a.status,
          type: a.activity_type,
          what_was_done: stripHtmlToText(a.what_was_done || ''),
          current_status: stripHtmlToText(a.current_status_notes || ''),
          next_steps: stripHtmlToText(a.next_steps || ''),
          date: a.created_at ? String(a.created_at).slice(0, 10) : undefined,
        }));
      }
      if (activityId) {
        const { data: msgs } = await externalSupabase
          .from('activity_chat_messages')
          .select('content, sender_name, message_type, created_at')
          .eq('activity_id', activityId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(40);
        chatMessages = (msgs || [])
          .filter((m: any) => m.message_type !== 'ai_suggestion')
          .map((m: any) => ({
            sender: m.sender_name,
            type: m.message_type,
            content: stripHtmlToText(m.content || ''),
            date: m.created_at ? String(m.created_at).slice(0, 16).replace('T', ' ') : undefined,
          }));
      }
    } catch (ctxErr) {
      console.warn('[ActivityDocumentUpload] contexto extra falhou:', ctxErr);
    }
    return { previousActivities, chatMessages };
  }, [activityId, leadId, caseId, processId]);

  const process = useCallback(async () => {
    setError(null);
    setPreview(null);

    const hasFile = !!pickedFile;
    const hasText = pastedText.trim().length > 0;
    if (!hasFile && !hasText) {
      toast.error('Anexe um arquivo ou cole um texto.');
      return;
    }
    if (hasFile && pickedFile!.size > MAX_MB * 1024 * 1024) {
      toast.error(`Arquivo maior que ${MAX_MB}MB.`);
      return;
    }

    try {
      let file_url: string | undefined;
      let mime: string | undefined;

      // 1) Se houver arquivo, sobe pro bucket activity-chat (reaproveita o mesmo do áudio).
      if (hasFile) {
        setPhase('uploading');
        const ext = (pickedFile!.name.split('.').pop() || 'bin').toLowerCase();
        const path = `activity-documents/doc_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('activity-chat')
          .upload(path, pickedFile!, { contentType: pickedFile!.type || undefined });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('activity-chat').getPublicUrl(path);
        file_url = urlData.publicUrl;
        mime = pickedFile!.type || undefined;

        // Guarda como anexo da atividade (rastreabilidade).
        if (activityId) {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            const extUserId = await remapToExternal(user?.id || null);
            await externalSupabase.from('activity_attachments').insert({
              activity_id: activityId,
              file_url,
              file_name: pickedFile!.name,
              file_type: mime || `application/${ext}`,
              attachment_type: mime === 'application/pdf' ? 'document' : 'text',
              created_by: extUserId,
            });
          } catch (attErr) {
            console.warn('[ActivityDocumentUpload] não foi possível anexar:', attErr);
          }
        }
      }

      // 2) Contexto extra + chamada da edge Railway.
      setPhase('processing');
      const { previousActivities, chatMessages } = await collectExtraContext();
      const fullContext = { ...context, previous_activities: previousActivities, chat_messages: chatMessages };

      const body: any = { activity_context: fullContext };
      if (file_url) body.file_url = file_url;
      else body.text = pastedText.trim();

      const { data, error: fnErr } = await cloudFunctions.invoke('extract-activity-from-document', { body });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao processar o documento');

      setPreview(data.extracted_text || null);

      const raw = data.fields || {};
      const applied: ActivityCallFields = {};
      const keys: (keyof ActivityCallFields)[] = ['what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes'];
      for (const k of keys) {
        const v = raw[k];
        if (v && String(v).trim()) applied[k] = String(v).trim();
      }
      onFields(applied);

      setPhase('done');
      const count = Object.keys(applied).length;
      toast.success(
        count > 0
          ? `IA preencheu ${count} campo(s) com base no documento — revise antes de salvar.`
          : 'Documento lido, mas a IA não identificou campos para preencher.'
      );
    } catch (e: any) {
      console.error('[ActivityDocumentUpload] error:', e);
      setError(e?.message || 'Erro ao processar o documento');
      setPhase('done');
      toast.error(e?.message || 'Erro ao processar o documento');
    }
  }, [pickedFile, pastedText, activityId, collectExtraContext, context, onFields]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o && phase === 'done') reset(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-blue-700 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/20"
          title="Anexe um PDF ou cole um texto para a IA extrair e preencher os campos automaticamente"
        >
          <FileText className="h-3 w-3" /> Preenchimento por Documento
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold">Preenchimento por Documento</span>
        </div>

        {phase === 'idle' && (
          <>
            <div className="flex items-start gap-1.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 p-2">
              <Info className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
              <span className="text-[11px] text-blue-700 dark:text-blue-300">
                Anexe um <strong>PDF</strong> (publicação, despacho, laudo, e-mail) ou cole um <strong>texto</strong>.
                A IA lê, entende e preenche os campos da atividade sozinha.
              </span>
            </div>

            {/* Upload de arquivo */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Anexar arquivo (PDF, TXT, MD)</label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    if (f && f.size > MAX_MB * 1024 * 1024) {
                      toast.error(`Arquivo maior que ${MAX_MB}MB.`);
                      return;
                    }
                    setPickedFile(f);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {pickedFile ? 'Trocar arquivo' : 'Escolher arquivo'}
                </Button>
                {pickedFile && (
                  <div className="flex items-center gap-1 min-w-0 flex-1 text-[11px]">
                    <span className="truncate" title={pickedFile.name}>{pickedFile.name}</span>
                    <button
                      type="button"
                      onClick={() => { setPickedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">ou</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Colar texto */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Colar texto</label>
              <Textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Cole aqui o texto da publicação, despacho, e-mail, ata…"
                className="min-h-[100px] text-xs"
                disabled={!!pickedFile}
              />
              {pickedFile && (
                <p className="text-[10px] text-muted-foreground">Texto ignorado enquanto houver arquivo anexado.</p>
              )}
            </div>

            <Button
              className="w-full gap-2"
              size="sm"
              onClick={process}
              disabled={!pickedFile && !pastedText.trim()}
            >
              <Sparkles className="h-4 w-4" /> Extrair e preencher
            </Button>
          </>
        )}

        {(phase === 'uploading' || phase === 'processing') && (
          <div className="flex flex-col items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{phase === 'uploading' ? 'Enviando arquivo…' : 'Lendo e preenchendo os campos…'}</span>
          </div>
        )}

        {phase === 'done' && (
          <>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                <Sparkles className="h-3.5 w-3.5" /> Campos preenchidos — revise antes de salvar.
              </div>
            )}
            {preview && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Trecho do documento processado:</p>
                <ScrollArea className="max-h-40 rounded border p-2">
                  <p className="text-xs whitespace-pre-wrap">{preview}</p>
                </ScrollArea>
              </div>
            )}
            <Button variant="outline" className="w-full gap-2" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Enviar outro
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
