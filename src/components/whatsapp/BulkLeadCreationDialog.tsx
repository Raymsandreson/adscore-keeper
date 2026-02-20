import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Users, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface TeamMemberOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface LeadRow {
  phone: string;
  contact_name: string | null;
  board_id: string;
  assigned_to: string;
  expanded: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedConversations: WhatsAppConversation[];
  boards: KanbanBoard[];
  onCreated: (leadIds: string[]) => void;
}

export function BulkLeadCreationDialog({ open, onOpenChange, selectedConversations, boards, onCreated }: Props) {
  const [globalBoardId, setGlobalBoardId] = useState<string>('');
  const [globalAssignedTo, setGlobalAssignedTo] = useState<string>('none');
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [members, setMembers] = useState<TeamMemberOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [applyGlobalBoard, setApplyGlobalBoard] = useState(true);
  const [applyGlobalAssignee, setApplyGlobalAssignee] = useState(true);

  // Fetch team members
  useEffect(() => {
    if (!open) return;
    const fetch = async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id');
      if (!roles?.length) return;
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', roles.map(r => r.user_id));
      setMembers(profiles || []);
    };
    fetch();
  }, [open]);

  // Initialize rows when dialog opens
  useEffect(() => {
    if (!open) return;
    const defaultBoard = boards.length === 1 ? boards[0].id : '';
    setGlobalBoardId(defaultBoard);
    setGlobalAssignedTo('none');
    setApplyGlobalBoard(true);
    setApplyGlobalAssignee(true);
    setRows(selectedConversations.map(c => ({
      phone: c.phone,
      contact_name: c.contact_name,
      board_id: defaultBoard,
      assigned_to: 'none',
      expanded: false,
    })));
  }, [open, selectedConversations, boards]);

  // When global changes, update rows that follow global
  useEffect(() => {
    if (applyGlobalBoard) {
      setRows(prev => prev.map(r => ({ ...r, board_id: globalBoardId })));
    }
  }, [globalBoardId, applyGlobalBoard]);

  useEffect(() => {
    if (applyGlobalAssignee) {
      setRows(prev => prev.map(r => ({ ...r, assigned_to: globalAssignedTo })));
    }
  }, [globalAssignedTo, applyGlobalAssignee]);

  const updateRow = (phone: string, updates: Partial<LeadRow>) => {
    setRows(prev => prev.map(r => r.phone === phone ? { ...r, ...updates } : r));
  };

  const toggleRowExpanded = (phone: string) => {
    setRows(prev => prev.map(r => r.phone === phone ? { ...r, expanded: !r.expanded } : r));
  };

  const removeRow = (phone: string) => {
    setRows(prev => prev.filter(r => r.phone !== phone));
  };

  const formatPhone = (phone: string) => {
    if (phone.length === 13) return `(${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    if (phone.length === 12) return `(${phone.slice(2, 4)}) ${phone.slice(4, 8)}-${phone.slice(8)}`;
    return phone;
  };

  const getMemberName = (userId: string) => {
    const m = members.find(m => m.user_id === userId);
    return m?.full_name || m?.email || 'Sem nome';
  };

  const allValid = rows.length > 0 && rows.every(r => r.board_id);

  const handleCreate = async () => {
    if (!allValid) return;
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const createdIds: string[] = [];

      for (const row of rows) {
        const conv = selectedConversations.find(c => c.phone === row.phone);
        const { data, error } = await supabase
          .from('leads')
          .insert({
            lead_name: row.contact_name || `Lead - ${formatPhone(row.phone)}`,
            source: 'whatsapp',
            created_by: row.assigned_to !== 'none' ? row.assigned_to : (user?.id || null),
            board_id: row.board_id,
          })
          .select('id')
          .single();

        if (error) {
          console.error('Error creating lead for', row.phone, error);
          continue;
        }

        createdIds.push(data.id);

        // Link messages to lead
        await supabase
          .from('whatsapp_messages')
          .update({ lead_id: data.id } as any)
          .eq('phone', row.phone);

        // Link to contact if exists
        if (conv?.contact_id) {
          await supabase
            .from('whatsapp_messages')
            .update({ contact_id: conv.contact_id } as any)
            .eq('phone', row.phone);
        }
      }

      toast.success(`${createdIds.length} lead${createdIds.length > 1 ? 's' : ''} criado${createdIds.length > 1 ? 's' : ''} com sucesso!`);
      onCreated(createdIds);
      onOpenChange(false);
    } catch (error) {
      console.error('Bulk create error:', error);
      toast.error('Erro ao criar leads em lote');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Criar Leads em Lote ({rows.length})
          </DialogTitle>
        </DialogHeader>

        {/* Global defaults */}
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Padrão para todos</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Funil *</Label>
              <Select value={globalBoardId} onValueChange={v => { setGlobalBoardId(v); setApplyGlobalBoard(true); }}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue placeholder="Selecione o funil" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Acolhedor</Label>
              <Select value={globalAssignedTo} onValueChange={v => { setGlobalAssignedTo(v); setApplyGlobalAssignee(true); }}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue placeholder="Sem acolhedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem acolhedor</SelectItem>
                  {members.map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Rows */}
        <ScrollArea className="flex-1 max-h-[400px] -mx-1">
          <div className="space-y-1 px-1">
            {rows.map((row) => (
              <div key={row.phone} className="border rounded-lg overflow-hidden">
                {/* Summary row */}
                <div
                  className="flex items-center gap-2 p-3 cursor-pointer hover:bg-accent/40 transition-colors"
                  onClick={() => toggleRowExpanded(row.phone)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {row.contact_name || formatPhone(row.phone)}
                    </p>
                    {row.contact_name && (
                      <p className="text-[10px] text-muted-foreground">{formatPhone(row.phone)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {row.board_id && (
                      <Badge variant="secondary" className="text-[10px]">
                        {boards.find(b => b.id === row.board_id)?.name}
                      </Badge>
                    )}
                    {row.assigned_to !== 'none' && (
                      <Badge variant="outline" className="text-[10px]">
                        {getMemberName(row.assigned_to)}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => { e.stopPropagation(); removeRow(row.phone); }}
                    >
                      ✕
                    </Button>
                    {row.expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>

                {/* Expanded - Individual overrides */}
                {row.expanded && (
                  <div className="border-t p-3 bg-muted/20 grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Funil individual</Label>
                      <Select
                        value={row.board_id}
                        onValueChange={v => { updateRow(row.phone, { board_id: v }); setApplyGlobalBoard(false); }}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {boards.map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Acolhedor individual</Label>
                      <Select
                        value={row.assigned_to}
                        onValueChange={v => { updateRow(row.phone, { assigned_to: v }); setApplyGlobalAssignee(false); }}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem acolhedor</SelectItem>
                          {members.map(m => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.full_name || m.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={!allValid || creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Criar {rows.length} Lead{rows.length > 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
