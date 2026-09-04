import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense, Fragment } from 'react';
import { playUrgentBeep } from '@/lib/sounds';
import { isSoundEnabled } from '@/lib/soundSettings';
import { useTeamChat, useTeamMembers, TeamMember, TeamMessage } from '@/hooks/useTeamChat';
import { ChatMessageActions } from './ChatMessageActions';
import { ForwardMessagePicker } from './ForwardMessagePicker';
import { openTeamChatConversation } from '@/lib/teamChatPanelEvents';
import { setActiveTeamChatEntity } from '@/lib/teamChatActiveConversation';
import { startDirectConversationWith, sendTeamDirectMessage } from '@/lib/teamDirectMessages';
import {
  buildForwardContent,
  buildPrivateReplyHeader,
  msgPreviewText,
  parseForward,
  parsePrivateReply,
  splitQuotedLines,
} from '@/lib/teamChatMessageContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useCallOptional } from '@/contexts/CallContext';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { Button } from '@/components/ui/button';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { Send, Loader2, AtSign, Users, UserRound, Paperclip, Mic, Square, AlertTriangle, Play, Pause, FileText, Sparkles, Bell, BellRing, Reply, MessageSquarePlus, Forward, MessageCircleReply, Phone, Search, X } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { TeamChatEntityMention, renderMessageWithMentions, EntityMention, EntityMentionType } from './TeamChatEntityMention';
import { consumePendingTeamChatQuote, subscribeToTeamChatQuote, formatQuotedMessages } from '@/lib/teamChatQuoteEvents';
import { useCaseOwners, CaseOwner } from '@/hooks/useCaseOwners';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { AITextActions } from '@/components/ui/AITextActions';
import { AISuggestReply } from '@/components/ui/AISuggestReply';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import type { ActivityDraft } from '@/components/activities/ActivityFullSheet';

// Formulário completo de atividade — carregado só quando alguém cria a partir
// de uma mensagem (o chat abre em toda ficha, não vale pesar o bundle).
const ActivityFullSheet = lazy(() =>
  import('@/components/activities/ActivityFullSheet').then((m) => ({ default: m.ActivityFullSheet }))
);

interface TeamChatPanelProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  highlightMessageId?: string | null;
  /**
   * Chamado antes de enviar quando a mensagem menciona alguém. Usado no chat da
   * conversa do WhatsApp para liberar o acesso à conversa a quem foi marcado
   * (a pessoa precisa poder ler o que está sendo discutido).
   */
  onMentionUsers?: (mentionedUserIds: string[]) => Promise<void> | void;
  /** Aviso curto exibido acima do campo de digitação. */
  footerNote?: React.ReactNode;
}

const MEDIA_BUCKET = 'team-chat-media';

/** Rótulo do papel exibido ao lado do nome (lista de @ e lista de ligação). */
const ROLE_LABEL: Record<string, string> = {
  responsavel: 'Responsável',
  acolhedor: 'Acolhedor',
};

function formatDuration(seconds?: number | null) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export function TeamChatPanel({ entityType, entityId, entityName, highlightMessageId, onMentionUsers, footerNote }: TeamChatPanelProps) {
  const { user } = useAuthContext();
  const { messages, loading, sendMessage, updateMessage, alertMessageAgain, threadKey, threadSize, threadKind, threadLabel } =
    useTeamChat(entityType, entityId, entityName);
  const members = useTeamMembers();
  const navigate = useNavigate();
  const push = usePushNotifications();
  // Ligação por voz: a mesma do Chat da Equipe (CallContext + CallOverlay).
  // Opcional porque este painel também abre fora do provider (telão).
  const call = useCallOptional();
  const callStatus = call?.status ?? 'idle';
  const [showCallPicker, setShowCallPicker] = useState(false);
  const [callFilter, setCallFilter] = useState('');
  const callSearchRef = useRef<HTMLInputElement>(null);
  const draftKey = `team-chat-draft-${entityType}-${entityId}`;
  const [inputText, setInputText] = useState(() => sessionStorage.getItem(draftKey) || '');
  const [sending, setSending] = useState(false);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  // Recursos ricos (paridade com o chat direto).
  const [urgent, setUrgent] = useState(false);
  // Responder (vira reply_to_id) e encaminhar — mesmas ações do Chat da Equipe.
  const [replyingTo, setReplyingTo] = useState<TeamMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<TeamMessage | null>(null);
  const [forwardSending, setForwardSending] = useState(false);
  // Imagem sempre abre no visualizador interno — nunca em outra página.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showEntityMention, setShowEntityMention] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  // IA: sugerir resposta (conversa inteira ou uma mensagem específica).
  const [aiSuggestOpen, setAiSuggestOpen] = useState(false);
  const [aiTargetMessage, setAiTargetMessage] = useState<string | undefined>(undefined);
  // Atividade criada a partir de uma mensagem do chat.
  const [activityDraft, setActivityDraft] = useState<ActivityDraft | null>(null);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  const [creatingActivityFromMsgId, setCreatingActivityFromMsgId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  // Bip ao receber mensagem urgente de outro membro (ignora o carregamento
  // inicial). Só toca com "Mensagem urgente" ligado em Configurações →
  // Notificações → Sons do sistema; de fábrica é mudo.
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
      if (m.is_urgent && m.sender_id !== user?.id && !m.deleted_at && isSoundEnabled('chatUrgent')) {
        playUrgentBeep();
      }
    }
  }, [messages, loading, user?.id]);

  /** Cola no rascunho a mensagem que veio de fora (ex.: bolha do WhatsApp). */
  const appendQuote = useCallback((quote: string) => {
    if (!quote.trim()) return;
    setInputText(prev => {
      const next = prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${quote}\n` : `${quote}\n`;
      sessionStorage.setItem(draftKey, next);
      return next;
    });
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [draftKey]);

  // A citação pode chegar antes do painel montar (o clique é que abre o painel),
  // por isso o intent pendente é consumido no primeiro render.
  useEffect(() => {
    const pendingQuote = consumePendingTeamChatQuote(entityType, entityId);
    if (pendingQuote) appendQuote(pendingQuote.text);
    return subscribeToTeamChatQuote(entityType, entityId, intent => appendQuote(intent.text));
  }, [entityType, entityId, appendQuote]);

  // Com este chat aberto na tela, popup do que chega aqui vira ruído: quem está
  // vendo a conversa não precisa de aviso dela. A chave é a do THREAD (raiz da
  // cadeia, em atividade) — é com ela que a mensagem nova chega.
  useEffect(() => {
    setActiveTeamChatEntity(threadKey);
    return () => setActiveTeamChatEntity(null);
  }, [threadKey]);

  // Quem cuida do caso por trás deste chat (responsável processual + acolhedor).
  const { owners } = useCaseOwners(entityType, entityId, members);

  /** Os donos do caso que combinam com o que já foi digitado depois do @. */
  const filteredOwners = useMemo(() => {
    if (!mentionFilter) return owners;
    const lower = mentionFilter.toLowerCase();
    return owners.filter(o => o.name.toLowerCase().includes(lower));
  }, [owners, mentionFilter]);

  const ownerIds = useMemo(
    () => new Set(filteredOwners.map(o => o.userId).filter(Boolean) as string[]),
    [filteredOwners]
  );

  const filteredMembers = useMemo(() => {
    const base = members.filter(m => m.user_id !== user?.id && !ownerIds.has(m.user_id));
    if (!mentionFilter) return base;
    const lower = mentionFilter.toLowerCase();
    return base.filter(m =>
      m.full_name?.toLowerCase().includes(lower) || m.email?.toLowerCase().includes(lower)
    );
  }, [members, mentionFilter, user?.id, ownerIds]);

  /**
   * Para quem dá pra ligar a partir desta ficha, na ordem em que a pessoa
   * pensa: quem cuida do caso, quem já escreveu neste chat e, por último, o
   * resto da equipe. Mesma fonte do "@" — a ligação é o mesmo repertório do
   * chat interno, só que por voz.
   */
  const callTargets = useMemo(() => {
    const out: { userId: string; name: string; detail: string | null }[] = [];
    const seen = new Set<string>();
    const add = (userId: string | null | undefined, name: string, detail?: string | null) => {
      if (!userId || userId === user?.id || seen.has(userId)) return;
      seen.add(userId);
      out.push({ userId, name, detail: detail || null });
    };
    owners.forEach(o => add(
      o.userId,
      o.name,
      [o.roles.map(r => ROLE_LABEL[r]).filter(Boolean).join(' · '), o.detail].filter(Boolean).join(' · '),
    ));
    messages.forEach(m => add(m.sender_id, m.sender_name || 'Alguém da equipe', 'escreveu neste chat'));
    members.forEach(m => add(m.user_id, m.full_name || m.email || 'Sem nome', m.email));
    return out;
  }, [owners, messages, members, user?.id]);

  /** A busca da lista de ligação — a equipe inteira não cabe numa rolagem. */
  const filteredCallTargets = useMemo(() => {
    const q = callFilter.trim().toLowerCase();
    if (!q) return callTargets;
    return callTargets.filter(t =>
      t.name.toLowerCase().includes(q) || (t.detail || '').toLowerCase().includes(q)
    );
  }, [callTargets, callFilter]);

  /** Liga e fecha a lista — o card da chamada (CallOverlay) abre por cima. */
  const callPerson = (userId: string, name: string) => {
    setShowCallPicker(false);
    setCallFilter('');
    call?.startCall(userId, name);
  };

  /** Abre/fecha a lista já com o cursor na busca. */
  const toggleCallPicker = () => {
    setShowCallPicker(open => {
      if (open) { setCallFilter(''); return false; }
      requestAnimationFrame(() => callSearchRef.current?.focus());
      return true;
    });
  };

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

  /** Todos os membros menos eu — quem "@todos" alcança. */
  const everyoneElseIds = useMemo(
    () => members.filter(m => m.user_id !== user?.id).map(m => m.user_id),
    [members, user?.id]
  );

  /** A opção "@todos" só aparece quando o que foi digitado depois do @ combina. */
  const showEveryoneOption = useMemo(() => {
    if (everyoneElseIds.length === 0) return false;
    const f = mentionFilter.toLowerCase();
    return f === '' || 'todos'.startsWith(f) || 'equipe'.startsWith(f) || 'all'.startsWith(f);
  }, [mentionFilter, everyoneElseIds.length]);

  const insertEveryoneMention = () => {
    const before = inputText.slice(0, mentionStartIndex);
    const after = inputText.slice(inputRef.current?.selectionStart || inputText.length);
    setInputText(`${before}@todos ${after}`);
    setShowMentionList(false);
    setMentionFilter('');
    setMentionStartIndex(-1);
    setSelectedMentions(prev => Array.from(new Set([...prev, ...everyoneElseIds])));
    // Numa conversa de WhatsApp a menção libera acesso — avisar antes de enviar.
    if (onMentionUsers) {
      toast.warning(`@todos avisa ${everyoneElseIds.length} pessoas e libera o acesso desta conversa a elas.`);
    }
    inputRef.current?.focus();
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

  const insertOwnerMention = (owner: CaseOwner) => {
    if (!owner.userId) return;
    const member = members.find(m => m.user_id === owner.userId);
    insertMention(member || { user_id: owner.userId, full_name: owner.name, email: null });
  };

  const collectMentionedIds = useCallback((text: string) => {
    const mentionedIds = [...selectedMentions];
    // "@todos" digitado na mão também vale, sem precisar escolher na lista.
    if (/@(todos|todas|equipe|all)\b/i.test(text)) {
      for (const member of members) {
        if (member.user_id !== user?.id && !mentionedIds.includes(member.user_id)) {
          mentionedIds.push(member.user_id);
        }
      }
    }
    for (const member of members) {
      if (mentionedIds.includes(member.user_id)) continue;
      const name = member.full_name || member.email;
      if (name && text.toLowerCase().includes(`@${name.toLowerCase()}`)) {
        mentionedIds.push(member.user_id);
      }
    }
    return mentionedIds;
  }, [members, selectedMentions, user?.id]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    const mentionedIds = collectMentionedIds(text);
    // Libera o acesso antes de avisar — quem é marcado precisa conseguir abrir
    // o que está sendo discutido, não receber uma notificação sem contexto.
    if (mentionedIds.length > 0 && onMentionUsers) {
      try {
        await onMentionUsers(mentionedIds);
      } catch (e) {
        console.error('[TeamChatPanel] falha ao liberar acesso aos mencionados:', e);
      }
    }
    await sendMessage(text, mentionedIds, {
      ...(urgent ? { is_urgent: true } : {}),
      ...(replyingTo ? { reply_to_id: replyingTo.id } : {}),
    });
    setInputText('');
    sessionStorage.removeItem(draftKey);
    setSelectedMentions([]);
    setUrgent(false);
    setReplyingTo(null);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * O envio de mídia termina fora do render — depois do upload, ou no `onstop`
   * do gravador. Ler o toggle por ref evita congelar o valor de quando a ação
   * começou: quem liga o ⚠ com a gravação em curso ainda manda como urgente.
   */
  const urgentRef = useRef(urgent);
  useEffect(() => { urgentRef.current = urgent; }, [urgent]);

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
        ...(urgentRef.current ? { is_urgent: true } : {}),
      });
    } catch {
      toast.error('Erro ao enviar arquivo');
    } finally {
      setUploading(false);
    }
  }, [user?.id, sendMessage]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadAndSendFile(file);
      // Urgência vale por mensagem, como no texto — não sobra para a próxima.
      setUrgent(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadAndSendFile]);

  /**
   * Colar mídia (Ctrl+V): print da tela ou arquivo copiado do explorador vira
   * anexo direto, sem passar pelo clipe. Texto sempre ganha — copiar de Word/
   * Excel também carrega uma imagem na área de transferência, e ali o que a
   * pessoa quer colar é o texto.
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const dt = e.clipboardData;
    if (!dt) return;
    if ((dt.getData('text/plain') || '').trim()) return;

    const files = Array.from(dt.files || []);
    if (files.length === 0) {
      for (const item of Array.from(dt.items || [])) {
        if (item.kind !== 'file') continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;

    e.preventDefault();
    void (async () => {
      for (const file of files) {
        // Print colado chega sem nome — dar um para o anexo não ficar anônimo.
        const named = file.name
          ? file
          : new File([file], `colado_${Date.now()}.${(file.type.split('/')[1] || 'png')}`, { type: file.type });
        await uploadAndSendFile(named);
      }
      // Uma colagem com vários arquivos é um envio só: todos saem urgentes e o
      // ⚠ desliga no fim, não no primeiro arquivo.
      setUrgent(false);
    })();
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
            ...(urgentRef.current ? { is_urgent: true } : {}),
          });
          setUrgent(false);
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

  // ===== IA (mesmas ferramentas do WhatsApp, com persona de equipe) =====

  /** Só texto entra na transcrição da IA — áudio/imagem/arquivo ficam de fora. */
  const textMessagesForAI = useCallback(
    () => (messages || []).filter(
      m => m.content && String(m.content).trim() && (!m.message_type || m.message_type === 'text') && !m.deleted_at
    ),
    [messages]
  );

  /** Últimas falas em ordem cronológica. "Eu" = usuário atual. */
  const buildReplyContext = useCallback(
    () => textMessagesForAI()
      .slice(-20)
      .map(m => `${m.sender_id === user?.id ? 'Eu' : (m.sender_name || 'Colega')}: ${String(m.content).trim()}`)
      .join('\n'),
    [textMessagesForAI, user?.id]
  );

  /** Diz à IA se há resposta pendente e o que eu já falei (para não repetir). */
  const buildReplyState = useCallback(() => {
    const withText = textMessagesForAI();
    const last = withText[withText.length - 1];
    const lastMine = [...withText].reverse().find(m => m.sender_id === user?.id);
    const lastOther = [...withText].reverse().find(m => m.sender_id !== user?.id);
    return {
      pending: !!last && last.sender_id !== user?.id,
      lastOutboundText: lastMine ? String(lastMine.content).trim() : '',
      lastClientText: lastOther ? String(lastOther.content).trim() : '',
    };
  }, [textMessagesForAI, user?.id]);

  // ===== Ações a partir de uma mensagem (paridade com a bolha do WhatsApp) =====

  /** Texto útil da bolha: sem cabeçalho de contexto nem bloco citado. */
  const msgPlainText = useCallback((msg: TeamMessage) => {
    if (msg.message_type === 'audio') return msg.transcription?.trim() || '';
    if (msg.message_type === 'file') return `📎 ${msg.file_name || 'Arquivo'}`;
    const bare = parsePrivateReply(parseForward(msg.content || '').body).body;
    if (msg.message_type === 'image') return bare && bare !== '📷 Imagem' ? bare : '';
    return splitQuotedLines(bare).body || bare;
  }, []);

  /**
   * Onde esta conversa acontece, do ponto de vista de quem recebe a resposta no
   * privado ("↩️ Em resposta no chat interno de …").
   */
  const scopeLabel = useMemo(() => {
    const name = entityName || 'este item';
    return entityType === 'whatsapp'
      ? `chat interno da conversa de ${name}`
      : `chat interno de ${name}`;
  }, [entityType, entityName]);

  /**
   * Responder no privado: abre (ou reaproveita) a conversa direta com quem
   * escreveu e leva o contexto junto — o Chat da Equipe mostra a tarja e
   * carimba o cabeçalho no envio.
   */
  const startPrivateReply = useCallback(async (msg: TeamMessage) => {
    if (!user?.id || !msg.sender_id || msg.sender_id === user.id) return;
    const convId = await startDirectConversationWith(msg.sender_id, user.id);
    if (!convId) return;
    const excerpt = (msgPlainText(msg) || msgPreviewText(msg)).replace(/\s+/g, ' ').trim().slice(0, 120);
    openTeamChatConversation({
      conversationId: convId,
      focusComposer: true,
      contextReply: {
        header: buildPrivateReplyHeader(scopeLabel, excerpt),
        scopeLabel,
        senderName: msg.sender_name,
        excerpt,
      },
    });
  }, [user?.id, msgPlainText, scopeLabel]);

  /** Encaminha a mensagem para uma conversa do Chat da Equipe. */
  const forwardToConversation = useCallback(async (conversationId: string) => {
    if (!forwardingMsg || !user?.id || forwardSending) return;
    setForwardSending(true);
    try {
      const myName = members.find(m => m.user_id === user.id)?.full_name || user.email || 'Alguém';
      const sent = await sendTeamDirectMessage(
        conversationId,
        user.id,
        user.email,
        buildForwardContent(forwardingMsg, myName),
        {
          senderName: myName,
          message_type: forwardingMsg.message_type || 'text',
          file_url: forwardingMsg.file_url,
          file_name: forwardingMsg.file_name,
          file_size: forwardingMsg.file_size,
          file_type: forwardingMsg.file_type,
          audio_duration: forwardingMsg.audio_duration,
          transcription: forwardingMsg.transcription,
        }
      );
      if (!sent) return;
      toast.success('Mensagem encaminhada');
      setForwardingMsg(null);
      openTeamChatConversation({ conversationId, focusComposer: true });
    } finally {
      setForwardSending(false);
    }
  }, [forwardingMsg, forwardSending, user?.id, user?.email, members]);

  const forwardToUser = useCallback(async (otherUserId: string) => {
    if (!user?.id) return;
    const convId = await startDirectConversationWith(otherUserId, user.id);
    if (convId) await forwardToConversation(convId);
  }, [user?.id, forwardToConversation]);

  const copyMessage = useCallback(async (msg: TeamMessage) => {
    const text = msgPlainText(msg);
    if (!text.trim()) { toast.error('Essa mensagem não tem texto para copiar.'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Texto copiado');
    } catch {
      toast.error('Não foi possível copiar');
    }
  }, [msgPlainText]);

  /** Cita a mensagem no próprio rascunho — mesmo formato do "Comentar" do WhatsApp. */
  const quoteMessage = useCallback((msg: TeamMessage) => {
    const text = msgPlainText(msg);
    if (!text.trim()) { toast.error('Essa mensagem não tem texto para citar.'); return; }
    let when = '';
    try { when = format(new Date(msg.created_at), 'dd/MM HH:mm', { locale: ptBR }); } catch { /* sem data */ }
    const quote = formatQuotedMessages([{
      who: msg.sender_id === user?.id ? 'Eu' : (msg.sender_name || 'Colega'),
      when,
      text,
    }]);
    appendQuote(quote);
  }, [msgPlainText, user?.id, appendQuote]);

  const replyWithAI = useCallback((msg: TeamMessage) => {
    const text = msgPlainText(msg);
    if (!text.trim()) { toast.error('Essa mensagem não tem texto para a IA responder.'); return; }
    setAiTargetMessage(text);
    setAiSuggestOpen(true);
  }, [msgPlainText]);

  // ---- Criar atividade a partir da mensagem (IA preenche, o usuário revisa) ----
  const { types: activityTypes } = useActivityTypes();

  const createActivityFromMessage = useCallback(async (msg: TeamMessage) => {
    setCreatingActivityFromMsgId(msg.id);
    try {
      // A mensagem clicada é o foco; as anteriores entram só como contexto.
      const idx = messages.findIndex(m => m.id === msg.id);
      const slice = idx >= 0 ? messages.slice(Math.max(0, idx - 5), idx + 1) : [msg];
      const transcript = slice
        .map(m => {
          const who = m.sender_id === user?.id ? 'Eu' : (m.sender_name || 'Colega');
          return `${who}: ${msgPlainText(m) || '(sem texto)'}`;
        })
        .join('\n');

      const memberNames = members.map(m => m.full_name).filter(Boolean) as string[];

      // Tipos podem não ter carregado no clique (cache frio) — busca direto.
      let typeOptions = activityTypes.filter(t => t.is_active).map(t => ({ key: t.key, label: t.label }));
      if (typeOptions.length === 0) {
        await ensureExternalSession();
        const { data: tRows } = await externalSupabase
          .from('activity_types')
          .select('key, label, is_active')
          .order('display_order', { ascending: true });
        typeOptions = ((tRows as { key: string; label: string; is_active: boolean }[]) || [])
          .filter(t => t.is_active)
          .map(t => ({ key: t.key, label: t.label }));
      }

      const { data, error } = await cloudFunctions.invoke('chat-to-activity', {
        body: { transcript, activity_types: typeOptions, member_names: memberNames },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao gerar o rascunho da atividade');

      const f = data.fields || {};
      const assigneeMember = f.assignee_name
        ? members.find(m => (m.full_name || '').trim().toLowerCase() === String(f.assignee_name).trim().toLowerCase())
        : null;

      // A atividade já nasce presa à ficha de onde o chat foi aberto.
      const entityLink: Partial<ActivityDraft> =
        entityType === 'lead' ? { lead_id: entityId, lead_name: entityName || f.lead_name || undefined }
        : entityType === 'case' ? { case_id: entityId, case_title: entityName || undefined }
        : entityType === 'process' ? { process_id: entityId, process_title: entityName || undefined }
        : { lead_name: f.lead_name || undefined };

      setActivityDraft({
        title: f.title || '',
        activity_type: f.activity_type || '',
        priority: f.priority || 'normal',
        deadline: f.deadline || undefined,
        assigned_to: assigneeMember?.user_id || undefined,
        assigned_to_name: assigneeMember?.full_name || undefined,
        what_was_done: f.what_was_done || '',
        current_status_notes: f.current_status || '',
        next_steps: f.next_steps || '',
        notes: [f.notes || '', `— Origem: chat interno da equipe —\n${transcript}`].filter(Boolean).join('\n\n'),
        ...entityLink,
      });
      setActivitySheetOpen(true);
    } catch (e: any) {
      console.error('[TeamChatPanel] erro ao gerar atividade a partir da mensagem:', e);
      toast.error(e?.message || 'Não foi possível gerar a atividade');
    } finally {
      setCreatingActivityFromMsgId(null);
    }
  }, [messages, members, user?.id, msgPlainText, activityTypes, entityType, entityId, entityName]);

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
        <button type="button" onClick={() => setLightboxUrl(msg.file_url!)} className="block cursor-zoom-in">
          <img src={msg.file_url} alt={msg.file_name || 'imagem'} className="max-h-48 rounded-lg object-cover" />
        </button>
      );
    }
    if (msg.message_type === 'file' && msg.file_url) {
      // Anexo que na verdade é imagem/PDF também abre no visualizador interno.
      const previewable = /^image\//i.test(msg.file_type || '') || /\.(jpe?g|png|webp|gif|pdf)($|\?)/i.test(msg.file_url);
      const className = cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs underline', isMe ? 'bg-primary-foreground/15' : 'bg-background/60');
      const label = (
        <>
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[180px]">{msg.file_name || 'Arquivo'}</span>
        </>
      );
      return previewable ? (
        <button type="button" onClick={() => setLightboxUrl(msg.file_url!)} className={className}>
          {label}
        </button>
      ) : (
        <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className={className}>
          {label}
        </a>
      );
    }
    return null;
  };

  const hasAttachment = (t?: string | null) => t === 'audio' || t === 'image' || t === 'file';

  /** Divisor de dia da conversa: "Hoje", "Ontem" ou a data. Sempre no fuso de quem lê. */
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const dia = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const hoje = new Date();
    const ontem = new Date(hoje);
    ontem.setDate(hoje.getDate() - 1);
    if (dia(d) === dia(hoje)) return 'Hoje';
    if (dia(d) === dia(ontem)) return 'Ontem';
    return format(d, "dd 'de' MMMM", { locale: ptBR });
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Encaminhar: cobre o painel enquanto o destino é escolhido (mesmo
          seletor do Chat da Equipe). */}
      {forwardingMsg && (
        <ForwardMessagePicker
          className="absolute inset-0 z-20"
          preview={msgPreviewText(forwardingMsg)}
          senderName={forwardingMsg.sender_name}
          sending={forwardSending}
          onCancel={() => setForwardingMsg(null)}
          onPickConversation={forwardToConversation}
          onPickUser={forwardToUser}
        />
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {/* De quem é esta conversa. Fora do dock do próprio dono o aviso é
            obrigatório: o que se escreve aqui vai para o caso e aparece em
            todas as atividades e processos dele — sem dizer isso, a pessoa acha
            que está falando só com o responsável da ficha (foi o mal-entendido
            do CASO 180, 10/08/2026). */}
        {threadKind === 'case' && entityType !== 'case' ? (
          <div className="flex justify-center pb-1">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary text-center">
              Conversa do caso{threadLabel ? ` ${threadLabel}` : ''} · aparece em todas as atividades e processos dele
            </span>
          </div>
        ) : threadKind === 'process' && entityType !== 'process' ? (
          <div className="flex justify-center pb-1">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary text-center">
              Conversa do processo{threadLabel ? ` ${threadLabel}` : ''} · aparece em todas as atividades dele
            </span>
          </div>
        ) : threadKind === 'chain' && threadSize > 1 && messages.length > 0 ? (
          <div className="flex justify-center pb-1">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              Conversa contínua · {threadSize} etapas desta atividade
            </span>
          </div>
        ) : null}
        {messages.length === 0 && loading ? (
          /* Só a lista espera — o campo de digitação já está disponível. */
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs text-center gap-2">
            <Users className="h-8 w-8 opacity-30" />
            <p>Nenhuma mensagem da equipe.<br/>Use <span className="font-medium text-primary">@nome</span> para mencionar alguém.</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.sender_id === user?.id;
            const isHighlighted = msg.id === highlightMessageId;
            const repliedMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
            const fwdHeader = parseForward(msg.content || '').header;
            const pvtHeader = parsePrivateReply(parseForward(msg.content || '').body).header;
            // Numa conversa que atravessa dias (e etapas), sem o dia não dá pra
            // saber se a resposta é de hoje ou da semana passada.
            const anterior = idx > 0 ? messages[idx - 1] : null;
            const diaLabel = dayLabel(msg.created_at);
            const mostrarDia = !anterior || dayLabel(anterior.created_at) !== diaLabel;
            return (
              <Fragment key={msg.id}>
              {mostrarDia && (
                <div className="flex justify-center py-0.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {diaLabel}
                  </span>
                </div>
              )}
              <div
                data-team-msg-id={msg.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={cn('group flex', isMe ? 'justify-end' : 'justify-start')}
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
                  {/* Contexto de outro chat: encaminhada / resposta no privado. */}
                  {fwdHeader && (
                    <div className="flex items-center gap-1 text-[10px] italic opacity-70 mb-0.5">
                      <Forward className="h-3 w-3 shrink-0" />
                      <span className="truncate">{fwdHeader.replace('↪️ ', '')}</span>
                    </div>
                  )}
                  {pvtHeader && (
                    <div className={cn(
                      'flex items-start gap-1 mb-1 pl-2 pr-2 py-1 border-l-2 rounded text-[11px] italic opacity-80',
                      isMe ? 'border-primary-foreground/60 bg-primary-foreground/10' : 'border-primary bg-background/60'
                    )}>
                      <MessageCircleReply className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="break-words">{pvtHeader.replace('↩️ ', '')}</span>
                    </div>
                  )}
                  {/* Mensagem respondida (reply_to_id) — clicar leva até ela. */}
                  {repliedMsg && (
                    <button
                      type="button"
                      onClick={() => {
                        document.querySelector(`[data-team-msg-id="${repliedMsg.id}"]`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      className={cn(
                        'w-full text-left mb-1 pl-2 pr-2 py-1 border-l-2 rounded text-[11px] hover:opacity-80 transition-opacity',
                        isMe ? 'border-primary-foreground/60 bg-primary-foreground/10' : 'border-primary bg-background/60'
                      )}
                    >
                      <div className="font-semibold opacity-80 truncate">
                        {repliedMsg.sender_name || 'Mensagem'}
                      </div>
                      <div className="opacity-70 truncate">{msgPreviewText(repliedMsg)}</div>
                    </button>
                  )}
                  {hasAttachment(msg.message_type) ? (
                    renderAttachment(msg, isMe)
                  ) : (() => {
                    // Linhas iniciadas por ">" são mensagem citada — vão para um
                    // bloco próprio, como no WhatsApp, para não virar texto solto.
                    const bare = parsePrivateReply(parseForward(msg.content || '').body).body;
                    const { quoted, body } = splitQuotedLines(bare);
                    return (
                      <>
                        {quoted && (
                          <div className={cn(
                            'mb-1 border-l-2 pl-2 py-0.5 rounded-r text-[11px] whitespace-pre-wrap break-words',
                            isMe
                              ? 'border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/85'
                              : 'border-primary/50 bg-background/60 text-muted-foreground'
                          )}>
                            {quoted}
                          </div>
                        )}
                        {body && (
                          <p className="whitespace-pre-wrap break-words text-[13px]">
                            {renderContent(body, isMe)}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {/* Ações da mensagem — as mesmas do Chat da Equipe
                      (ChatMessageActions). Ficam abaixo do conteúdo, nunca por
                      cima do texto: aqui o painel é estreito. */}
                  {!msg.deleted_at && (
                    <ChatMessageActions
                      placement="inside"
                      isMe={isMe}
                      onAlertAgain={() => alertMessageAgain(msg.id)}
                      onReply={() => {
                        setReplyingTo(msg);
                        requestAnimationFrame(() => inputRef.current?.focus());
                      }}
                      onPrivateReply={!isMe && msg.sender_id ? () => startPrivateReply(msg) : undefined}
                      privateReplyTitle={`Responder no privado (abre a conversa direta com ${msg.sender_name || 'quem escreveu'})`}
                      onCall={
                        call && !isMe && msg.sender_id
                          ? () => callPerson(msg.sender_id, msg.sender_name || 'Membro da equipe')
                          : undefined
                      }
                      callTitle={`Ligar por voz para ${msg.sender_name || 'quem escreveu'} (sem sair desta tela)`}
                      onQuote={() => quoteMessage(msg)}
                      onCopy={() => copyMessage(msg)}
                      onAI={() => replyWithAI(msg)}
                      onForward={() => setForwardingMsg(msg)}
                      onCreateActivity={() => createActivityFromMessage(msg)}
                      creatingActivity={creatingActivityFromMsgId === msg.id}
                    />
                  )}
                  <div className={cn('text-[9px] mt-0.5', isMe ? 'text-primary-foreground/60 text-right' : 'text-muted-foreground')}>
                    {format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                  </div>
                </div>
              </div>
              </Fragment>
            );
          })
        )}
      </div>

      {/* Mention dropdown (membros) */}
      {showMentionList && (filteredMembers.length > 0 || showEveryoneOption || filteredOwners.length > 0) && (
        <div className="mx-3 mb-1 border rounded-lg bg-card shadow-lg max-h-56 overflow-y-auto">
          {/* Quem cuida do caso vem primeiro e rotulado — sem precisar abrir a ficha. */}
          {filteredOwners.length > 0 && (
            <div className="border-b bg-muted/40">
              <div className="px-3 pt-1.5 pb-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                Quem cuida deste caso
              </div>
              {filteredOwners.map(owner => {
                const isMe = !!owner.userId && owner.userId === user?.id;
                const mentionable = !!owner.userId && !isMe;
                return (
                  <button
                    key={`owner-${owner.userId || owner.name}`}
                    type="button"
                    disabled={!mentionable}
                    onClick={() => insertOwnerMention(owner)}
                    title={
                      mentionable
                        ? `Marcar ${owner.name}`
                        : isMe
                          ? 'É você — não precisa se marcar'
                          : `${owner.name} não tem usuário no sistema para ser marcado`
                    }
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                      mentionable ? 'hover:bg-accent/50' : 'cursor-default'
                    )}
                  >
                    {mentionable
                      ? <AtSign className="h-3.5 w-3.5 text-primary shrink-0" />
                      : <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-xs font-medium truncate', !mentionable && 'text-muted-foreground')}>
                        {owner.name}{isMe && ' (você)'}
                      </div>
                      {/* Qual processo essa pessoa responde — o caso pode ter vários. */}
                      {(owner.detail || (!mentionable && !isMe)) && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {[owner.detail, !mentionable && !isMe ? 'sem usuário no sistema' : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                    <span className="flex items-center gap-1 shrink-0">
                      {owner.roles.map(role => (
                        <span
                          key={role}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[9px] font-medium leading-none whitespace-nowrap',
                            role === 'responsavel'
                              ? 'bg-primary/15 text-primary'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          )}
                        >
                          {ROLE_LABEL[role]}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {showEveryoneOption && (
            <button
              onClick={insertEveryoneMention}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors text-left border-b"
            >
              <Users className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">@todos</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  Avisa a equipe inteira ({everyoneElseIds.length} {everyoneElseIds.length === 1 ? 'pessoa' : 'pessoas'})
                </div>
              </div>
            </button>
          )}
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

      {/* Para quem ligar — some sozinha depois que a chamada começa. */}
      {call && showCallPicker && (
        <div className="mx-3 mb-1 border rounded-lg bg-card shadow-lg max-h-56 overflow-y-auto">
          {/* Cabeçalho e busca ficam fixos: a lista rola por baixo deles. */}
          <div className="sticky top-0 z-10 bg-card border-b px-3 pt-1.5 pb-1.5">
            <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              Ligar por voz — a chamada abre aqui mesmo, sem sair da ficha
            </div>
            <div className="mt-1 flex items-center gap-1.5 rounded border px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                ref={callSearchRef}
                value={callFilter}
                onChange={e => setCallFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); setShowCallPicker(false); setCallFilter(''); }
                  // Enter liga para o primeiro da lista — buscar e ligar sem tirar a mão do teclado.
                  if (e.key === 'Enter' && filteredCallTargets[0]) {
                    e.preventDefault();
                    callPerson(filteredCallTargets[0].userId, filteredCallTargets[0].name);
                  }
                }}
                placeholder="Buscar quem ligar…"
                className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              {callFilter && (
                <button
                  type="button"
                  onClick={() => { setCallFilter(''); callSearchRef.current?.focus(); }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground shrink-0"
                  title="Limpar busca"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          {filteredCallTargets.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              {callTargets.length === 0
                ? 'Ninguém da equipe disponível para ligar.'
                : `Ninguém com "${callFilter.trim()}" na equipe.`}
            </div>
          ) : filteredCallTargets.map(target => (
            <button
              key={target.userId}
              type="button"
              onClick={() => callPerson(target.userId, target.name)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors text-left"
              title={`Ligar para ${target.name}`}
            >
              <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{target.name}</div>
                {target.detail && (
                  <div className="text-[10px] text-muted-foreground truncate">{target.detail}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input + ações ricas */}
      <div className="shrink-0 border-t bg-muted/30">
        {footerNote && (
          <div className="px-3 pt-1.5 text-[10px] leading-snug text-muted-foreground">{footerNote}</div>
        )}
        {/* Respondendo uma mensagem — mesma tarja do Chat da Equipe. */}
        {replyingTo && (
          <div className="flex items-start gap-2 px-3 py-1.5 border-b bg-primary/5">
            <Reply className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-primary truncate">
                Respondendo {replyingTo.sender_id === user?.id ? 'você mesmo' : (replyingTo.sender_name || 'mensagem')}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">{msgPreviewText(replyingTo)}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
              title="Cancelar resposta"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {isRecording && (
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-destructive">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" /> Gravando… {formatDuration(recordingDuration)}
            </span>
            <button onClick={stopRecording} className="font-medium underline">Parar e enviar</button>
          </div>
        )}
        {/* As ferramentas ficam ACIMA do campo: numa ficha estreita elas
            espremiam o texto a ponto de a palavra quebrar letra a letra. */}
        <div className="relative px-3 pt-2 pb-1 flex items-center gap-0.5 flex-wrap">
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
          {/* Ligar por voz — só existe dentro do CallProvider (fora dele, telão). */}
          {call && (
            <Button
              type="button" size="icon" variant="ghost"
              className={cn('h-8 w-8 shrink-0', showCallPicker ? 'text-primary bg-primary/10' : 'text-muted-foreground')}
              title={
                callStatus !== 'idle'
                  ? 'Você já está em uma chamada'
                  : 'Ligar por voz para alguém da equipe (a chamada abre por cima desta tela)'
              }
              disabled={callStatus !== 'idle'}
              onClick={toggleCallPicker}
            >
              <Phone className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button" size="icon" variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title="Anexar arquivo ou imagem (ou cole com Ctrl+V no campo de texto)"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Button
            type="button" size="icon" variant="ghost"
            className={cn('h-8 w-8 shrink-0', urgent ? 'text-destructive bg-destructive/10' : 'text-muted-foreground')}
            title={urgent ? 'Urgente ativado — o próximo envio (texto, imagem ou áudio) alerta a equipe' : 'Marcar próximo envio como urgente (vale para texto, imagem e áudio)'}
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
          {/* Edição do texto com IA — mesmo menu do WhatsApp (tom, tradução,
              resumo, rascunho, prompt personalizado). */}
          <AITextActions
            value={inputText}
            onChange={(v) => handleInputChange(v)}
            buttonClassName="h-8 w-8 shrink-0 flex items-center justify-center"
          />
          <Button
            type="button" size="icon" variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title="Sugerir resposta com IA (baseada na conversa)"
            onClick={() => { setAiTargetMessage(undefined); setAiSuggestOpen(true); }}
          >
            <MessageSquarePlus className="h-4 w-4 text-primary" />
          </Button>
        </div>

        {/* Linha do texto: só o campo e o enviar — o campo fica com a largura toda. */}
        <div className="px-3 pb-2 flex items-end gap-1.5">
          <AutoResizeTextarea
            ref={inputRef}
            value={inputText}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={urgent ? 'Mensagem URGENTE… use @nome' : 'Mensagem... use @nome ou cole (Ctrl+V) uma imagem'}
            className={cn('flex-1 min-w-0 min-h-[36px] py-2 text-sm', urgent && 'ring-1 ring-destructive/50')}
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

      {/* Sugestão de resposta por IA — persona de equipe. Nada é enviado:
          o texto cai no campo e a pessoa revisa. */}
      <AISuggestReply
        mode="team"
        hideTrigger
        open={aiSuggestOpen}
        onOpenChange={(o) => { setAiSuggestOpen(o); if (!o) setAiTargetMessage(undefined); }}
        targetMessage={aiTargetMessage}
        buildContext={buildReplyContext}
        getState={buildReplyState}
        onApply={(text) => {
          handleInputChange(text);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      />

      {/* Formulário completo da atividade nascida de uma mensagem. Abre à
          esquerda para não cobrir a ficha de onde o chat foi aberto. */}
      {activityDraft && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open={activitySheetOpen}
            mode="create"
            draft={activityDraft}
            activityId={null}
            side="left"
            onOpenChange={(o) => { if (!o) { setActivitySheetOpen(false); setActivityDraft(null); } }}
            onCreated={() => toast.success('Atividade criada a partir do chat!')}
          />
        </Suspense>
      )}

      <MediaLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  );
}
