import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Lead } from '@/hooks/useLeads';
import { useLeadCustomFields, FieldType, CustomFieldValue } from '@/hooks/useLeadCustomFields';
import { useContactClassifications } from '@/hooks/useContactClassifications';
import { CustomFieldInput } from '@/components/leads/CustomFieldsForm';
import { LeadStageHistoryPanel } from '@/components/kanban/LeadStageHistoryPanel';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Instagram, 
  FileText, 
  Settings, 
  Calendar,
  Clock,
  History,
  Plus,
  X,
} from 'lucide-react';
import { classificationColors } from '@/hooks/useContactClassifications';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (leadId: string, updates: Partial<Lead>) => Promise<void>;
  adAccountId?: string;
  boards?: KanbanBoard[];
}

export function LeadEditDialog({
  open,
  onOpenChange,
  lead,
  onSave,
  adAccountId,
  boards = [],
}: LeadEditDialogProps) {
  // Core fields state
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [source, setSource] = useState('manual');
  const [notes, setNotes] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [clientClassification, setClientClassification] = useState<string>('');
  
  // Custom fields
  const { customFields, getFieldValues, saveAllFieldValues, loading: fieldsLoading } = useLeadCustomFields(adAccountId);
  const { classifications, classificationConfig, addClassification } = useContactClassifications();
  const [fieldValues, setFieldValues] = useState<Record<string, CustomFieldValue>>({});
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, { type: FieldType; value: string | number | boolean | null }>>({});
  const [saving, setSaving] = useState(false);
  
  // New classification creation
  const [isAddingClassification, setIsAddingClassification] = useState(false);
  const [newClassificationName, setNewClassificationName] = useState('');
  const [newClassificationColor, setNewClassificationColor] = useState('bg-blue-500');

  // Load lead data when dialog opens
  useEffect(() => {
    if (lead && open) {
      setLeadName(lead.lead_name || '');
      setLeadPhone(lead.lead_phone || '');
      setLeadEmail(lead.lead_email || '');
      setInstagramUsername(lead.instagram_username || '');
      setSource(lead.source || 'manual');
      setNotes(lead.notes || '');
      setCity(lead.city || '');
      setState(lead.state || '');
      setNeighborhood(lead.neighborhood || '');
      setClientClassification(lead.client_classification || '');
      
      // Load custom field values
      loadCustomFieldValues(lead.id);
    }
  }, [lead, open]);

  const loadCustomFieldValues = async (leadId: string) => {
    const values = await getFieldValues(leadId);
    setFieldValues(values);
    
    // Initialize local values from loaded values
    const initial: Record<string, { type: FieldType; value: string | number | boolean | null }> = {};
    customFields.forEach(field => {
      const val = values[field.id];
      if (val) {
        let value: string | number | boolean | null = null;
        switch (field.field_type) {
          case 'text':
          case 'select':
            value = val.value_text;
            break;
          case 'number':
            value = val.value_number;
            break;
          case 'date':
            value = val.value_date;
            break;
          case 'checkbox':
            value = val.value_boolean;
            break;
        }
        initial[field.id] = { type: field.field_type, value };
      }
    });
    setLocalFieldValues(initial);
  };

  const handleFieldChange = (fieldId: string, type: FieldType, value: string | number | boolean | null) => {
    setLocalFieldValues(prev => ({
      ...prev,
      [fieldId]: { type, value },
    }));
  };

  const handleAddClassification = async () => {
    if (!newClassificationName.trim()) return;
    
    const result = await addClassification(newClassificationName, newClassificationColor);
    if (result) {
      setClientClassification(result.name);
      setIsAddingClassification(false);
      setNewClassificationName('');
      setNewClassificationColor('bg-blue-500');
    }
  };

  const handleSave = async () => {
    if (!lead) return;
    
    if (!leadName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      // Save core fields
      await onSave(lead.id, {
        lead_name: leadName.trim(),
        lead_phone: leadPhone || null,
        lead_email: leadEmail || null,
        instagram_username: instagramUsername || null,
        source,
        notes: notes || null,
        city: city || null,
        state: state || null,
        neighborhood: neighborhood || null,
        client_classification: (clientClassification || null) as 'client' | 'non_client' | 'prospect' | null,
      });

      // Save custom field values
      if (Object.keys(localFieldValues).length > 0) {
        await saveAllFieldValues(lead.id, localFieldValues);
      }

      toast.success('Lead atualizado com sucesso!');
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving lead:', error);
      toast.error('Erro ao salvar lead');
    } finally {
      setSaving(false);
    }
  };

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Editar Lead
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">
              <User className="h-4 w-4 mr-2" />
              Informações
            </TabsTrigger>
            <TabsTrigger value="location">
              <MapPin className="h-4 w-4 mr-2" />
              Localização
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-2" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="custom" disabled={customFields.length === 0}>
              <Settings className="h-4 w-4 mr-2" />
              Campos
              {customFields.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {customFields.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 pr-4 mt-4">
            <TabsContent value="info" className="space-y-4 mt-0">
              {/* Meta info */}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-4">
                <Badge variant="outline" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  Criado: {format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR })}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  Atualizado: {format(new Date(lead.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </Badge>
                {lead.source && (
                  <Badge variant="secondary">
                    Origem: {lead.source}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Nome *
                  </Label>
                  <Input
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    placeholder="Nome do lead"
                  />
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    Telefone
                  </Label>
                  <Input
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    Email
                  </Label>
                  <Input
                    type="email"
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div>
                  <Label className="flex items-center gap-1">
                    <Instagram className="h-3 w-3" />
                    Instagram
                  </Label>
                  <Input
                    value={instagramUsername}
                    onChange={(e) => setInstagramUsername(e.target.value)}
                    placeholder="@usuario"
                  />
                </div>

                <div>
                  <Label>Origem</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="form">Formulário</SelectItem>
                      <SelectItem value="referral">Indicação</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Classificação</Label>
                  {!isAddingClassification ? (
                    <div className="flex gap-2">
                      <Select 
                        value={clientClassification || '__none__'} 
                        onValueChange={(val) => setClientClassification(val === '__none__' ? '' : val)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem classificação</SelectItem>
                          {classifications.map((c) => (
                            <SelectItem key={c.id} value={c.name}>
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${c.color}`} />
                                {classificationConfig[c.name]?.label || c.name.replace(/_/g, ' ')}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="icon"
                        onClick={() => setIsAddingClassification(true)}
                        title="Nova classificação"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
                      <Input
                        placeholder="Nome da classificação..."
                        value={newClassificationName}
                        onChange={(e) => setNewClassificationName(e.target.value)}
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {classificationColors.slice(0, 10).map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            className={`w-5 h-5 rounded-full transition-all ${color.value} ${
                              newClassificationColor === color.value ? 'ring-2 ring-offset-1 ring-primary' : ''
                            }`}
                            onClick={() => setNewClassificationColor(color.value)}
                            title={color.label}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          onClick={handleAddClassification} 
                          disabled={!newClassificationName.trim()}
                        >
                          Criar
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => {
                            setIsAddingClassification(false);
                            setNewClassificationName('');
                          }}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="col-span-2">
                  <Label className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Observações
                  </Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas sobre o lead..."
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="location" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Cidade</Label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Cidade"
                  />
                </div>

                <div>
                  <Label>Estado</Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AC">Acre</SelectItem>
                      <SelectItem value="AL">Alagoas</SelectItem>
                      <SelectItem value="AP">Amapá</SelectItem>
                      <SelectItem value="AM">Amazonas</SelectItem>
                      <SelectItem value="BA">Bahia</SelectItem>
                      <SelectItem value="CE">Ceará</SelectItem>
                      <SelectItem value="DF">Distrito Federal</SelectItem>
                      <SelectItem value="ES">Espírito Santo</SelectItem>
                      <SelectItem value="GO">Goiás</SelectItem>
                      <SelectItem value="MA">Maranhão</SelectItem>
                      <SelectItem value="MT">Mato Grosso</SelectItem>
                      <SelectItem value="MS">Mato Grosso do Sul</SelectItem>
                      <SelectItem value="MG">Minas Gerais</SelectItem>
                      <SelectItem value="PA">Pará</SelectItem>
                      <SelectItem value="PB">Paraíba</SelectItem>
                      <SelectItem value="PR">Paraná</SelectItem>
                      <SelectItem value="PE">Pernambuco</SelectItem>
                      <SelectItem value="PI">Piauí</SelectItem>
                      <SelectItem value="RJ">Rio de Janeiro</SelectItem>
                      <SelectItem value="RN">Rio Grande do Norte</SelectItem>
                      <SelectItem value="RS">Rio Grande do Sul</SelectItem>
                      <SelectItem value="RO">Rondônia</SelectItem>
                      <SelectItem value="RR">Roraima</SelectItem>
                      <SelectItem value="SC">Santa Catarina</SelectItem>
                      <SelectItem value="SP">São Paulo</SelectItem>
                      <SelectItem value="SE">Sergipe</SelectItem>
                      <SelectItem value="TO">Tocantins</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2">
                  <Label>Bairro</Label>
                  <Input
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    placeholder="Bairro"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              <LeadStageHistoryPanel leadId={lead.id} boards={boards} />
            </TabsContent>

            <TabsContent value="custom" className="space-y-4 mt-0">
              {fieldsLoading ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  Carregando campos personalizados...
                </div>
              ) : customFields.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  <Settings className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>Nenhum campo personalizado configurado.</p>
                  <p className="text-xs mt-1">Configure campos em Leads &gt; Configurações</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {customFields.map((field) => (
                    <CustomFieldInput
                      key={field.id}
                      field={field}
                      value={fieldValues[field.id] || null}
                      onChange={handleFieldChange}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
