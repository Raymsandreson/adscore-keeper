import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Loader2, UserPlus, Check, Users, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

interface ContactSuggestion {
  phone: string;
  suggested_name: string;
  message_count: number;
  instances_seen: string[];
  conversation_preview: string;
  // User editable
  final_name: string;
  should_create: boolean;
}

interface SyncResult {
  linked_existing: number;
  already_linked: number;
  needs_creation: { phone: string; jid: string }[];
  skipped_instances: number;
}

interface GroupContactSyncDialogProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  groupJid: string;
  groupName?: string;
  instanceId?: string;
}

export function GroupContactSyncDialog({
  open, onClose, leadId, leadName, groupJid, groupName, instanceId
}: GroupContactSyncDialogProps) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [phase, setPhase] = useState<'loading' | 'results' | 'done'>('loading');

  const startSync = async () => {
    setLoading(true);
    setPhase('loading');
    try {
      const { data, error } = await cloudFunctions.invoke('sync-group-contacts', {
        body: { group_jid: groupJid, lead_id: leadId, instance_id: instanceId },
      });

      if (error || !data?.success) {
        toast.error('Erro ao sincronizar: ' + (data?.error || error?.message || 'Desconhecido'));
        onClose();
        return;
      }

      setSyncResult(data.results);
      setSuggestions(
        (data.contact_suggestions || []).map((s: any) => ({
          ...s,
          final_name: s.suggested_name || '',
          should_create: true,
        }))
      );
      setPhase('results');

      if (data.results.linked_existing > 0) {
        toast.success(`${data.results.linked_existing} contato(s) existente(s) vinculado(s) ao lead`);
      }
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || 'Falha na sincronização'));
      onClose();
    }
    setLoading(false);
  };

  const handleCreateContacts = async () => {
    const toCreate = suggestions.filter(s => s.should_create && s.final_name.trim());
    if (toCreate.length === 0) {
      toast.info('Nenhum contato para criar');
      onClose();
      return;
    }

    setSyncing(true);
    let created = 0;

    // Get current user for created_by
    const { data: { user: authUser } } = await supabase.auth.getUser();

    // Get lead data to inherit location info
    let leadCity: string | null = null;
    let leadState: string | null = null;
    if (leadId) {
      const { data: leadData } = await supabase
        .from('leads')
        .select('city, state')
        .eq('id', leadId)
        .maybeSingle();
      leadCity = leadData?.city || null;
      leadState = leadData?.state || null;
    }

    for (const s of toCreate) {
      try {
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: s.final_name.trim(),
            phone: s.phone,
            source: 'whatsapp_group',
            classification: 'prospect',
            whatsapp_group_id: groupJid || null,
            lead_id: leadId || null,
            city: leadCity,
            state: leadState,
            created_by: authUser?.id || null,
          })
          .select('id')
          .single();

        if (createError || !newContact) {
          console.error('Error creating contact:', createError);
          continue;
        }

        // Link to lead
        await supabase
          .from('contact_leads')
          .insert({ contact_id: newContact.id, lead_id: leadId });

        created++;
      } catch (e) {
        console.error('Error creating contact:', e);
      }
    }

    toast.success(`${created} contato(s) criado(s) e vinculado(s) ao lead`);
    setPhase('done');
    setSyncing(false);
    onClose();
  };

  // Auto-start sync when dialog opens
  useEffect(() => {
    if (open && groupJid) {
      startSync();
    }
  }, [open, groupJid]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Sincronizar Contatos do Grupo
            {groupName && <Badge variant="outline" className="text-xs">{groupName}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Buscando participantes do grupo e cruzando com contatos existentes...
            </p>
          </div>
        )}

        {phase === 'results' && syncResult && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200">
                <p className="text-2xl font-bold text-green-600">{syncResult.linked_existing}</p>
                <p className="text-xs text-muted-foreground">Vinculados</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200">
                <p className="text-2xl font-bold text-blue-600">{syncResult.already_linked}</p>
                <p className="text-xs text-muted-foreground">Já vinculados</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200">
                <p className="text-2xl font-bold text-amber-600">{suggestions.length}</p>
                <p className="text-xs text-muted-foreground">Novos contatos</p>
              </div>
            </div>

            {/* New contacts to create */}
            {suggestions.length > 0 ? (
              <>
                <p className="text-sm font-medium">
                  Novos contatos encontrados — confirme os nomes para cadastrar:
                </p>
                <ScrollArea className="max-h-[350px]">
                  <div className="space-y-2">
                    {suggestions.map((s, idx) => (
                      <div
                        key={s.phone}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          s.should_create ? 'bg-background' : 'bg-muted/40 opacity-60'
                        }`}
                      >
                        <Switch
                          checked={s.should_create}
                          onCheckedChange={(v) => {
                            setSuggestions(prev => prev.map((item, i) =>
                              i === idx ? { ...item, should_create: v } : item
                            ));
                          }}
                        />
                        <div className="flex-1 space-y-1">
                          <Input
                            value={s.final_name}
                            onChange={(e) => {
                              setSuggestions(prev => prev.map((item, i) =>
                                i === idx ? { ...item, final_name: e.target.value } : item
                              ));
                            }}
                            placeholder="Nome do contato"
                            className="h-8"
                            disabled={!s.should_create}
                          />
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            <span className="font-mono">{s.phone}</span>
                            {s.message_count > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                {s.message_count} msgs em {s.instances_seen.length} instância(s)
                              </Badge>
                            )}
                            {s.suggested_name && s.suggested_name !== s.final_name && (
                              <Badge
                                variant="outline"
                                className="text-[10px] cursor-pointer"
                                onClick={() => {
                                  setSuggestions(prev => prev.map((item, i) =>
                                    i === idx ? { ...item, final_name: s.suggested_name } : item
                                  ));
                                }}
                              >
                                Sugestão: {s.suggested_name}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Todos os participantes já são contatos conhecidos! ✅
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {phase === 'results' && suggestions.length > 0 ? 'Pular' : 'Fechar'}
          </Button>
          {phase === 'results' && suggestions.filter(s => s.should_create).length > 0 && (
            <Button onClick={handleCreateContacts} disabled={syncing} className="gap-1">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Criar {suggestions.filter(s => s.should_create && s.final_name.trim()).length} contato(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
