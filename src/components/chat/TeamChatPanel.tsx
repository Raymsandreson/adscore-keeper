import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTeamChat, useTeamMembers, TeamMember } from '@/hooks/useTeamChat';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Loader2, AtSign, Users, Paperclip, Mic, Square, AlertTriangle, Play, Pause, FileText, Image as ImageIcon, Sparkles, Bell, BellRing } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { TeamChatEntityMention, renderMessageWithMentions, EntityMention, EntityMentionType } from './TeamChatEntityMention';

interface TeamChatPanelProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  highlightMessageId?: string | null;
}

const MEDIA_BUCKET = 'team-chat-media';

/** Bip curto (Web Audio) para avisar chegada de mensagem urgente. */
function playUrgentBeep() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    /* silêncio se o navegador bloquear áudio */
  }
}

function formatDuration(seconds?: number | null) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export function TeamChatPanel({ entityType, entityId, entityName, highlightMessageId }: TeamChatPanelProps) {
  const { user } = useAuthContext();
  const { messages, loading, sendMessage, updateMessage } = useTeamChat(entityType, entityId, entityName);
  const members = useTeamMembers();
  const navigate = useNavigate();
  const push = usePushNotifications();
  const draftKey = `team-chat-draft-${entityType}-${entityId}`;
  const [inputText, setInputText] = useState(() => sessionStorage.getItem(draftKey) || '');
  const [sending, setSending] = useState(false);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  // Recursos ricos (paridade com o chat direto).
  const [urgent, setUrgent] = useState(false);
  const [showEntityMention, setShowEntityMention] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingDurationRef = useRef(0);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const beepedRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  // Auto-scroll to bottom or highlighted message
  useEffect(() => {
    if (highlightMessageId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, highlightMessageId]);

  // Bip ao receber mensagem urgente de outro membro (ignora o carregamento inicial).
  useEffect(() => {
    if (loading) return;
    if (firstLoadRef.current) {
      messages.forEach(m => beepedRef.current.add(m.id));
      firstLoadRef.current = false;
      return;
    }
    for (const m of messages) {
      if (beepedRef.current.has(m.id)) continue;
      beepedRef.current.add(m.id);
      if (m.is_urgent && m.sender_id !== user?.id && !m.deleted_at) {
        playUrgentBeep();
      }
    }
  }, [messages, loading, user?.id]);

  const filteredMembers = useMemo(() => {
    if (!mentionFilter) return members.filter(m => m.user_id !== user?.id);
    const lower = mentionFilter.toLowerCase();
    return members.filter(m =>
      m.user_id !== user?.id &&
      (m.full_name?.toLowerCase().includes(lower) || m.email?.toLowerCase().includes(lower))
    );
  }, [members, mentionFilter, user?.id]);

  const handleInputChange = (value: string) => {
    setInputText(value);
    sessionStorage.setItem(draftKey, value);

    const cursorPos = inputRef.current?.selectionStart || value.length;
    let atIdx = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (value[i] === '@') { atIdx = i; break; }
    }

    if (atIdx >= 0) {
      const afterAt = value.slice(atIdx + 1, cursorPos);
      if (afterAt.length < 40) {
        setShowMentionList(true);
        setMentionFilter(afterAt);
        setMentionStartIndex(atIdx);
        return;
      }
    }
    setShowMentionList(false);
    setMentionFilter('');
    setMentionStartIndex(-1);
  };

  const insertMention = (member: TeamMember) => {
    const name = member.full_name || member.email || 'usuário';
    const before = inputText.slice(0, mentionStartIndex);
    const after = inputText.slice(inputRef.current?.selectionStart || inputText.length);
    setInputText(`${before}@${name} ${after}`);
    setShowMentionList(false);
    setMentionFilter('');
    setMentionStartIndex(-1);
    if (!selectedMentions.includes(member.user_id)) {
      setSelectedMentions(prev => [...prev, member.user_id]);
    }
    inputRef.current?.focus();
  };

  const collectMentionedIds = useCallback((text: string) => {
    const mentionedIds = [...selectedMentions];
    for (const member of members) {
      if (mentionedIds.includes(member.user_id)) continue;
      const name = member.full_name || member.email;
      if (name && text.toLowerCase().includes(`@${name.toLowerCase()}`)) {
        mentionedIds.push(member.user_id);
      }
    }
    return mentionedIds;
  }, [members, selectedMentions]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    const mentionedIds = collectMentionedIds(text);
    await sendMessage(text, mentionedIds, urgent ? { is_urgent: true } : undefined);
    setInputText('');
    sessionStorage.removeItem(draftKey);
    setSelectedMentions([]);
    setUrgent(false);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ---- Anexo (arquivo/imagem) ----
  const uploadAndSendFile = useCallback(async (file: File) => {
    if (!user?.id) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máx. 20MB)');
      return;
    }
    setUploading(true);
    try {
      const path = `${user.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
      const isImage = file.type.startsWith('image/');
      await sendMessage(isImage ? '📷 Imagem' : `📎 ${file.name}`, [], {
        message_type: isImage ? 'image' : 'file',
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
      });
    } catch {
      toast.error('Erro ao enviar arquivo');
    } finally {
      setUploading(false);
    }
  }, [user?.id, sendMessage]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadAndSendFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadAndSendFile]);

  // ---- Áudio (grava, envia e transcreve automaticamente) ----
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const duration = recordingDurationRef.current;
        setIsRecording(false);
        setRecordingDuration(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (blob.size === 0) { toast.error('Nenhum áudio capturado'); return; }

        setUploading(true);
        try {
          const fileName = `audio_${Date.now()}.webm`;
          const path = `${user?.id}/${fileName}`;
          const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob);
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
          const created = await sendMessage('🎤 Áudio', [], {
            message_type: 'audio',
            file_url: urlData.publicUrl,
            file_name: fileName,
            file_size: blob.size,
            file_type: 'audio/webm',
            audio_duration: duration,
          });
          // Transcrição automática (best-effort — não bloqueia o envio)
          if (created?.id) {
            try {
              const { data } = await cloudFunctions.invoke('analyze-activity-chat', {
                body: {
                  mode: 'describe_file',
                  context: { file_url: urlData.publicUrl, file_type: 'audio', file_name: fileName, audio_duration: duration },
                },
              });
              if (data?.description) {
                await updateMessage(created.id, { transcription: data.description });
              }
            } catch { /* transcrição é best-effort */ }
          }
        } catch {
          toast.error('Erro ao enviar áudio');
        } finally {
          setUploading(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      recordingDurationRef.current = 0;
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        recordingDurationRef.current += 1;
        setRecordingDuration(recordingDurationRef.current);
      }, 1000);
    } catch {
      toast.error('Permissão de microfone negada');
    }
  }, [user?.id, sendMessage, updateMessage]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const toggleAudio = useCallback((msgId: string, url: string) => {
    const existing = audioElementsRef.current.get(msgId);
    if (existing) {
      if (playingAudioId === msgId) { existing.pause(); setPlayingAudioId(null); }
      else { existing.play(); setPlayingAudioId(msgId); }
      return;
    }
    const audio = new Audio(url);
    audio.onended = () => setPlayingAudioId(null);
    audioElementsRef.current.set(msgId, audio);
    audio.play();
    setPlayingAudioId(msgId);
  }, [playingAudioId]);

  // ---- Menção de entidade (lead/contato/atv) ----
  const handleEntitySelect = useCallback((entity: EntityMention) => {
    const mention = `[${entity.type}:${entity.id}:${entity.name}]`;
    setInputText(prev => {
      const next = `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${mention} `;
      sessionStorage.setItem(draftKey, next);
      return next;
    });
    inputRef.current?.focus();
  }, [draftKey]);

  const handleMentionNavigate = useCallback((type: EntityMentionType, id: string) => {
    if (type === 'lead') navigate(`/leads?openLead=${id}`);
    else if (type === 'activity') navigate(`/?openActivity=${id}`);
    else navigate(`/leads?openContact=${id}`);
  }, [navigate]);

  // Transforma URLs http(s) em links clicáveis dentro de um trecho de texto.
  const linkify = (text: string, keyBase: string) => {
    const urlRe = /(https?:\/\/[^\s]+)/g;
    const out: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = urlRe.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const href = m[1];
      out.push(
        <a
          key={`${keyBase}-l${k++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {href}
        </a>
      );
      last = m.index + m[1].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length ? out : text;
  };

  // Realça @nome de membros e deixa URLs clicáveis dentro de um trecho de texto.
  const renderMemberMentions = (content: string, isMe: boolean) => {
    const memberNames = members
      .map(m => m.full_name || m.email)
      .filter(Boolean)
      .sort((a, b) => b!.length - a!.length);
    if (memberNames.length === 0) return <>{linkify(content, 'lo')}</>;
    const escaped = memberNames.map(n => n!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(@(?:${escaped.join('|')}))`, 'gi');
    const parts = content.split(pattern);
    return (
      <>
        {parts.map((part, i) =>
          part.startsWith('@') ? (
            <span key={i} className={cn('font-semibold', isMe ? 'text-primary-foreground/90 underline' : 'text-primary')}>{part}</span>
          ) : (
            <span key={i}>{linkify(part, `m${i}`)}</span>
          )
        )}
      </>
    );
  };

  // Combina menção de entidade ([type:id:name]) + menção de membro (@nome).
  const renderContent = (content: string, isMe: boolean) => {
    const entityParts = renderMessageWithMentions(content, handleMentionNavigate);
    if (Array.isArray(entityParts)) {
      return entityParts.map((part, i) =>
        typeof part === 'string' ? <span key={i}>{renderMemberMentions(part, isMe)}</span> : part
      );
    }
    return renderMemberMentions(content, isMe);
  };

  const renderAttachment = (msg: typeof messages[number], isMe: boolean) => {
    if (msg.message_type === 'audio' && msg.file_url) {
      return (
        <div className="space-y-1">
          <button
            onClick={() => toggleAudio(msg.id, msg.file_url!)}
            className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs', isMe ? 'bg-primary-foreground/15' : 'bg-background/60')}
          >
            {playingAudioId === msg.id ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <Mic className="h-3.5 w-3.5" />
            <span>{formatDuration(msg.audio_duration)}</span>
          </button>
          {msg.transcription ? (
            <div className={cn('flex items-start gap-1 text-[11px] italic', isMe ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{msg.transcription}</span>
            </div>
          ) : (
            <div className={cn('text-[10px] italic', isMe ? 'text-primary-foreground/50' : 'text-muted-foreground/60')}>transcrevendo…</div>
          )}
        </div>
      );
    }
    if (msg.message_type === 'image' && msg.file_url) {
      return (
        <a href={msg.file_url} target="_blank" rel="noopener noreferrer">
          <img src={msg.file_url} alt={msg.file_name || 'imagem'} className="max-h-48 rounded-lg object-cover" />
        </a>
      );
    }
    if (msg.message_type === 'file' && msg.file_url) {
      return (
        <a
          href={msg.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs underline', isMe ? 'bg-primary-foreground/15' : 'bg-background/60')}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[180px]">{msg.file_name || 'Arquivo'}</span>
        </a>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAttachment = (t?: string | null) => t === 'audio' || t === 'image' || t === 'file';

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs text-center gap-2">
            <Users className="h-8 w-8 opacity-30" />
            <p>Nenhuma mensagem da equipe.<br/>Use <span className="font-medium text-primary">@nome</span> para mencionar alguém.</p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.sender_id === user?.id;
            const isHighlighted = msg.id === highlightMessageId;
            return (
              <div
                key={msg.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={cn('flex', isMe ? 'justify-end' : 'justify-start')}
              >
                <div className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                  isMe ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted rounded-bl-md',
                  isHighlighted && 'ring-2 ring-yellow-400 animate-pulse',
                  msg.is_urgent && 'ring-2 ring-destructive/70'
                )}>
                  {!isMe && (
                    <div className="text-[10px] font-semibold mb-0.5 opacity-70">
                      {msg.sender_name || 'Usuário'}
                    </div>
                  )}
                  {msg.is_urgent && (
                    <div className={cn('flex items-center gap-1 text-[10px] font-bold mb-0.5', isMe ? 'text-primary-foreground' : 'text-destructive')}>
                      <AlertTriangle className="h-3 w-3" /> URGENTE
                    </div>
                  )}
                  {hasAttachment(msg.message_type) ? (
                    renderAttachment(msg, isMe)
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-[13px]">
                      {renderContent(msg.content, isMe)}
                    </p>
                  )}
                  <div className={cn('text-[9px] mt-0.5', isMe ? 'text-primary-foreground/60 text-right' : 'text-muted-foreground')}>
                    {format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Mention dropdown (membros) */}
      {showMentionList && filteredMembers.length > 0 && (
        <div className="mx-3 mb-1 border rounded-lg bg-card shadow-lg max-h-32 overflow-y-auto">
          {filteredMembers.slice(0, 6).map(member => (
            <button
              key={member.user_id}
              onClick={() => insertMention(member)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors text-left"
            >
              <AtSign className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{member.full_name || 'Sem nome'}</div>
                <div className="text-[10px] text-muted-foreground truncate">{member.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input + ações ricas */}
      <div className="shrink-0 border-t bg-muted/30">
        {isRecording && (
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-destructive">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" /> Gravando… {formatDuration(recordingDuration)}
            </span>
            <button onClick={stopRecording} className="font-medium underline">Parar e enviar</button>
          </div>
        )}
        <div className="relative px-3 py-2 flex items-center gap-1.5">
          {/* Picker de menção de entidade (abre acima do input) */}
          <TeamChatEntityMention
            open={showEntityMention}
            onClose={() => setShowEntityMention(false)}
            onSelect={handleEntitySelect}
          />

          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
          {push.supported && push.permission !== 'granted' && (
            <Button
              type="button" size="icon" variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              title="Ativar notificações no celular/notebook (mesmo com a aba fechada)"
              disabled={push.busy}
              onClick={push.enable}
            >
              {push.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            </Button>
          )}
          {push.supported && push.permission === 'granted' && push.subscribed && (
            <span className="shrink-0 text-emerald-600" title="Notificações ativas neste dispositivo">
              <BellRing className="h-4 w-4" />
            </span>
          )}
          <Button
            type="button" size="icon" variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title="Mencionar lead / contato / atividade"
            onClick={() => setShowEntityMention(v => !v)}
          >
            <Users className="h-4 w-4" />
          </Button>
          <Button
            type="button" size="icon" variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title="Anexar arquivo ou imagem"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Button
            type="button" size="icon" variant="ghost"
            className={cn('h-8 w-8 shrink-0', urgent ? 'text-destructive bg-destructive/10' : 'text-muted-foreground')}
            title={urgent ? 'Urgente ativado — a próxima mensagem alerta a equipe' : 'Marcar próxima mensagem como urgente'}
            onClick={() => setUrgent(v => !v)}
          >
            <AlertTriangle className="h-4 w-4" />
          </Button>
          <Button
            type="button" size="icon" variant="ghost"
            className={cn('h-8 w-8 shrink-0', isRecording ? 'text-destructive' : 'text-muted-foreground')}
            title={isRecording ? 'Parar gravação' : 'Gravar áudio (transcrição automática)'}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>

          <Input
            ref={inputRef}
            value={inputText}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={urgent ? 'Mensagem URGENTE… use @nome' : 'Mensagem... use @nome para mencionar'}
            className={cn('flex-1 text-sm h-9', urgent && 'ring-1 ring-destructive/50')}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
