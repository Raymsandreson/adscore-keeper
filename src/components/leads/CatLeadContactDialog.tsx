import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Phone, MessageSquare, Mail, Clock, User, UserPlus, ExternalLink, Save, CheckCircle2, Pencil, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { CatLead, CatLeadContact } from '@/hooks/useCatLeads';
import { CreateLeadFromCatDialog } from './CreateLeadFromCatDialog';

type AddContactPayload = Omit<CatLeadContact, 'id' | 'created_at'>;

interface ProfileOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

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
  onUpdateCatLead?: (id: string, updates: Partial<CatLead>) => Promise<void>;
}

export function CatLeadContactDialog({
  open,
  onOpenChange,
  catLead,
  contacts,
  onAddContact,
  onRefresh,
  onUpdateCatLead,
}: CatLeadContactDialogProps) {
  const { user } = useAuthContext();
  const [channel, setChannel] = useState('whatsapp');
  const [result, setResult] = useState('no_answer');
  const [phoneUsed, setPhoneUsed] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [contactedBy, setContactedBy] = useState(user?.id || '');
  const [teamProfiles, setTeamProfiles] = useState<ProfileOption[]>([]);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [saveAsCorrect, setSaveAsCorrect] = useState(false);
  const [customPhone, setCustomPhone] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  // Editable CAT fields
  const [editNomeCompleto, setEditNomeCompleto] = useState(catLead.nome_completo);
  const [editMunicipio, setEditMunicipio] = useState(catLead.municipio || '');
  const [editUf, setEditUf] = useState(catLead.uf || '');
  const [editNaturezaLesao, setEditNaturezaLesao] = useState(catLead.natureza_lesao || '');
  const [editParteCorpo, setEditParteCorpo] = useState(catLead.parte_corpo_atingida || '');
  const [editCnpj, setEditCnpj] = useState(catLead.cnpj_cei_empregador || '');
  const [editCpf, setEditCpf] = useState(catLead.cpf || '');
  const [editEndereco, setEditEndereco] = useState(catLead.endereco || '');
  const [editBairro, setEditBairro] = useState(catLead.bairro || '');
  const [editCep, setEditCep] = useState(catLead.cep || '');
  const [editCatNotes, setEditCatNotes] = useState(catLead.notes || '');
  const [editCelular1, setEditCelular1] = useState(catLead.celular_1 || '');
  const [editCelular2, setEditCelular2] = useState(catLead.celular_2 || '');
  const [editCelular3, setEditCelular3] = useState(catLead.celular_3 || '');
  const [editCelular4, setEditCelular4] = useState(catLead.celular_4 || '');
  const [savingCat, setSavingCat] = useState(false);

  // Sync state when catLead prop changes
  useEffect(() => {
    setEditNomeCompleto(catLead.nome_completo);
    setEditMunicipio(catLead.municipio || '');
    setEditUf(catLead.uf || '');
    setEditNaturezaLesao(catLead.natureza_lesao || '');
    setEditParteCorpo(catLead.parte_corpo_atingida || '');
    setEditCnpj(catLead.cnpj_cei_empregador || '');
    setEditCpf(catLead.cpf || '');
    setEditEndereco(catLead.endereco || '');
    setEditBairro(catLead.bairro || '');
    setEditCep(catLead.cep || '');
    setEditCatNotes(catLead.notes || '');
    setEditCelular1(catLead.celular_1 || '');
    setEditCelular2(catLead.celular_2 || '');
    setEditCelular3(catLead.celular_3 || '');
    setEditCelular4(catLead.celular_4 || '');
  }, [catLead]);

  const handleSaveCatChanges = async () => {
    if (!onUpdateCatLead) return;
    setSavingCat(true);
    try {
      await onUpdateCatLead(catLead.id, {
        nome_completo: editNomeCompleto,
        municipio: editMunicipio || null,
        uf: editUf || null,
        natureza_lesao: editNaturezaLesao || null,
        parte_corpo_atingida: editParteCorpo || null,
        cnpj_cei_empregador: editCnpj || null,
        cpf: editCpf || null,
        endereco: editEndereco || null,
        bairro: editBairro || null,
        cep: editCep || null,
        notes: editCatNotes || null,
        celular_1: editCelular1 || null,
        celular_2: editCelular2 || null,
        celular_3: editCelular3 || null,
        celular_4: editCelular4 || null,
      });
      onRefresh();
    } finally {
      setSavingCat(false);
    }
  };

  // Fetch team profiles
  useEffect(() => {
    const fetchProfiles = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .order('full_name');
      if (data) setTeamProfiles(data);
    };
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (user?.id && !contactedBy) setContactedBy(user.id);
  }, [user]);

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
        contacted_by: contactedBy || user?.id || null,
        contact_channel: channel,
        contact_result: result,
        phone_used: phoneUsed || null,
        notes: notes || null,
        next_action: null,
        next_action_date: null,
      });
      // Save correct phone if toggled
      if (saveAsCorrect && phoneUsed && onUpdateCatLead) {
        await onUpdateCatLead(catLead.id, { celular_1: phoneUsed });
      }
      setNotes('');
      setResult('no_answer');
      setSaveAsCorrect(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomPhone = async () => {
    if (!customPhone.trim() || !onUpdateCatLead) return;
    setSavingPhone(true);
    try {
      await onUpdateCatLead(catLead.id, { celular_1: customPhone.trim() });
      setCustomPhone('');
      onRefresh();
    } finally {
      setSavingPhone(false);
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
          {/* Editable CAT fields */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Pencil className="h-3.5 w-3.5" />
                  Editar dados da CAT
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="border rounded-lg p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome completo</Label>
                  <Input value={editNomeCompleto} onChange={e => setEditNomeCompleto(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">CPF</Label>
                    <Input value={editCpf} onChange={e => setEditCpf(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CNPJ Empregador</Label>
                    <Input value={editCnpj} onChange={e => setEditCnpj(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">Município</Label>
                    <Input value={editMunicipio} onChange={e => setEditMunicipio(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">UF</Label>
                    <Input value={editUf} onChange={e => setEditUf(e.target.value)} className="h-9 text-sm" maxLength={2} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Natureza Lesão</Label>
                    <Input value={editNaturezaLesao} onChange={e => setEditNaturezaLesao(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Parte do corpo</Label>
                    <Input value={editParteCorpo} onChange={e => setEditParteCorpo(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Endereço</Label>
                  <Input value={editEndereco} onChange={e => setEditEndereco(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bairro</Label>
                    <Input value={editBairro} onChange={e => setEditBairro(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CEP</Label>
                    <Input value={editCep} onChange={e => setEditCep(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Óbito</Label>
                    <div className="h-9 flex items-center">
                      {catLead.indica_obito ? (
                        <Badge variant="destructive" className="text-xs">Sim</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Não</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Celular 1 (principal)</Label>
                    <Input value={editCelular1} onChange={e => setEditCelular1(e.target.value)} className="h-9 text-sm" placeholder="Ex: 21999999999" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Celular 2</Label>
                    <Input value={editCelular2} onChange={e => setEditCelular2(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Celular 3</Label>
                    <Input value={editCelular3} onChange={e => setEditCelular3(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Celular 4</Label>
                    <Input value={editCelular4} onChange={e => setEditCelular4(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Observações da CAT</Label>
                  <Textarea value={editCatNotes} onChange={e => setEditCatNotes(e.target.value)} placeholder="Anotações sobre esta CAT..." className="min-h-[50px] text-sm" />
                </div>
                <Button onClick={handleSaveCatChanges} disabled={savingCat} size="sm" className="w-full gap-2">
                  <Save className="h-3.5 w-3.5" />
                  {savingCat ? 'Salvando...' : 'Salvar alterações'}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

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

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                Responsável
              </Label>
              <Select value={contactedBy} onValueChange={setContactedBy}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecionar responsável" />
                </SelectTrigger>
                <SelectContent>
                  {teamProfiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email?.split('@')[0] || 'Usuário'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            {phones.length > 0 && phoneUsed && (
              <div className="flex items-center gap-2">
                <Switch checked={saveAsCorrect} onCheckedChange={setSaveAsCorrect} id="save-correct" />
                <Label htmlFor="save-correct" className="text-xs cursor-pointer">
                  Salvar "{phoneUsed}" como telefone principal
                </Label>
              </div>
            )}

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
                  const responsavel = teamProfiles.find(p => p.user_id === c.contacted_by);
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
                      {responsavel && (
                        <p className="text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {responsavel.full_name || responsavel.email?.split('@')[0] || 'Usuário'}
                        </p>
                      )}
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

          {/* Create Lead action */}
          <div className="border-t pt-3">
            {catLead.lead_id ? (
              <div className="flex items-center gap-2 text-sm text-primary">
                <ExternalLink className="h-4 w-4" />
                <span>Lead já vinculado a esta CAT</span>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowCreateLead(true)}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Criar Lead a partir desta CAT
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      <CreateLeadFromCatDialog
        open={showCreateLead}
        onOpenChange={setShowCreateLead}
        catLead={catLead}
        onLeadCreated={(leadId) => {
          onRefresh();
        }}
      />
    </Dialog>
  );
}
