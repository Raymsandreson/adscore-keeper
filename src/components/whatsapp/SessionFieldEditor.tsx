import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Pencil, Check, RefreshCw, FileSignature, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  instanceName?: string;
}

interface CollectionSession {
  id: string;
  phone: string;
  instance_name: string;
  template_name: string;
  template_token: string;
  shortcut_name: string | null;
  status: string;
  collected_data: any;
  missing_fields: any[];
  required_fields: any[];
  sign_url: string | null;
  doc_token: string | null;
  created_at: string;
  contact_id: string | null;
  lead_id: string | null;
  notify_on_signature: boolean;
  send_signed_pdf: boolean;
}

interface EditableField {
  de: string;
  para: string;
  editing: boolean;
}

const FRIENDLY_LABELS: Record<string, string> = {
  'NOME_COMPLETO': 'Nome completo',
  'NACIONALIDADE': 'Nacionalidade',
  'ESTADO_CIVIL': 'Estado civil',
  'PROFISSAO': 'Profissão',
  'CPF': 'CPF',
  'RG': 'RG',
  'ENDERECO_COMPLETO': 'Endereço completo',
  'CIDADE': 'Cidade',
  'UF': 'Estado (UF)',
  'CEP': 'CEP',
  'DATA_NASCIMENTO': 'Data de nascimento',
  'NOME_MAE': 'Nome da mãe',
  'EMAIL': 'E-mail',
  'TELEFONE': 'Telefone',
  'BAIRRO': 'Bairro',
  'NUMERO': 'Número',
  'COMPLEMENTO': 'Complemento',
  'NOME': 'Nome completo',
  'NOME_CLIENTE': 'Nome completo',
  'CPF_CLIENTE': 'CPF',
  'RG_CLIENTE': 'RG',
};

export function SessionFieldEditor({ open, onOpenChange, phone, instanceName }: Props) {
  const [session, setSession] = useState<CollectionSession | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (open && phone) {
      loadSession();
    }
  }, [open, phone]);

  const loadSession = async () => {
    setLoading(true);
    try {
      const normalPhone = phone.replace(/\D/g, '');
      const { data, error } = await (supabase as any)
        .from('wjia_collection_sessions')
        .select('*')
        .or(`phone.eq.${normalPhone},phone.like.%${normalPhone.slice(-8)}%`)
        .in('status', ['collecting', 'collecting_docs', 'ready', 'generated', 'processing_docs'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setSession(null);
        setFields([]);
        return;
      }

      setSession(data);

      // Build fields from collected_data + required_fields
      const collectedFields = data.collected_data?.fields || [];
      const requiredFields = data.required_fields || [];
      
      // Merge: start with required fields, overlay collected values
      const fieldMap = new Map<string, string>();
      for (const rf of requiredFields) {
        const variable = rf.variable || rf;
        fieldMap.set(variable, '');
      }
      for (const cf of collectedFields) {
        if (cf.de) fieldMap.set(cf.de, cf.para || '');
      }

      const editableFields: EditableField[] = [];
      fieldMap.forEach((value, key) => {
        editableFields.push({ de: key, para: value, editing: false });
      });
      setFields(editableFields);
    } catch (err) {
      console.error('Error loading session:', err);
    } finally {
      setLoading(false);
    }
  };

  const getFieldLabel = (variable: string): string => {
    const key = variable.replace(/[{}]/g, '');
    return FRIENDLY_LABELS[key] || key.replace(/_/g, ' ');
  };

  const updateFieldValue = (index: number, value: string) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, para: value } : f));
  };

  const toggleEdit = (index: number) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, editing: !f.editing } : f));
  };

  const saveFields = async () => {
    if (!session) return;
    try {
      const updatedCollectedData = {
        ...session.collected_data,
        fields: fields.map(f => ({ de: f.de, para: f.para })),
      };
      
      await (supabase as any)
        .from('wjia_collection_sessions')
        .update({
          collected_data: updatedCollectedData,
          missing_fields: fields.filter(f => !f.para?.trim()).map(f => ({
            field_name: f.de,
            friendly_name: f.de,
          })),
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      toast.success('Campos salvos com sucesso');
    } catch (err) {
      console.error('Error saving fields:', err);
      toast.error('Erro ao salvar campos');
    }
  };

  const regenerateDocument = async () => {
    if (!session) return;
    setRegenerating(true);
    try {
      // Save fields first
      await saveFields();

      // Set session back to ready to trigger regeneration
      await (supabase as any)
        .from('wjia_collection_sessions')
        .update({
          status: 'ready',
          sign_url: null,
          doc_token: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      // Call the edge function to regenerate
      const { data, error } = await supabase.functions.invoke('wjia-agent', {
        body: {
          action: 'regenerate_session',
          session_id: session.id,
        },
      });

      if (error) throw error;

      toast.success('Documento regenerado! Novo link será enviado ao cliente.');
      await loadSession();
    } catch (err: any) {
      console.error('Error regenerating:', err);
      toast.error('Erro ao regenerar documento: ' + (err.message || ''));
    } finally {
      setRegenerating(false);
    }
  };

  const filledCount = fields.filter(f => f.para?.trim()).length;
  const totalCount = fields.length;

  const statusLabels: Record<string, { label: string; color: string }> = {
    collecting: { label: 'Coletando dados', color: 'bg-yellow-500' },
    collecting_docs: { label: 'Coletando documentos', color: 'bg-orange-500' },
    processing_docs: { label: 'Processando documentos', color: 'bg-blue-500' },
    ready: { label: 'Pronto para gerar', color: 'bg-green-500' },
    generated: { label: 'Documento gerado', color: 'bg-purple-500' },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" />
            Editar Campos da Sessão
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !session ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>Nenhuma sessão ativa encontrada para este contato.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm mb-2">
              <div>
                <span className="font-medium">{session.template_name}</span>
                {session.shortcut_name && (
                  <Badge variant="outline" className="ml-2 text-[10px]">#{session.shortcut_name}</Badge>
                )}
              </div>
              <Badge className={`${statusLabels[session.status]?.color || 'bg-gray-500'} text-white text-[10px]`}>
                {statusLabels[session.status]?.label || session.status}
              </Badge>
            </div>

            <div className="text-xs text-muted-foreground mb-2">
              {filledCount}/{totalCount} campos preenchidos
              {session.sign_url && (
                <a href={session.sign_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary inline-flex items-center gap-1 hover:underline">
                  <ExternalLink className="h-3 w-3" /> Ver documento
                </a>
              )}
            </div>

            <ScrollArea className="flex-1 max-h-[50vh] pr-2">
              <div className="space-y-2">
                {fields.map((field, idx) => {
                  const label = getFieldLabel(field.de);
                  const isEmpty = !field.para?.trim();
                  return (
                    <div key={field.de} className={`flex items-center gap-2 p-2 rounded-md border ${isEmpty ? 'border-destructive/30 bg-destructive/5' : 'border-border'}`}>
                      <div className="flex-1 min-w-0">
                        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
                        {field.editing ? (
                          <Input
                            value={field.para}
                            onChange={e => updateFieldValue(idx, e.target.value)}
                            className="h-7 text-sm mt-0.5"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && toggleEdit(idx)}
                          />
                        ) : (
                          <p className={`text-sm truncate ${isEmpty ? 'text-destructive italic' : ''}`}>
                            {field.para || 'Não preenchido'}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => toggleEdit(idx)}
                      >
                        {field.editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={saveFields}>
                Salvar Alterações
              </Button>
              <Button size="sm" onClick={regenerateDocument} disabled={regenerating}>
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Regerar Documento
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
