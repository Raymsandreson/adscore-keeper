import { useState, useRef, useEffect, useMemo } from 'react';
import { useTeamChat, useTeamMembers, TeamMember } from '@/hooks/useTeamChat';
import { useAuthContext } from '@/contexts/AuthContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Loader2, AtSign, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface TeamChatPanelProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  highlightMessageId?: string | null;
}

export function TeamChatPanel({ entityType, entityId, entityName, highlightMessageId }: TeamChatPanelProps) {
  const { user } = useAuthContext();
  const { messages, loading, sendMessage } = useTeamChat(entityType, entityId, entityName);
  const members = useTeamMembers();
  const draftKey = `team-chat-draft-${entityType}-${entityId}`;
  const [inputText, setInputText] = useState(() => sessionStorage.getItem(draftKey) || '');
  const [sending, setSending] = useState(false);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom or highlighted message
  useEffect(() => {
    if (highlightMessageId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, highlightMessageId]);

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

    // Find the last @ that could be a mention trigger
    const cursorPos = inputRef.current?.selectionStart || value.length;
    let atIdx = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (value[i] === '@') {
        atIdx = i;
        break;
      }
    }

    if (atIdx >= 0) {
      const afterAt = value.slice(atIdx + 1, cursorPos);
      // Allow spaces in the filter (for multi-word names), max 40 chars
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

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);

    // Extract mentions from text
    const mentionedIds = [...selectedMentions];
    // Also detect @name patterns and match to members
    const mentionRegex = /@([^\s@]+(?:\s[^\s@]+)?)/g;
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionName = match[1].toLowerCase();
      const found = members.find(m =>
        m.full_name?.toLowerCase() === mentionName ||
        m.email?.toLowerCase() === mentionName
      );
      if (found && !mentionedIds.includes(found.user_id)) {
        mentionedIds.push(found.user_id);
      }
    }

    await sendMessage(text, mentionedIds);
    setInputText('');
    sessionStorage.removeItem(draftKey);
    setSelectedMentions([]);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderContent = (content: string) => {
    // Highlight @mentions
    return content.replace(/@([^\s@]+(?:\s[^\s@]+)?)/g, (match) => match);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
                className={cn(
                  "flex",
                  isMe ? "justify-end" : "justify-start"
                )}
              >
                <div className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  isMe
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted rounded-bl-md",
                  isHighlighted && "ring-2 ring-yellow-400 animate-pulse"
                )}>
                  {!isMe && (
                    <div className="text-[10px] font-semibold mb-0.5 opacity-70">
                      {msg.sender_name || 'Usuário'}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[13px]">
                    {msg.content.split(/(@\S+(?:\s\S+)?)/).map((part, i) =>
                      part.startsWith('@') ? (
                        <span key={i} className={cn(
                          "font-semibold",
                          isMe ? "text-primary-foreground/90 underline" : "text-primary"
                        )}>{part}</span>
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )}
                  </p>
                  <div className={cn(
                    "text-[9px] mt-0.5",
                    isMe ? "text-primary-foreground/60 text-right" : "text-muted-foreground"
                  )}>
                    {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Mention dropdown */}
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

      {/* Input */}
      <div className="shrink-0 px-3 py-2 border-t bg-muted/30 flex items-center gap-2">
        <Input
          ref={inputRef}
          value={inputText}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Mensagem... use @nome para mencionar"
          className="flex-1 text-sm h-9"
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
  );
}
