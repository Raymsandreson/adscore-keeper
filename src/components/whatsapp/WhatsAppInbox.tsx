import { useState } from 'react';
import { useWhatsAppMessages, WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { WhatsAppConversationList } from './WhatsAppConversationList';
import { WhatsAppChat } from './WhatsAppChat';
import { WhatsAppSetupGuide } from './WhatsAppSetupGuide';
import { WhatsAppActivitySheet } from './WhatsAppActivitySheet';
import { WhatsAppLeadsDashboard } from './WhatsAppLeadsDashboard';
import { GoogleIntegrationPanel } from '@/components/GoogleIntegrationPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MessageSquare, Settings, RefreshCw, Smartphone, BarChart3, Chrome } from 'lucide-react';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';

export function WhatsAppInbox() {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('all');
  const { conversations, loading, instances, sendMessage, markAsRead, linkToLead, linkToContact, refetch } = useWhatsAppMessages(selectedInstanceId);
  const { boards } = useKanbanBoards();
  const navigate = useNavigate();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showGooglePanel, setShowGooglePanel] = useState(false);
  // Side panel state
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [showLeadPanel, setShowLeadPanel] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);

  // Activity sheet state
  const [showActivitySheet, setShowActivitySheet] = useState(false);
  const [activityDefaults, setActivityDefaults] = useState<{ leadId?: string; leadName?: string; contactId?: string; contactName?: string }>({});
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');

  const selectedConversation = conversations.find(c => c.phone === selectedPhone) || null;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  const handleSelectConversation = (conv: WhatsAppConversation) => {
    setSelectedPhone(conv.phone);
    if (conv.unread_count > 0) {
      markAsRead(conv.phone);
    }
  };

  const handleCreateLead = () => {
    if (!selectedConversation) return;
    // If only one board, skip picker
    if (boards.length === 1) {
      createLeadWithBoard(boards[0].id);
    } else {
      setSelectedBoardId(boards[0]?.id || '');
      setShowBoardPicker(true);
    }
  };

  const createLeadWithBoard = async (boardId: string) => {
    if (!selectedConversation || !boardId) return;
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('leads')
        .insert({
          lead_name: selectedConversation.contact_name || 'Novo Lead - WhatsApp',
          source: 'whatsapp',
          created_by: currentUser?.id || null,
          board_id: boardId,
        })
        .select('*')
        .single();

      if (error) throw error;

      // Link to conversation
      linkToLead(selectedConversation.phone, data.id);

      // Open for editing with full form
      setEditingLead(data as Lead);
      setShowLeadPanel(true);
      setShowBoardPicker(false);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar lead');
    }
  };

  const handleCreateContact = async () => {
    if (!selectedConversation) return;
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          full_name: selectedConversation.contact_name || 'Novo Contato',
          phone: selectedConversation.phone,
          created_by: currentUser?.id || null,
        })
        .select('*')
        .single();

      if (error) throw error;

      // Link to conversation
      linkToContact(selectedConversation.phone, data.id);

      // Open for editing with full form
      setEditingContact(data as Contact);
      setShowContactPanel(true);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar contato');
    }
  };

  const handleSaveLead = async (leadId: string, updates: Partial<Lead>) => {
    const { error } = await supabase
      .from('leads')
      .update(updates as any)
      .eq('id', leadId);
    if (error) throw error;
  };

  const handleCloseLeadPanel = (open: boolean) => {
    if (!open) {
      setShowLeadPanel(false);
      setEditingLead(null);
      refetch();
    }
  };

  const handleCloseContactPanel = (open: boolean) => {
    if (!open) {
      setShowContactPanel(false);
      setEditingContact(null);
      refetch();
    }
  };

  const handleCreateActivity = (leadId: string, leadName: string, contactId?: string, contactName?: string) => {
    setActivityDefaults({ leadId, leadName, contactId, contactName });
    setShowActivitySheet(true);
  };

  const handleNavigateToLead = async (leadId: string) => {
    // Open lead in edit dialog instead of navigating away
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (data) {
      setEditingLead(data as Lead);
      setShowLeadPanel(true);
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

  if (showDashboard) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b bg-card">
          <Button variant="ghost" size="sm" onClick={() => setShowDashboard(false)}>← Voltar</Button>
          <h1 className="text-lg font-semibold">Dashboard de Leads</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <WhatsAppLeadsDashboard />
        </div>
      </div>
    );
  }

  if (showGooglePanel) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center gap-3 p-4 border-b bg-card">
          <Button variant="ghost" size="sm" onClick={() => setShowGooglePanel(false)}>← Voltar</Button>
          <h1 className="text-lg font-semibold">Google Workspace</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 max-w-xl mx-auto w-full">
          <GoogleIntegrationPanel />
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
          <Button variant="ghost" size="icon" onClick={() => setShowGooglePanel(true)} title="Google Workspace">
            <Chrome className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowDashboard(true)} title="Dashboard">
            <BarChart3 className="h-4 w-4" />
          </Button>
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
            boards={boards}
            selectedInstanceId={selectedInstanceId}
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
              onCreateLead={handleCreateLead}
              onCreateContact={handleCreateContact}
              onCreateActivity={handleCreateActivity}
              onNavigateToLead={handleNavigateToLead}
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

      {/* Lead Edit Panel - Full form with all tabs + AI */}
      <LeadEditDialog
        open={showLeadPanel}
        onOpenChange={handleCloseLeadPanel}
        lead={editingLead}
        onSave={handleSaveLead}
        boards={boards}
        mode="sheet"
      />

      {/* Contact Detail Panel - Full form with all fields */}
      <ContactDetailSheet
        contact={editingContact}
        open={showContactPanel}
        onOpenChange={handleCloseContactPanel}
        onContactUpdated={() => refetch()}
        mode="sheet"
      />

      {/* Activity Creation Sheet */}
      <WhatsAppActivitySheet
        open={showActivitySheet}
        onOpenChange={setShowActivitySheet}
        defaultLeadId={activityDefaults.leadId}
        defaultLeadName={activityDefaults.leadName}
        defaultContactId={activityDefaults.contactId}
        defaultContactName={activityDefaults.contactName}
      />

      {/* Board Picker Dialog */}
      <Dialog open={showBoardPicker} onOpenChange={setShowBoardPicker}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Selecionar Funil</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label>Funil *</Label>
            <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Selecione um funil" />
              </SelectTrigger>
              <SelectContent>
                {boards.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBoardPicker(false)}>Cancelar</Button>
            <Button onClick={() => createLeadWithBoard(selectedBoardId)} disabled={!selectedBoardId}>
              Criar Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
