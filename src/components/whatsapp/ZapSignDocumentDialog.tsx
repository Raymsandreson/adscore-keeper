import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, FileSignature, Sparkles, Send, Copy, Check, ExternalLink, Pencil, CheckCircle2, AlertCircle } from 'lucide-react';
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
  messages?: Array<{ direction: string; message_text: string | null }>;
  leadData?: Record<string, any>;
  contactData?: Record<string, any>;
  onSendMessage?: (message: string) => Promise<boolean>;
}

export function ZapSignDocumentDialog({
  open, onOpenChange, phone, contactName, contactId, leadId, legalCaseId,
  messages = [], leadData, contactData, onSendMessage
}: Props) {
  const { user } = useAuthContext();
  const [step, setStep] = useState<'select' | 'review' | 'fill' | 'done'>('select');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<ZapSignTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [signerName, setSignerName] = useState(contactName || '');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerPhone, setSignerPhone] = useState(phone || '');
  const [templateFields, setTemplateFields] = useState<Array<ExtractedField>>([]);
  const [extractedFields, setExtractedFields] = useState<Array<ExtractedField>>([]);
  const [extracting, setExtracting] = useState(false);
  const [signUrl, setSignUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      loadTemplates();
      setStep('select');
      setSignerName(contactName || '');
      setSignerPhone(phone || '');
      setTemplateFields([]);
      setExtractedFields([]);
      setSignUrl('');
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

  const handleSelectTemplate = () => {
    if (!selectedTemplate) return;
    setStep('fill');
  };

  const extractDataWithAI = async () => {
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapsign-api', {
        body: {
          action: 'extract_data',
          messages: messages.slice(-50),
          template_fields: templateFields.map(f => f.de),
          lead_data: leadData || {},
          contact_data: contactData || {},
        },
      });

      if (data?.success && Array.isArray(data.extracted_data)) {
        const extracted: ExtractedField[] = data.extracted_data
          .filter((item: any) => item.de && item.para)
          .map((item: any) => ({
            de: item.de,
            para: item.para,
            editing: false,
            source: 'ai' as const,
          }));
        
        if (extracted.length > 0) {
          setExtractedFields(extracted);
          setStep('review');
          toast.success(`${extracted.length} campo(s) extraído(s) pela IA!`);
        } else {
          toast.info('A IA não conseguiu extrair dados. Preencha manualmente.');
        }
      } else {
        toast.info('Nenhum dado extraído. Preencha manualmente.');
      }
    } catch (err) {
      console.error('AI extraction error:', err);
      toast.error('Erro ao extrair dados com IA');
    } finally {
      setExtracting(false);
    }
  };

  const handleConfirmExtracted = () => {
    setTemplateFields(prev => {
      const merged = [...prev];
      extractedFields.forEach(item => {
        const idx = merged.findIndex(f => f.de === item.de);
        if (idx >= 0) {
          merged[idx].para = item.para;
        } else {
          merged.push({ de: item.de, para: item.para });
        }
      });
      return merged;
    });
    setStep('fill');
    toast.success('Dados confirmados e aplicados!');
  };

  const updateExtractedField = (index: number, value: string) => {
    setExtractedFields(prev => prev.map((f, i) => i === index ? { ...f, para: value } : f));
  };

  const toggleEditExtracted = (index: number) => {
    setExtractedFields(prev => prev.map((f, i) => i === index ? { ...f, editing: !f.editing } : f));
  };

  const removeExtractedField = (index: number) => {
    setExtractedFields(prev => prev.filter((_, i) => i !== index));
  };

  const addField = () => {
    setTemplateFields(prev => [...prev, { de: '', para: '' }]);
  };

  const updateField = (index: number, key: 'de' | 'para', value: string) => {
    setTemplateFields(prev => prev.map((f, i) => i === index ? { ...f, [key]: value } : f));
  };

  const removeField = (index: number) => {
    setTemplateFields(prev => prev.filter((_, i) => i !== index));
  };

  const handleRequestMissingData = async () => {
    const missing = templateFields.filter(f => f.de && !f.para.trim());
    if (missing.length === 0) {
      toast.info('Todos os campos já estão preenchidos!');
      return;
    }
    const fieldNames = missing.map(f => f.de.replace(/\{\{|\}\}/g, '').replace(/_/g, ' ')).join('\n• ');
    const message = `Olá ${signerName || ''}! 👋\n\nPara dar andamento à sua procuração, preciso que me envie os seguintes dados:\n\n• ${fieldNames}\n\nPor favor, envie as informações aqui pelo chat. Obrigado! 🙏`;
    if (onSendMessage) {
      const sent = await onSendMessage(message);
      if (sent) {
        toast.success('Mensagem enviada pedindo os dados faltantes!');
      }
    } else {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada para a área de transferência!');
    }
  };

  const handleCreateDocument = async () => {
    if (!selectedTemplate || !signerName) {
      toast.error('Preencha o nome do signatário');
      return;
    }

    setCreating(true);
    try {
      const template = templates.find(t => t.token === selectedTemplate);
      
      const { data, error } = await supabase.functions.invoke('zapsign-api', {
        body: {
          action: 'create_doc',
          template_id: selectedTemplate,
          signer_name: signerName,
          signer_email: signerEmail || undefined,
          signer_phone: signerPhone || undefined,
          data: templateFields.filter(f => f.de && f.para),
          document_name: template?.name || 'Procuração',
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
      setSignUrl(url);
      setStep('done');
      toast.success('Documento criado com sucesso!');
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(signUrl);
    setCopied(true);
    toast.success('Link copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendViaWhatsApp = async () => {
    if (!onSendMessage || !signUrl) return;
    const message = `📝 *Documento para assinatura*\n\nOlá ${signerName}, segue o link para assinar o documento:\n\n${signUrl}\n\nPor favor, clique no link acima para assinar digitalmente.`;
    const sent = await onSendMessage(message);
    if (sent) {
      toast.success('Link enviado pelo WhatsApp!');
      onOpenChange(false);
    }
  };

  const formatFieldLabel = (field: string) => {
    return field.replace(/\{\{|\}\}/g, '').replace(/_/g, ' ');
  };

  const filledCount = extractedFields.filter(f => f.para.trim()).length;
  const emptyCount = extractedFields.filter(f => !f.para.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            {step === 'select' && 'Gerar Procuração (ZapSign)'}
            {step === 'review' && 'Confirmar Dados Extraídos'}
            {step === 'fill' && 'Preencher Dados'}
            {step === 'done' && 'Documento Criado!'}
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
              <>
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

                <Separator />

                <div>
                  <Label>Nome do Signatário *</Label>
                  <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Nome completo" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Email (opcional)</Label>
                    <Input value={signerEmail} onChange={e => setSignerEmail(e.target.value)} placeholder="email@exemplo.com" type="email" />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input value={signerPhone} onChange={e => setSignerPhone(e.target.value)} placeholder="5511999999999" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 2: Review AI-extracted data */}
        {step === 'review' && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" />
                IA extraiu {extractedFields.length} campo(s)
              </Badge>
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
            </div>

            <p className="text-xs text-muted-foreground">
              Revise os dados abaixo. Clique no <Pencil className="h-3 w-3 inline" /> para editar um valor antes de confirmar.
            </p>

            <ScrollArea className="flex-1 max-h-[320px] pr-2">
              <div className="space-y-2">
                {extractedFields.map((field, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-1.5 bg-card">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {formatFieldLabel(field.de)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => toggleEditExtracted(i)}
                          title={field.editing ? 'Salvar' : 'Editar'}
                        >
                          {field.editing ? <Check className="h-3 w-3 text-primary" /> : <Pencil className="h-3 w-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive/60 hover:text-destructive"
                          onClick={() => removeExtractedField(i)}
                          title="Remover"
                        >
                          ×
                        </Button>
                      </div>
                    </div>

                    {field.editing ? (
                      <Input
                        className="text-sm"
                        value={field.para}
                        onChange={e => updateExtractedField(i, e.target.value)}
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') toggleEditExtracted(i); }}
                      />
                    ) : (
                      <p className={`text-sm ${field.para.trim() ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                        {field.para.trim() || '(vazio - clique para editar)'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            {emptyCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const missing = extractedFields.filter(f => !f.para.trim());
                  const fieldNames = missing.map(f => formatFieldLabel(f.de)).join('\n• ');
                  const message = `Olá ${signerName || ''}! 👋\n\nPara dar andamento à sua procuração, preciso que me envie os seguintes dados:\n\n• ${fieldNames}\n\nPor favor, envie as informações aqui pelo chat. Obrigado! 🙏`;
                  if (onSendMessage) {
                    const sent = await onSendMessage(message);
                    if (sent) toast.success('Mensagem enviada pedindo os dados faltantes!');
                  } else {
                    await navigator.clipboard.writeText(message);
                    toast.success('Mensagem copiada!');
                  }
                }}
                className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
              >
                <Send className="h-3 w-3" />
                Pedir dados faltantes via WhatsApp
              </Button>
            )}
          </div>
        )}

        {/* Step 3: Fill template data (manual) */}
        {step === 'fill' && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Preencha os campos do modelo. Use <code className="text-xs">{`{{CAMPO}}`}</code> no "De".
              </p>
              <Button variant="outline" size="sm" onClick={extractDataWithAI} disabled={extracting} className="gap-1">
                {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Preencher com IA
              </Button>
            </div>

            <ScrollArea className="flex-1 max-h-[300px] pr-2">
              <div className="space-y-2">
                {templateFields.map((field, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="flex-1 text-xs"
                      placeholder="{{NOME_COMPLETO}}"
                      value={field.de}
                      onChange={e => updateField(i, 'de', e.target.value)}
                    />
                    <span className="text-muted-foreground text-xs">→</span>
                    <Input
                      className="flex-1 text-xs"
                      placeholder="Valor"
                      value={field.para}
                      onChange={e => updateField(i, 'para', e.target.value)}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeField(i)}>
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addField} className="flex-1">
                + Adicionar campo
              </Button>
              {templateFields.some(f => f.de && !f.para.trim()) && (
                <Button variant="outline" size="sm" onClick={handleRequestMissingData} className="flex-1 gap-1 text-destructive border-destructive/30 hover:bg-destructive/5">
                  <Send className="h-3 w-3" />
                  Pedir dados faltantes
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="space-y-4">
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-sm font-medium text-primary mb-2">✅ Documento criado com sucesso!</p>
              <p className="text-xs text-muted-foreground mb-2">Link de assinatura:</p>
              <p className="text-xs font-mono break-all bg-background p-2 rounded border">{signUrl}</p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-1" onClick={handleCopyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </Button>
              <Button variant="outline" className="gap-1" onClick={() => window.open(signUrl, '_blank')}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>

            {onSendMessage && (
              <Button className="w-full gap-2" onClick={handleSendViaWhatsApp}>
                <Send className="h-4 w-4" />
                Enviar link pelo WhatsApp
              </Button>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          {step === 'select' && (
            <Button onClick={handleSelectTemplate} disabled={!selectedTemplate || !signerName.trim()}>
              Próximo
            </Button>
          )}
          {step === 'review' && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setStep('fill')}>
                Editar manualmente
              </Button>
              <Button className="flex-1 gap-1" onClick={handleConfirmExtracted}>
                <CheckCircle2 className="h-4 w-4" />
                Confirmar e continuar
              </Button>
            </div>
          )}
          {step === 'fill' && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setStep('select')}>Voltar</Button>
              <Button className="flex-1" onClick={handleCreateDocument} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileSignature className="h-4 w-4 mr-2" />}
                Criar Documento
              </Button>
            </div>
          )}
          {step === 'done' && (
            <Button variant="ghost" onClick={() => { setStep('select'); setSelectedTemplate(''); setTemplateFields([]); setExtractedFields([]); setSignUrl(''); }}>
              Criar outro documento
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
