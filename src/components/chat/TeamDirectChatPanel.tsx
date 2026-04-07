import { useState, useRef, useEffect } from 'react';
import { useTeamDirectChat } from '@/hooks/useTeamDirectChat';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Send, Users, MessageCircle, ArrowLeft, Loader2, Plus, Hash,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function TeamDirectChatPanel() {
  const { user } = useAuthContext();
  const {
    conversations, messages, activeConversationId, setActiveConversationId,
    loading, sendingMessage, sendMessage, startDirectChat, ensureGeneralChat,
  } = useTeamDirectChat();
  const profiles = useProfilesList();
  const [messageText, setMessageText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
                    'max-w-[80%] rounded-xl px-3 py-1.5',
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted rounded-bl-sm'
                  )}>
                    {!isMe && (
                      <div className="text-[10px] font-semibold opacity-70 mb-0.5">
                        {msg.sender_name}
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <div className={cn('text-[9px] mt-0.5', isMe ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                      {format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="shrink-0 px-3 py-2 border-t flex gap-2">
          <Input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            className="text-sm h-9"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={sendingMessage || !messageText.trim()}>
            {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
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
