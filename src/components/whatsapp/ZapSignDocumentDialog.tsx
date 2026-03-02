import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, FileSignature, Sparkles, Send, Pencil, Check, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface ZapSignTemplate {
  token: string;
  name: string;
  description?: string;
  fields?: string[];
}

interface ExtractedField {
  de: string;
  para: string;
  editing?: boolean;
  source?: 'ai' | 'crm' | 'manual';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  contactName?: string;
  contactId?: string;
  leadId?: string;
  legalCaseId?: string;
  messages?: Array<{ direction: string; message_text: string | null; media_url?: string | null; media_type?: string | null }>;
  leadData?: Record<string, any>;
  contactData?: Record<string, any>;
  onSendMessage?: (message: string) => Promise<boolean>;
}

export function ZapSignDocumentDialog({
  open, onOpenChange, phone, contactName, contactId, leadId, legalCaseId,
  messages = [], leadData, contactData, onSendMessage
}: Props) {
  const { user } = useAuthContext();
  const [step, setStep] = useState<'select' | 'fill' | 'creating'>('select');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<ZapSignTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateFields, setTemplateFields] = useState<Array<ExtractedField>>([]);
  const [extracting, setExtracting] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      loadTemplates();
      setStep('select');
      setTemplateFields([]);
      setSelectedTemplate('');
    }
  }, [open]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapsign-api', {
        body: { action: 'list_templates' },
      });
      if (error) throw error;
      if (data?.success) {
        setTemplates(Array.isArray(data.templates) ? data.templates : data.templates?.results || []);
      } else {
        throw new Error(data?.error || 'Erro ao listar templates');
      }
    } catch (err: any) {
      toast.error('Erro ao carregar templates: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = async () => {
    if (!selectedTemplate) return;
    
    setStep('fill');
    setExtracting(true);

    // Fetch template fields and extract data in parallel
    try {
      const [templateRes] = await Promise.all([
        supabase.functions.invoke('zapsign-api', {
          body: { action: 'get_template', template_token: selectedTemplate },
        }),
      ]);

      let fieldVars: string[] = [];
      if (templateRes.data?.success && Array.isArray(templateRes.data.fields)) {
        const fields: ExtractedField[] = templateRes.data.fields.map((f: any) => ({
          de: f.variable || '',
          para: '',
          source: 'manual' as const,
        }));
        setTemplateFields(fields);
        fieldVars = fields.map(f => f.de).filter(Boolean);
      }

      // Now extract data with AI using the template fields
      await extractDataWithAI(fieldVars);
    } catch (err) {
      console.error('Error loading template:', err);
      toast.error('Erro ao carregar template');
    } finally {
      setExtracting(false);
    }
  };

  const extractDataWithAI = async (fieldVars?: string[]) => {
    try {
      const vars = fieldVars || templateFields.map(f => f.de).filter(Boolean);
      
      const { data, error } = await supabase.functions.invoke('zapsign-api', {
        body: {
          action: 'extract_data',
          messages: messages.slice(-50),
          template_fields: vars.length > 0 ? vars : undefined,
          lead_data: leadData || {},
          contact_data: contactData || {},
        },
      });

      if (data?.success && Array.isArray(data.extracted_data)) {
        const extracted: ExtractedField[] = data.extracted_data
          .filter((item: any) => item.de)
          .map((item: any) => ({
            de: item.de,
            para: item.para || '',
            editing: false,
            source: 'ai' as const,
          }));
        
        if (extracted.length > 0) {
          setTemplateFields(prev => {
            if (prev.length === 0) return extracted;
            const merged = [...prev];
            extracted.forEach(item => {
              const idx = merged.findIndex(f => f.de === item.de);
              if (idx >= 0) {
                merged[idx].para = item.para;
                merged[idx].source = 'ai';
              } else {
                merged.push(item);
              }
            });
            return merged;
          });
          toast.success(`${extracted.length} campo(s) extraído(s) pela IA!`);
        } else {
          toast.info('A IA não conseguiu extrair dados. Preencha manualmente.');
        }
      }
    } catch (err) {
      console.error('AI extraction error:', err);
      toast.error('Erro ao extrair dados com IA');
    }
  };

  const toggleEditField = (index: number) => {
    setTemplateFields(prev => prev.map((f, i) => i === index ? { ...f, editing: !f.editing } : f));
  };

  const updateFieldValue = (index: number, value: string) => {
    setTemplateFields(prev => prev.map((f, i) => i === index ? { ...f, para: value } : f));
  };

  const addField = () => {
    setTemplateFields(prev => [...prev, { de: '', para: '', source: 'manual' }]);
  };

  const removeField = (index: number) => {
    setTemplateFields(prev => prev.filter((_, i) => i !== index));
  };

  const formatFieldLabel = (field: string) => {
    return field.replace(/\{\{|\}\}/g, '').replace(/_/g, ' ');
  };

  const handleRequestMissingData = async () => {
    const missing = templateFields.filter(f => f.de && !f.para.trim());
    if (missing.length === 0) {
      toast.info('Todos os campos já estão preenchidos!');
      return;
    }
    const fieldNames = missing.map(f => formatFieldLabel(f.de)).join('\n• ');
    const name = contactName || contactData?.full_name || leadData?.lead_name || '';
    const message = `Olá ${name}! 👋\n\nPara dar andamento ao seu documento, preciso que me envie os seguintes dados:\n\n• ${fieldNames}\n\nPor favor, envie as informações aqui pelo chat. Obrigado! 🙏`;
    if (onSendMessage) {
      const sent = await onSendMessage(message);
      if (sent) toast.success('Mensagem enviada pedindo os dados faltantes!');
    } else {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada!');
    }
  };

  const handleCreateAndSend = async () => {
    if (!selectedTemplate) return;

    setCreating(true);
    try {
      const template = templates.find(t => t.token === selectedTemplate);
      const signerName = contactName || contactData?.full_name || leadData?.lead_name || 'Signatário';
      const signerPhone = phone || contactData?.phone || leadData?.phone || '';
      const signerEmail = contactData?.email || leadData?.email || '';

      const { data, error } = await supabase.functions.invoke('zapsign-api', {
        body: {
          action: 'create_doc',
          template_id: selectedTemplate,
          signer_name: signerName,
          signer_email: signerEmail || undefined,
          signer_phone: signerPhone || undefined,
          data: templateFields.filter(f => f.de && f.para),
          document_name: template?.name || 'Documento',
          lead_id: leadId || null,
          contact_id: contactId || null,
          legal_case_id: legalCaseId || null,
          created_by: user?.id || null,
          send_via_whatsapp: true,
          whatsapp_phone: phone,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar documento');

      const url = data.sign_url;
      
      // Auto-send via WhatsApp
      if (onSendMessage && url) {
        const message = `📝 *Documento para assinatura*\n\nOlá ${signerName}! Segue o link para assinar o documento *${template?.name || 'Documento'}*:\n\n👉 ${url}\n\n*Instruções:*\n1. Clique no link acima\n2. Confira seus dados\n3. Assine digitalmente no local indicado\n4. Pronto! Você receberá uma cópia por email.\n\nQualquer dúvida, estou à disposição! 🙏`;
        const sent = await onSendMessage(message);
        if (sent) {
          toast.success('Documento criado e link enviado pelo WhatsApp!');
        } else {
          toast.success('Documento criado! Link: ' + url);
        }
      } else {
        toast.success('Documento criado! Link: ' + url);
      }

      onOpenChange(false);
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const filledCount = templateFields.filter(f => f.para.trim()).length;
  const emptyCount = templateFields.filter(f => f.de && !f.para.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            {step === 'select' && 'Gerar Documento para Assinatura'}
            {step === 'fill' && 'Revisar e Enviar Documento'}
            {step === 'creating' && 'Criando documento...'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select template */}
        {step === 'select' && (
          <div className="space-y-4 flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Carregando templates...</span>
              </div>
            ) : (
              <div>
                <Label>Template / Modelo</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.token} value={t.token}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {templates.length === 0 && !loading && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Nenhum modelo encontrado. Crie um modelo DOCX na plataforma ZapSign primeiro.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Review fields and send */}
        {step === 'fill' && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            {extracting ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Extraindo dados com IA...</span>
                <span className="text-xs text-muted-foreground">Analisando conversa e imagens</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  {filledCount > 0 && (
                    <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50">
                      <CheckCircle2 className="h-3 w-3" />
                      {filledCount} preenchido(s)
                    </Badge>
                  )}
                  {emptyCount > 0 && (
                    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-200 bg-amber-50">
                      <AlertCircle className="h-3 w-3" />
                      {emptyCount} vazio(s)
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { setExtracting(true); extractDataWithAI().finally(() => setExtracting(false)); }} className="ml-auto gap-1 h-7 text-xs">
                    <Sparkles className="h-3 w-3" />
                    Re-extrair com IA
                  </Button>
                </div>

                <ScrollArea className="flex-1 max-h-[350px] pr-2">
                  <div className="space-y-2">
                    {templateFields.map((field, i) => (
                      <div key={i} className="rounded-lg border p-3 space-y-1.5 bg-card">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {formatFieldLabel(field.de)}
                          </span>
                          <div className="flex items-center gap-1">
                            {field.source === 'ai' && (
                              <Badge variant="secondary" className="h-5 text-[10px] px-1.5 gap-0.5">
                                <Sparkles className="h-2.5 w-2.5" /> IA
                              </Badge>
                            )}
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleEditField(i)}>
                              {field.editing ? <Check className="h-3 w-3 text-primary" /> : <Pencil className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => removeField(i)}>
                              ×
                            </Button>
                          </div>
                        </div>
                        {field.editing ? (
                          <Input
                            className="text-sm"
                            value={field.para}
                            onChange={e => updateFieldValue(i, e.target.value)}
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') toggleEditField(i); }}
                          />
                        ) : (
                          <p className={`text-sm cursor-pointer ${field.para.trim() ? 'text-foreground' : 'text-muted-foreground italic'}`} onClick={() => toggleEditField(i)}>
                            {field.para.trim() || '(vazio - clique para editar)'}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={addField} className="text-xs">
                    + Campo
                  </Button>
                  {emptyCount > 0 && (
                    <Button variant="outline" size="sm" onClick={handleRequestMissingData} className="gap-1 text-xs text-amber-600 border-amber-200 hover:bg-amber-50">
                      <Send className="h-3 w-3" />
                      Pedir dados faltantes
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          {step === 'select' && (
            <Button onClick={handleSelectTemplate} disabled={!selectedTemplate}>
              <Sparkles className="h-4 w-4 mr-2" />
              Extrair dados e preencher
            </Button>
          )}
          {step === 'fill' && !extracting && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setStep('select')}>Voltar</Button>
              <Button className="flex-1 gap-2" onClick={handleCreateAndSend} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Gerar e enviar pelo WhatsApp
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
