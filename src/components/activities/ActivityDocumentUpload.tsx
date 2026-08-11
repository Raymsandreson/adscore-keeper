import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Upload, Loader2, Sparkles, Info, RotateCcw, X, ImagePlus } from 'lucide-react';
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
  /** Classe CSS adicional para o botão trigger (ex: sr-only quando controlado por menu pai). */
  triggerClassName?: string;
}

type Phase = 'idle' | 'uploading' | 'processing' | 'done';

// Formatos de imagem que o Gemini lê nativamente (espelha GEMINI_IMAGE_MIMES no backend).
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'];
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'log'];
const ACCEPTED = '.pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp,image/heic,image/heif';
const MAX_MB = 15;
const MAX_FILES = 6;

function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}
function isImageFile(f: File): boolean {
  return (f.type || '').toLowerCase().startsWith('image/') || IMAGE_EXT.includes(extOf(f.name));
}
function isSupportedFile(f: File): boolean {
  const t = (f.type || '').toLowerCase();
  const e = extOf(f.name);
  if (t === 'application/pdf' || e === 'pdf') return true;
  if (t.startsWith('text/') || TEXT_EXT.includes(e)) return true;
  // Imagem: só os formatos que o Gemini lê (evita subir um BMP/GIF que o backend recusa).
  if (t.startsWith('image/')) return IMAGE_EXT.includes(t.split('/')[1] || '');
  return IMAGE_EXT.includes(e);
}
function attachmentTypeOf(f: File): string {
  if (isImageFile(f)) return 'image';
  const t = (f.type || '').toLowerCase();
  if (t === 'application/pdf' || extOf(f.name) === 'pdf') return 'document';
  return 'text';
}

// Campos de texto (detalhe) + metadados extraídos pela IA. Espelha o áudio
// (ActivityCallRecorder): o documento agora também preenche título, prazo,
// notificação, prioridade, situação, tipo e assessor(es) quando o documento os traz.
const TEXT_KEYS = ['what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes'] as const;
const META_KEYS = ['title', 'deadline', 'notification_date', 'priority', 'status', 'assessor_name', 'activity_type'] as const;

function buildAppliedFields(raw: any): ActivityCallFields {
  const applied: ActivityCallFields = {};
  for (const k of TEXT_KEYS) { const v = raw?.[k]; if (v && String(v).trim()) (applied as any)[k] = String(v).trim(); }
  for (const k of META_KEYS) { const v = raw?.[k]; if (v && String(v).trim()) (applied as any)[k] = String(v).trim(); }
  const assessors = Array.isArray(raw?.assessor_names)
    ? raw.assessor_names.map((n: unknown) => String(n || '').trim()).filter(Boolean)
    : [];
  if (assessors.length > 0) applied.assessor_names = assessors;
  return applied;
}

export function ActivityDocumentUpload({ context, onFields, activityId, leadId, caseId, processId, open: openProp, onOpenChange, triggerClassName }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [phase, setPhase] = useState<Phase>('idle');
  const [pastedText, setPastedText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  // Resposta do usuário à pergunta de esclarecimento da IA (enviada como contexto extra,
  // sem substituir o documento/texto original).
  const [answerText, setAnswerText] = useState('');
  // Guarda a fonte usada na 1ª extração para reaproveitar no "Reenviar com a resposta".
  const lastSourceRef = useRef<{ file_url?: string; file_urls?: string[]; text?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Miniaturas das imagens escolhidas (print colado/arrastado) — revogadas ao trocar a lista.
  // HEIC/HEIF ficam sem thumb: o Chrome não renderiza (o Gemini lê normalmente).
  const thumbs = useMemo(
    () => files.map((f) => (isImageFile(f) && !['heic', 'heif'].includes(extOf(f.name)) ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(() => () => { thumbs.forEach((u) => u && URL.revokeObjectURL(u)); }, [thumbs]);

  const reset = useCallback(() => {
    setPhase('idle');
    setPastedText('');
    setFiles([]);
    setDragOver(false);
    setError(null);
    setPreview(null);
    setQuestion(null);
    setAnswerText('');
    lastSourceRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    const accepted: File[] = [];
    let tooBig = 0;
    let unsupported = 0;
    for (const f of incoming) {
      if (!isSupportedFile(f)) { unsupported++; continue; }
      if (f.size > MAX_MB * 1024 * 1024) { tooBig++; continue; }
      accepted.push(f);
    }
    if (unsupported > 0) toast.error('Formato não suportado. Envie PDF, imagem (print), TXT ou MD.');
    if (tooBig > 0) toast.error(`${tooBig} arquivo(s) acima de ${MAX_MB}MB foram ignorados.`);
    if (accepted.length === 0) return;
    if (files.length + accepted.length > MAX_FILES) toast.error(`Máximo de ${MAX_FILES} arquivos por envio.`);
    setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES));
  }, [files.length]);

  // Ctrl+V com imagem no clipboard (print de publicação, comprovante do Meu INSS…).
  // Escuta no documento porque o Popover é renderizado em portal e o foco pode
  // estar fora do textarea. Só intercepta quando há ARQUIVO no clipboard —
  // colar texto continua caindo normalmente no campo "Colar texto".
  useEffect(() => {
    if (!open || phase !== 'idle') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const dropped: File[] = [];
      for (const it of items) {
        if (it.kind !== 'file') continue;
        const f = it.getAsFile();
        if (f) dropped.push(f);
      }
      if (dropped.length === 0) return;
      e.preventDefault();
      addFiles(dropped);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, phase, addFiles]);

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
    setQuestion(null);

    // Modo "responder pergunta": reaproveita a fonte da 1ª extração e manda só a resposta.
    const isAnswering = !!(question && answerText.trim() && lastSourceRef.current);
    if (isAnswering) {
      setPhase('processing');
      try {
        const { previousActivities, chatMessages } = await collectExtraContext();
        const fullContext = { ...context, previous_activities: previousActivities, chat_messages: chatMessages };
        const body: any = { activity_context: fullContext, user_answer: answerText.trim(), ...lastSourceRef.current };
        const { data, error: fnErr } = await cloudFunctions.invoke('extract-activity-from-document', { body });
        if (fnErr) throw fnErr;
        if (!data?.success) throw new Error(data?.error || 'Falha ao processar o documento');
        setPreview(data.extracted_text || null);
        setQuestion(data.clarifying_question || null);
        const applied = buildAppliedFields(data.fields || {});
        onFields(applied);
        setPhase('done');
        if (data.clarifying_question) toast.info('A IA ainda tem uma dúvida — veja no painel.', { duration: 5000 });
        else { setAnswerText(''); toast.success('Campos atualizados com sua resposta — revise antes de salvar.'); }
      } catch (e: any) {
        console.error('[ActivityDocumentUpload] answer error:', e);
        setError(e?.message || 'Erro ao reenviar a resposta');
        setPhase('done');
        toast.error(e?.message || 'Erro ao reenviar a resposta');
      }
      return;
    }

    const hasFiles = files.length > 0;
    const hasText = pastedText.trim().length > 0;
    if (!hasFiles && !hasText) {
      toast.error('Anexe, arraste ou cole (Ctrl+V) um arquivo — ou cole um texto.');
      return;
    }

    try {
      const fileUrls: string[] = [];

      // 1) Sobe os arquivos pro bucket activity-chat (o mesmo usado pelo áudio).
      if (hasFiles) {
        setPhase('uploading');
        const { data: { user } } = await supabase.auth.getUser();
        const extUserId = await remapToExternal(user?.id || null);
        const stamp = Date.now();
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const ext = extOf(f.name) || (isImageFile(f) ? 'png' : 'bin');
          const path = `activity-documents/doc_${stamp}_${i}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('activity-chat')
            .upload(path, f, { contentType: f.type || undefined });
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from('activity-chat').getPublicUrl(path);
          fileUrls.push(urlData.publicUrl);

          // Guarda como anexo da atividade (rastreabilidade).
          if (activityId) {
            try {
              await externalSupabase.from('activity_attachments').insert({
                activity_id: activityId,
                file_url: urlData.publicUrl,
                file_name: f.name,
                file_type: f.type || `application/${ext}`,
                attachment_type: attachmentTypeOf(f),
                created_by: extUserId,
              });
            } catch (attErr) {
              console.warn('[ActivityDocumentUpload] não foi possível anexar:', attErr);
            }
          }
        }
      }

      // 2) Contexto extra + chamada da edge Railway.
      setPhase('processing');
      const { previousActivities, chatMessages } = await collectExtraContext();
      const fullContext = { ...context, previous_activities: previousActivities, chat_messages: chatMessages };

      // Arquivo(s) e texto convivem: o print/PDF é a fonte principal e o texto colado
      // entra como complemento. `file_url` segue junto por compatibilidade.
      const source: { file_url?: string; file_urls?: string[]; text?: string } = {};
      if (fileUrls.length > 0) { source.file_urls = fileUrls; source.file_url = fileUrls[0]; }
      if (hasText) source.text = pastedText.trim();

      const body: any = { activity_context: fullContext, ...source };
      // Guarda a fonte para reaproveitar caso a IA faça uma pergunta e o usuário responda.
      lastSourceRef.current = source;

      const { data, error: fnErr } = await cloudFunctions.invoke('extract-activity-from-document', { body });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao processar o documento');

      setPreview(data.extracted_text || null);
      setQuestion(data.clarifying_question || null);

      const applied = buildAppliedFields(data.fields || {});
      onFields(applied);

      setPhase('done');
      const count = Object.keys(applied).length;
      if (data.clarifying_question) {
        toast.info('A IA tem uma pergunta antes de concluir — veja no painel.', { duration: 5000 });
      } else {
        toast.success(
          count > 0
            ? `IA preencheu ${count} campo(s) com base no documento — revise antes de salvar.`
            : 'Documento lido, mas a IA não identificou campos para preencher.'
        );
      }
    } catch (e: any) {
      console.error('[ActivityDocumentUpload] error:', e);
      setError(e?.message || 'Erro ao processar o documento');
      setPhase('done');
      toast.error(e?.message || 'Erro ao processar o documento');
    }
  }, [files, pastedText, activityId, collectExtraContext, context, onFields, question, answerText]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o && phase === 'done') reset(); }}>
      <PopoverTrigger asChild className={triggerClassName}>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-blue-700 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/20"
          title="Anexe um PDF, print/imagem ou cole um texto para a IA extrair e preencher os campos automaticamente"
        >
          <FileText className="h-3 w-3" /> Preenchimento por Documento
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 p-3 space-y-3"
        onDragOver={(e) => { if (phase !== 'idle') return; e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (phase !== 'idle') return;
          const dropped = Array.from(e.dataTransfer?.files || []);
          if (dropped.length > 0) addFiles(dropped);
        }}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold">Preenchimento por Documento</span>
        </div>

        {phase === 'idle' && (
          <>
            <div className="flex items-start gap-1.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 p-2">
              <Info className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
              <span className="text-[11px] text-blue-700 dark:text-blue-300">
                Anexe, <strong>arraste</strong> ou <strong>cole (Ctrl+V)</strong> um <strong>PDF</strong> ou <strong>print/imagem</strong>
                {' '}(publicação, despacho, laudo, e-mail, comprovante do INSS) — ou cole um <strong>texto</strong>.
                A IA lê, entende e preenche os campos da atividade sozinha. Comprovantes do Meu INSS
                (protocolo, agendamento de perícia/avaliação social, exigência) preenchem no modelo padrão da equipe.
              </span>
            </div>

            {/* Upload / arrastar / colar */}
            <div
              className={`space-y-1.5 rounded-md border border-dashed p-2 transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-border'
              }`}
            >
              <label className="text-[11px] font-medium text-muted-foreground">
                Anexar arquivos (PDF, imagem, TXT, MD) — arraste aqui ou cole com Ctrl+V
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    if (picked.length > 0) addFiles(picked);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={files.length >= MAX_FILES}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {files.length > 0 ? 'Adicionar mais' : 'Escolher arquivo'}
                </Button>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ImagePlus className="h-3 w-3" />
                  {files.length > 0 ? `${files.length}/${MAX_FILES} arquivo(s)` : `até ${MAX_FILES} arquivos, ${MAX_MB}MB cada`}
                </span>
              </div>

              {files.length > 0 && (
                <div className="space-y-1 pt-1">
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-1.5 min-w-0 text-[11px]">
                      {thumbs[i] ? (
                        <img src={thumbs[i] as string} alt={f.name} className="h-7 w-7 rounded border object-cover shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate flex-1" title={f.name}>{f.name}</span>
                      <span className="text-muted-foreground shrink-0">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title="Remover"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">e/ou</span>
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
              />
              {files.length > 0 && (
                <p className="text-[10px] text-muted-foreground">O texto entra como complemento dos arquivos anexados.</p>
              )}
            </div>

            <Button
              className="w-full gap-2"
              size="sm"
              onClick={process}
              disabled={files.length === 0 && !pastedText.trim()}
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
            ) : !question ? (
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                <Sparkles className="h-3.5 w-3.5" /> Campos preenchidos — revise antes de salvar.
              </div>
            ) : null}
            {question && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 p-2.5 space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-800 dark:text-amber-200">
                    <strong>A IA precisa de um esclarecimento:</strong>
                    <p className="mt-0.5">{question}</p>
                  </div>
                </div>
                <Textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Responda aqui (ou cole mais contexto) e clique em Reenviar…"
                  className="min-h-[60px] text-xs"
                />
                <Button size="sm" className="w-full gap-2" onClick={process} disabled={!answerText.trim()}>
                  <Sparkles className="h-3.5 w-3.5" /> Reenviar com a resposta
                </Button>
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
