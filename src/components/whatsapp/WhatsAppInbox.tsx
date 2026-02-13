import { useState } from 'react';
import { useWhatsAppMessages, WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { WhatsAppConversationList } from './WhatsAppConversationList';
import { WhatsAppChat } from './WhatsAppChat';
import { WhatsAppSetupGuide } from './WhatsAppSetupGuide';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Settings, RefreshCw, Smartphone } from 'lucide-react';

export function WhatsAppInbox() {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('all');
  const { conversations, loading, instances, sendMessage, markAsRead, linkToLead, linkToContact, refetch } = useWhatsAppMessages(selectedInstanceId);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const selectedConversation = conversations.find(c => c.phone === selectedPhone) || null;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  const handleSelectConversation = (conv: WhatsAppConversation) => {
    setSelectedPhone(conv.phone);
    if (conv.unread_count > 0) {
      markAsRead(conv.phone);
    }
  };

  if (showSetup) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b bg-card">
          <Button variant="ghost" size="sm" onClick={() => setShowSetup(false)}>← Voltar</Button>
          <h1 className="text-lg font-semibold">Configuração WhatsApp</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <WhatsAppSetupGuide />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-card shrink-0">
        <MessageSquare className="h-6 w-6 text-green-600" />
        <h1 className="text-lg font-semibold">WhatsApp</h1>
        {totalUnread > 0 && (
          <Badge variant="destructive" className="text-xs">{totalUnread}</Badge>
        )}

        {/* Instance selector */}
        {instances.length > 1 && (
          <Select value={selectedInstanceId} onValueChange={setSelectedInstanceId}>
            <SelectTrigger className="w-48 h-8 text-xs ml-2">
              <Smartphone className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Todas instâncias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas instâncias</SelectItem>
              {instances.map(inst => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.instance_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="icon" onClick={refetch} title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowSetup(true)} title="Configuração">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation List */}
        <div className="w-80 border-r flex-shrink-0 overflow-y-auto bg-card">
          <WhatsAppConversationList
            conversations={conversations}
            loading={loading}
            selectedPhone={selectedPhone}
            onSelect={handleSelectConversation}
          />
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedConversation ? (
            <WhatsAppChat
              conversation={selectedConversation}
              onSendMessage={sendMessage}
              onLinkToLead={linkToLead}
              onLinkToContact={linkToContact}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-muted/20">
              <div className="text-center space-y-3">
                <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/30" />
                <p className="text-muted-foreground">Selecione uma conversa</p>
                {conversations.length === 0 && !loading && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda</p>
                    <Button variant="outline" size="sm" onClick={() => setShowSetup(true)}>
                      Configurar integração
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}