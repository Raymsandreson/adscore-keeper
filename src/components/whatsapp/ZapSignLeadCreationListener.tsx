import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileSignature, UserPlus, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface SignedDoc {
  id: string;
  document_name: string;
  signer_name: string | null;
  signer_phone: string | null;
  whatsapp_phone: string | null;
  lead_id: string | null;
  contact_id: string | null;
  instance_name: string | null;
  created_by: string | null;
}

interface Board {
  id: string;
  name: string;
  stages: any;
}

export function ZapSignLeadCreationListener() {
  const { user } = useAuthContext();
  const [pendingDoc, setPendingDoc] = useState<SignedDoc | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [creating, setCreating] = useState(false);
  const [dismissedDocs, setDismissedDocs] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('zapsign_dismissed_docs');
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const persistDismissed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem('zapsign_dismissed_docs', JSON.stringify(Array.from(next).slice(-200)));
    } catch {}
  }, []);

  // Load boards on demand
  const loadBoards = useCallback(async () => {
    const { data } = await supabase
      .from('kanban_boards')
      .select('id, name, stages')
      .order('display_order');
    if (data) {
      setBoards(data.filter((b: any) => !b.board_type || b.board_type === 'funnel') as Board[]);
    }
  }, []);

  // Listen for zapsign_documents changes to 'signed'
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('zapsign-signed-listener')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'zapsign_documents',
        },
        (payload) => {
          const doc = payload.new as any;
          // Only trigger for docs that just became signed, have no lead, and were created by current user
          if (
            doc.status === 'signed' &&
            !doc.lead_id &&
            doc.created_by === user.id &&
            !dismissedDocs.has(doc.id)
          ) {
            setPendingDoc({
              id: doc.id,
              document_name: doc.document_name,
              signer_name: doc.signer_name,
              signer_phone: doc.signer_phone,
              whatsapp_phone: doc.whatsapp_phone,
              lead_id: doc.lead_id,
              contact_id: doc.contact_id,
              instance_name: doc.instance_name,
              created_by: doc.created_by,
            });
            loadBoards();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, dismissedDocs, loadBoards]);

  const handleCreate = async () => {
    if (!pendingDoc || !selectedBoardId || !user?.id) return;

    setCreating(true);
    try {
      // Re-fetch doc to avoid acting on stale realtime payload (other tab/another click already created)
      const { data: freshDoc } = await supabase
        .from('zapsign_documents')
        .select('id, lead_id, contact_id, status')
        .eq('id', pendingDoc.id)
        .maybeSingle();

      if (freshDoc?.lead_id) {
        toast.info('Lead já criado para este contrato.');
        const next = new Set(dismissedDocs).add(pendingDoc.id);
        setDismissedDocs(next);
        persistDismissed(next);
        setPendingDoc(null);
        setSelectedBoardId('');
        return;
      }

      const board = boards.find(b => b.id === selectedBoardId);
      const stages = Array.isArray(board?.stages) ? board.stages : [];
      const lastStage = stages[stages.length - 1];

      const phone = (pendingDoc.whatsapp_phone || pendingDoc.signer_phone || '').replace(/\D/g, '');
      const contactName = pendingDoc.signer_name || `Contato ${phone}`;

      // 1. Find or create contact
      let contactId = freshDoc?.contact_id || pendingDoc.contact_id;
      if (!contactId && phone) {
        const last8 = phone.slice(-8);
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .like('phone', `%${last8}`)
          .limit(1)
          .maybeSingle();

        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact, error: contactErr } = await supabase
            .from('contacts')
            .insert({
              full_name: contactName,
              phone,
              created_by: user.id,
            })
            .select('id')
            .single();

          if (contactErr) throw contactErr;
          contactId = newContact.id;
        }
      }

      // 2. Create lead as closed
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          lead_name: contactName,
          lead_phone: phone || null,
          board_id: selectedBoardId,
          status: lastStage?.id || null,
          lead_status: 'closed',
          acolhedor: user.id,
          created_by: user.id,
          action_source: 'manual',
        })
        .select('id')
        .single();

      if (leadErr) throw leadErr;

      // 3. Link contact to lead (idempotent via unique constraint)
      if (contactId && newLead) {
        await supabase
          .from('contact_leads')
          .upsert(
            { contact_id: contactId, lead_id: newLead.id },
            { onConflict: 'contact_id,lead_id', ignoreDuplicates: true }
          );

        await supabase
          .from('contacts')
          .update({ lead_id: newLead.id })
          .eq('id', contactId);
      }

      // 4. Mark zapsign doc as processed (critical: blocks reopen)
      await supabase
        .from('zapsign_documents')
        .update({ lead_id: newLead.id, contact_id: contactId })
        .eq('id', pendingDoc.id)
        .is('lead_id', null); // only update if still null — prevents racing overwrite

      toast.success(`Lead "${contactName}" criado como fechado no funil "${board?.name}"!`);
      const next = new Set(dismissedDocs).add(pendingDoc.id);
      setDismissedDocs(next);
      persistDismissed(next);
      setPendingDoc(null);
      setSelectedBoardId('');
    } catch (err: any) {
      console.error('Error creating lead from signed doc:', err);
      toast.error('Erro ao criar lead: ' + (err.message || 'Tente novamente'));
    } finally {
      setCreating(false);
    }
  };

  const handleDismiss = () => {
    if (pendingDoc) {
      const next = new Set(dismissedDocs).add(pendingDoc.id);
      setDismissedDocs(next);
      persistDismissed(next);
    }
    setPendingDoc(null);
    setSelectedBoardId('');
  };

  if (!pendingDoc) return null;

  const phone = pendingDoc.whatsapp_phone || pendingDoc.signer_phone || '';

  return (
    <Dialog open={!!pendingDoc} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-green-600" />
            Contrato Assinado!
          </DialogTitle>
          <DialogDescription>
            Um contrato foi assinado. Deseja criar o lead e contato vinculado?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Doc info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
                <CheckCircle className="h-3 w-3 mr-1" />
                Assinado
              </Badge>
            </div>
            <p className="text-sm font-medium">{pendingDoc.document_name}</p>
            {pendingDoc.signer_name && (
              <p className="text-xs text-muted-foreground">
                Assinante: {pendingDoc.signer_name}
              </p>
            )}
            {phone && (
              <p className="text-xs text-muted-foreground">
                Telefone: {phone}
              </p>
            )}
          </div>

          {/* Board selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Funil de Vendas</label>
            <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o funil..." />
              </SelectTrigger>
              <SelectContent>
                {boards.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              O lead será criado na última etapa do funil como <strong>fechado</strong>.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleDismiss} disabled={creating}>
            Não criar
          </Button>
          <Button onClick={handleCreate} disabled={!selectedBoardId || creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <UserPlus className="h-4 w-4 mr-2" />
            )}
            Criar Lead + Contato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
