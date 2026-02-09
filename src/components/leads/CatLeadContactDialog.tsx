import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Phone, MessageSquare, Mail, Clock, User } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuthContext } from '@/contexts/AuthContext';
import type { CatLead, CatLeadContact } from '@/hooks/useCatLeads';

type AddContactPayload = Omit<CatLeadContact, 'id' | 'created_at'>;

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { value: 'phone', label: 'Telefone', icon: Phone },
  { value: 'email', label: 'E-mail', icon: Mail },
];

const RESULTS = [
  { value: 'no_answer', label: 'Sem resposta', color: 'bg-yellow-500' },
  { value: 'interested', label: 'Interessado', color: 'bg-green-500' },
  { value: 'not_interested', label: 'Não interessado', color: 'bg-red-500' },
  { value: 'wrong_number', label: 'Número errado', color: 'bg-gray-500' },
  { value: 'callback', label: 'Retornar depois', color: 'bg-blue-500' },
  { value: 'voicemail', label: 'Caixa postal', color: 'bg-orange-500' },
];

interface CatLeadContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catLead: CatLead;
  contacts: CatLeadContact[];
  onAddContact: (contact: AddContactPayload) => Promise<void>;
  onRefresh: () => void;
}

export function CatLeadContactDialog({
  open,
  onOpenChange,
  catLead,
  contacts,
  onAddContact,
  onRefresh,
}: CatLeadContactDialogProps) {
  const { user } = useAuthContext();
  const [channel, setChannel] = useState('whatsapp');
  const [result, setResult] = useState('no_answer');
  const [phoneUsed, setPhoneUsed] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Available phones
  const phones = [
    catLead.celular_1, catLead.celular_2, catLead.celular_3, catLead.celular_4,
    catLead.fixo_1, catLead.fixo_2, catLead.fixo_3, catLead.fixo_4,
  ].filter(Boolean) as string[];

  useEffect(() => {
    if (phones.length > 0 && !phoneUsed) {
      setPhoneUsed(phones[0]);
    }
  }, [phones]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onAddContact({
        cat_lead_id: catLead.id,
        contacted_by: user?.id || null,
        contact_channel: channel,
        contact_result: result,
        phone_used: phoneUsed || null,
        notes: notes || null,
        next_action: null,
        next_action_date: null,
      });
      setNotes('');
      setResult('no_answer');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const resultLabel = (val: string) => RESULTS.find(r => r.value === val);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Contato - {catLead.nome_completo}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info summary */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
            <p><strong>Município:</strong> {catLead.municipio}/{catLead.uf}</p>
            <p><strong>Acidente:</strong> {catLead.natureza_lesao} - {catLead.parte_corpo_atingida}</p>
            {catLead.indica_obito && (
              <Badge variant="destructive" className="text-xs">Óbito</Badge>
            )}
          </div>

          {/* New contact form */}
          <div className="space-y-3 border rounded-lg p-3">
            <h4 className="text-sm font-semibold">Registrar novo contato</h4>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Canal</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <div className="flex items-center gap-2">
                          <c.icon className="h-3.5 w-3.5" />
                          {c.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Resultado</Label>
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESULTS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {phones.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Telefone usado</Label>
                <Select value={phoneUsed} onValueChange={setPhoneUsed}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {phones.map((p, i) => (
                      <SelectItem key={i} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Detalhes do contato..."
                className="min-h-[60px]"
                maxLength={1000}
              />
            </div>

            <Button onClick={handleSubmit} disabled={saving} size="sm" className="w-full">
              {saving ? 'Salvando...' : 'Registrar contato'}
            </Button>
          </div>

          {/* Contact history */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Histórico ({contacts.length})
            </h4>
            {contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum contato registrado ainda</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {contacts.map(c => {
                  const rl = resultLabel(c.contact_result);
                  const ch = CHANNELS.find(x => x.value === c.contact_channel);
                  return (
                    <div key={c.id} className="border rounded-lg p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {ch && <ch.icon className="h-3.5 w-3.5" />}
                          <span className="font-medium">{ch?.label}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {rl?.label}
                          </Badge>
                        </div>
                        <span className="text-muted-foreground">
                          {format(new Date(c.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      {c.phone_used && (
                        <p className="text-muted-foreground">📞 {c.phone_used}</p>
                      )}
                      {c.notes && <p>{c.notes}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
