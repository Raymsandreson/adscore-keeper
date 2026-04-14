import { useState, useRef, useEffect, useCallback } from 'react';
import { useTeamDirectChat, TeamMessage } from '@/hooks/useTeamDirectChat';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Send, Users, MessageCircle, ArrowLeft, Loader2, Plus, Hash,
  Mic, Square, Paperclip, Image, FileText, Briefcase, ClipboardList,
  Play, Pause,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { TeamChatEntityMention, renderMessageWithMentions, EntityMention, EntityMentionType } from './TeamChatEntityMention';
import type { TeamChatOpenIntent } from '@/lib/teamChatPanelEvents';

interface TeamDirectChatPanelProps {
  intent?: TeamChatOpenIntent | null;
  onIntentHandled?: () => void;
}

export function TeamDirectChatPanel({ intent, onIntentHandled }: TeamDirectChatPanelProps) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const {
    conversations, messages, activeConversationId, setActiveConversationId,
    loading, sendingMessage, sendMessage, startDirectChat, ensureGeneralChat,
  } = useTeamDirectChat();
  const profiles = useProfilesList();
  const [messageText, setMessageText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showEntityMention, setShowEntityMention] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!intent?.nonce) return;

    setActiveConversationId(intent.conversationId);

    if (typeof intent.draft === 'string') {
      setMessageText(intent.draft);
    }

    if (intent.focusComposer) {
      requestAnimationFrame(() => {
        messageInputRef.current?.focus();
      });
    }

    onIntentHandled?.();
  }, [intent, onIntentHandled, setActiveConversationId]);

  const handleSend = async () => {
    if (!messageText.trim()) return;
    await sendMessage(messageText);
    setMessageText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  // Audio recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const duration = recordingDuration;
        setIsRecording(false);
        setRecordingDuration(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

        // Upload
        setUploading(true);
        const fileName = `audio_${Date.now()}.webm`;
        const path = `${user?.id}/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from('team-chat-media')
          .upload(path, blob);

        if (uploadError) {
          toast.error('Erro ao enviar áudio');
          setUploading(false);
          return;
        }

        const { data: urlData } = supabase.storage.from('team-chat-media').getPublicUrl(path);

        await sendMessage('🎤 Áudio', {
          message_type: 'audio',
          file_url: urlData.publicUrl,
          file_name: fileName,
          file_size: blob.size,
          file_type: 'audio/webm',
          audio_duration: duration,
        });
        setUploading(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch {
      toast.error('Permissão de microfone negada');
    }
  }, [user?.id, sendMessage, recordingDuration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // File upload (shared logic)
  const uploadAndSendFile = useCallback(async (file: File) => {
    if (!user?.id) return;

    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande (máx. 20MB)');
      return;
    }

    setUploading(true);
    const path = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('team-chat-media')
      .upload(path, file);

    if (uploadError) {
      toast.error('Erro ao enviar arquivo');
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('team-chat-media').getPublicUrl(path);

    const isImage = file.type.startsWith('image/');
    await sendMessage(isImage ? '📷 Imagem' : `📎 ${file.name}`, {
      message_type: isImage ? 'image' : 'file',
      file_url: urlData.publicUrl,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type,
    });

    setUploading(false);
  }, [user?.id, sendMessage]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadAndSendFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadAndSendFile]);

  // Paste image (Ctrl+V)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void uploadAndSendFile(file);
        return;
      }
    }
  }, [uploadAndSendFile]);

  // Drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadAndSendFile(file);
  }, [uploadAndSendFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // Entity mention
  const handleEntitySelect = useCallback((entity: EntityMention) => {
    const mention = `[${entity.type}:${entity.id}:${entity.name}]`;
    setMessageText(prev => prev + mention + ' ');
  }, []);

  // Navigate on mention click
  const handleMentionNavigate = useCallback((type: EntityMentionType, id: string) => {
    switch (type) {
      case 'lead':
        navigate(`/leads?openLead=${id}`);
        break;
      case 'activity':
        navigate(`/?openActivity=${id}`);
        break;
      case 'contact':
        navigate(`/leads?openContact=${id}`);
        break;
    }
  }, [navigate]);

  // Audio playback
  const toggleAudio = useCallback((msgId: string, url: string) => {
    const existing = audioElementsRef.current.get(msgId);
    if (existing) {
      if (playingAudioId === msgId) {
        existing.pause();
        setPlayingAudioId(null);
      } else {
        existing.play();
        setPlayingAudioId(msgId);
      }
      return;
    }

    const audio = new Audio(url);
    audio.onended = () => setPlayingAudioId(null);
    audioElementsRef.current.set(msgId, audio);
    audio.play();
    setPlayingAudioId(msgId);
  }, [playingAudioId]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Render message bubble content
  const renderMsgContent = (msg: TeamMessage, isMe: boolean) => {
    if (msg.message_type === 'audio' && msg.file_url) {
      return (
        <button
          onClick={() => toggleAudio(msg.id, msg.file_url!)}
          className="flex items-center gap-2 py-1"
        >
          {playingAudioId === msg.id ? (
            <Pause className="h-4 w-4 shrink-0" />
          ) : (
            <Play className="h-4 w-4 shrink-0" />
          )}
          <div className="flex-1 h-1.5 rounded-full bg-current/20 min-w-[80px]">
            <div className={cn('h-full rounded-full', isMe ? 'bg-primary-foreground/60' : 'bg-foreground/40')} style={{ width: playingAudioId === msg.id ? '100%' : '0%', transition: 'width linear' }} />
          </div>
          <span className="text-[10px] opacity-70">
            {msg.audio_duration ? formatDuration(msg.audio_duration) : '0:00'}
          </span>
        </button>
      );
    }

    if (msg.message_type === 'image' && msg.file_url) {
      return (
        <div>
          <a href={msg.file_url} target="_blank" rel="noopener noreferrer">
            <img src={msg.file_url} alt={msg.file_name || 'Imagem'} className="rounded-lg max-w-full max-h-48 object-cover" />
          </a>
          {msg.content && msg.content !== '📷 Imagem' && (
            <p className="text-sm mt-1 whitespace-pre-wrap break-words">
              {renderMessageWithMentions(msg.content, handleMentionNavigate)}
            </p>
          )}
        </div>
      );
    }

    if (msg.message_type === 'file' && msg.file_url) {
      return (
        <a
          href={msg.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 py-1 hover:opacity-80"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{msg.file_name || 'Arquivo'}</div>
            {msg.file_size && (
              <div className="text-[10px] opacity-60">
                {(msg.file_size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>
        </a>
      );
    }

    // Text with entity mentions
    return (
      <p className="text-sm whitespace-pre-wrap break-words">
        {renderMessageWithMentions(msg.content || '', handleMentionNavigate)}
      </p>
    );
  };

  // Active conversation
  if (activeConversationId) {
    const activeConv = conversations.find(c => c.id === activeConversationId);
    const convTitle = activeConv?.type === 'group'
      ? (activeConv.name || 'Chat em Grupo')
      : (activeConv?.otherMemberName || 'Chat');

    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setActiveConversationId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
              {activeConv?.type === 'group' ? <Hash className="h-3.5 w-3.5" /> : getInitials(convTitle)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium truncate">{convTitle}</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              Nenhuma mensagem ainda. Diga oi! 👋
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] rounded-xl px-3 py-1.5',
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted rounded-bl-sm'
                  )}>
                    {!isMe && (
                      <div className="text-[10px] font-semibold opacity-70 mb-0.5">
                        {msg.sender_name}
                      </div>
                    )}
                    {renderMsgContent(msg, isMe)}
                    <div className={cn('text-[9px] mt-0.5', isMe ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                      {format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input area */}
        <div
          className={cn('shrink-0 border-t relative', dragOver && 'ring-2 ring-primary ring-inset bg-primary/5')}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <TeamChatEntityMention
            open={showEntityMention}
            onClose={() => setShowEntityMention(false)}
            onSelect={handleEntitySelect}
          />

          {isRecording ? (
            <div className="px-3 py-2 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-medium flex-1">
                Gravando... {formatDuration(recordingDuration)}
              </span>
              <Button size="icon" variant="destructive" className="h-8 w-8" onClick={stopRecording}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="px-2 py-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowEntityMention(!showEntityMention)}
                title="Mencionar lead/contato/atividade"
              >
                <Briefcase className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Enviar arquivo"
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                onChange={handleFileUpload}
              />

              <Input
                ref={messageInputRef}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite sua mensagem..."
                className="text-sm h-8 flex-1 min-w-0"
              />

              {messageText.trim() ? (
                <Button
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleSend}
                  disabled={sendingMessage || uploading}
                >
                  {(sendingMessage || uploading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={startRecording}
                  disabled={uploading}
                  title="Gravar áudio"
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // New chat selection
  if (showNewChat) {
    const otherProfiles = profiles.filter(p => p.user_id !== user?.id);
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowNewChat(false)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">Nova Conversa</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y">
            {otherProfiles.map(p => (
              <button
                key={p.user_id}
                onClick={async () => {
                  await startDirectChat(p.user_id);
                  setShowNewChat(false);
                }}
                className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">
                    {getInitials(p.full_name || p.email || '?')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.full_name || p.email}</div>
                  {p.email && p.full_name && (
                    <div className="text-[10px] text-muted-foreground truncate">{p.email}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Conversation list
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">Conversas</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={ensureGeneralChat}>
            <Users className="h-3.5 w-3.5" /> Geral
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowNewChat(true)}>
            <Plus className="h-3.5 w-3.5" /> Nova
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-xs text-center gap-2 px-6">
            <MessageCircle className="h-8 w-8 opacity-30" />
            <p>Nenhuma conversa ainda.<br/>Clique em <b>"Geral"</b> para o chat da equipe ou <b>"Nova"</b> para conversa direta.</p>
          </div>
        ) : (
          <div className="divide-y">
            {conversations.map(conv => {
              const title = conv.type === 'group' ? (conv.name || 'Grupo') : (conv.otherMemberName || 'Chat');
              const hasUnread = (conv.unreadCount || 0) > 0;
              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversationId(conv.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3',
                    hasUnread && 'bg-primary/5'
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs bg-primary/20 text-primary">
                      {conv.type === 'group' ? <Hash className="h-3.5 w-3.5" /> : getInitials(title)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{title}</span>
                      {conv.type === 'group' && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">grupo</Badge>
                      )}
                    </div>
                    {conv.lastMessage && (
                      <p className="text-[11px] text-muted-foreground truncate">{conv.lastMessage}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {conv.lastMessageAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(conv.lastMessageAt), 'dd/MM HH:mm', { locale: ptBR })}
                      </span>
                    )}
                    {hasUnread && (
                      <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
