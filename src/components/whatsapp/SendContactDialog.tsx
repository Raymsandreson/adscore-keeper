/**
 * "Contato" do menu de anexo — igual ao compartilhar contato do app do
 * WhatsApp: busca um lead da base (nome/telefone) ou digita manualmente, e
 * envia como vCard clicável (UazAPI /send/contact via edge send-whatsapp).
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, Send, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/integrations/supabase';
import {
  AttachSendTarget,
  isCloudChannelInstance,
  sendWhatsAppContact,
} from '@/lib/whatsappAttachSend';

interface LeadOption {
  id: string;
  lead_name: string | null;
  lead_phone: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AttachSendTarget;
  /** Host adiciona a bolha otimista na própria lista de mensagens. */
  onSent?: (info: { messageText: string; messageType: 'contact' }) => void;
}

export function SendContactDialog({ open, onOpenChange, target, onSent }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setResults([]);
      setManualName('');
      setManualPhone('');
      setSending(false);
    }
  }, [open]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const digits = term.replace(/\D/g, '');
        const filters = [`lead_name.ilike.%${term}%`];
        if (digits.length >= 4) filters.push(`lead_phone.ilike.%${digits}%`);
        const { data, error } = await (db as any)
          .from('leads')
          .select('id, lead_name, lead_phone')
          .or(filters.join(','))
          .not('lead_phone', 'is', null)
          .limit(10);
        if (error) throw error;
        if (!cancelled) setResults((data as LeadOption[]) || []);
      } catch (e) {
        console.error('[SendContactDialog] busca falhou', e);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  const doSend = async (fullName: string, phoneNumber: string) => {
    if (sending) return;
    if (isCloudChannelInstance(target.instanceName)) {
      toast.error('Envio de contato não é suportado no canal Cloud API (Meta).');
      return;
    }
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
    if (!fullName.trim() || cleanPhone.replace(/\D/g, '').length < 8) {
      toast.error('Informe nome e um telefone válido.');
      return;
    }
    setSending(true);
    try {
      await sendWhatsAppContact(target, { fullName: fullName.trim(), phoneNumber: cleanPhone });
      toast.success('Contato enviado!');
      onSent?.({ messageText: `👤 ${fullName.trim()}\n${cleanPhone}`, messageType: 'contact' });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[SendContactDialog] envio falhou', e);
      toast.error('Erro ao enviar contato: ' + (e?.message || 'Erro desconhecido'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5" /> Compartilhar contato
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar lead por nome ou telefone..."
              className="pl-8"
            />
          </div>
          {searching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
            </div>
          )}
          {results.length > 0 && (
            <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
              {results.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  disabled={sending}
                  onClick={() => doSend(lead.lead_name || 'Contato', lead.lead_phone || '')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{lead.lead_name || '(sem nome)'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{lead.lead_phone}</span>
                </button>
              ))}
            </div>
          )}
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Ou digite o contato manualmente:</p>
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="João Silva" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Telefone (com DDD)</Label>
              <Input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="5584999999999" className="h-8 text-sm" />
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700 gap-2"
              disabled={sending || !manualName.trim() || !manualPhone.trim()}
              onClick={() => doSend(manualName, manualPhone)}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar contato
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
