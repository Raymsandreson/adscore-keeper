import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, FileSignature, Sparkles, Send, Pencil, Check, CheckCircle2, AlertCircle, Upload, FileText, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';

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

interface UploadedDoc {
  name: string;
  type: string;
  dataUrl: string;
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
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [extractionSource, setExtractionSource] = useState<'upload_only' | 'upload_and_chat'>('upload_and_chat');
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      loadTemplates();
      setStep('select');
      setTemplateFields([]);
      setSelectedTemplate('');
      setUploadedDocs([]);
      setExtractionSource('upload_and_chat');
      setPreviewPdfUrl(null);
      setShowPreview(false);
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedDocs(prev => [...prev, {
          name: file.name,
          type: file.type,
          dataUrl: reader.result as string,
        }]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeDoc = (index: number) => {
    setUploadedDocs(prev => prev.filter((_, i) => i !== index));
  };

  const handleSelectTemplate = async () => {
    if (!selectedTemplate) return;
    
    setStep('fill');
    setExtracting(true);

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
        const today = format(new Date(), 'dd/MM/yyyy');
        fields.forEach(f => {
          const lower = f.de.toLowerCase();
          if (lower.includes('data') && (lower.includes('assinatura') || lower.includes('hoje') || lower.includes('atual'))) {
            f.para = today;
            f.source = 'crm';
          }
        });
        setTemplateFields(fields);
        fieldVars = fields.map(f => f.de).filter(Boolean);
      }

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
          messages: extractionSource === 'upload_only' ? [] : messages.slice(-50),
          template_fields: vars.length > 0 ? vars : undefined,
          lead_data: leadData || {},
          contact_data: contactData || {},
          uploaded_documents: uploadedDocs.map(d => ({ name: d.name, type: d.type, dataUrl: d.dataUrl })),
          extraction_source: extractionSource,
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
              if (idx >= 0 && !merged[idx].para.trim()) {
                merged[idx].para = item.para;
                merged[idx].source = 'ai';
              } else if (idx < 0) {
                merged.push(item);
              }
            });
            return merged;
          });
          toast.success(`${extracted.filter(e => e.para.trim()).length} campo(s) extraído(s) pela IA!`);
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

      const filledFieldsData = templateFields.filter(f => f.de && f.para.trim());
      const emptyFieldsList = templateFields.filter(f => f.de && !f.para.trim());

      const { data, error } = await supabase.functions.invoke('zapsign-api', {
        body: {
          action: 'create_doc',
          template_id: selectedTemplate,
          signer_name: signerName,
          signer_email: signerEmail || undefined,
          signer_phone: signerPhone || undefined,
          data: filledFieldsData,
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
      const originalPdfUrl = data.document?.original_file || null;
      
      if (onSendMessage && url) {
        const missingList = emptyFieldsList.length > 0
          ? `\n\n⚠️ *Campos para você preencher:*\n${emptyFieldsList.map(f => `• ${formatFieldLabel(f.de)}`).join('\n')}`
          : '';
        
        const message = `📝 *Documento para assinatura*\n\nOlá ${signerName}! Segue o link para assinar o documento *${template?.name || 'Documento'}*:\n\n👉 ${url}${missingList}\n\n*Instruções:*\n1. Clique no link acima\n2. ${emptyFieldsList.length > 0 ? 'Preencha os campos indicados' : 'Confira seus dados'}\n3. Assine digitalmente no local indicado\n4. Pronto! Você receberá uma cópia por email.\n\nQualquer dúvida, estou à disposição! 🙏`;
        const sent = await onSendMessage(message);
        if (sent) {
          toast.success('Documento criado e link enviado pelo WhatsApp!');
        } else {
          toast.success('Documento criado! Link: ' + url);
        }
      } else {
        toast.success('Documento criado! Link: ' + url);
      }

      // Show PDF preview if available
      if (originalPdfUrl) {
        setPreviewPdfUrl(originalPdfUrl);
        setShowPreview(true);
        setStep('fill'); // Keep dialog open for preview
      } else {
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const filledFields = templateFields.filter(f => f.para.trim() && !f.editing);
  const emptyFields = templateFields.filter(f => f.de && (!f.para.trim() || f.editing));

  const renderFieldCard = (field: ExtractedField, globalIndex: number) => (
    <div key={globalIndex} className="rounded-lg border p-3 space-y-1.5 bg-card">
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
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleEditField(globalIndex)}>
            {field.editing ? <Check className="h-3 w-3 text-primary" /> : <Pencil className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      {field.editing ? (
        <Input
          className="text-sm"
          value={field.para}
          onChange={e => updateFieldValue(globalIndex, e.target.value)}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') toggleEditField(globalIndex); }}
        />
      ) : (
        <p className={`text-sm cursor-pointer ${field.para.trim() ? 'text-foreground' : 'text-muted-foreground italic'}`} onClick={() => toggleEditField(globalIndex)}>
          {field.para.trim() || '(vazio - clique para editar)'}
        </p>
      )}
    </div>
  );

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

        {/* Step 1: Select template + upload docs */}
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
                      Nenhum modelo encontrado. Crie um modelo na plataforma ZapSign primeiro.
                    </p>
                  )}
                </div>

                {/* Document upload area */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    Documentos para extração (opcional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Envie RG, CPF, comprovante de endereço, etc. A IA irá extrair os dados automaticamente.
                  </p>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 border-dashed"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Fazer upload de documentos
                  </Button>

                  {uploadedDocs.length > 0 && (
                    <div className="space-y-1.5">
                      {uploadedDocs.map((doc, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-md border p-2 text-sm bg-muted/50">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{doc.name}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removeDoc(i)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Extraction source selector */}
                <div className="space-y-2">
                  <Label>Fonte de extração da IA</Label>
                  <Select value={extractionSource} onValueChange={(v: 'upload_only' | 'upload_and_chat') => setExtractionSource(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upload_and_chat">📄 Uploads + 💬 Conversa do chat</SelectItem>
                      <SelectItem value="upload_only">📄 Somente uploads</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {extractionSource === 'upload_only'
                      ? 'A IA extrairá dados apenas dos documentos enviados acima.'
                      : 'A IA extrairá dados dos uploads e também do histórico da conversa.'}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* PDF Preview after creation */}
        {showPreview && previewPdfUrl && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>Documento gerado e link enviado com sucesso!</span>
            </div>
            <div className="flex-1 overflow-hidden rounded-lg border bg-muted/30">
              <iframe
                src={previewPdfUrl}
                className="w-full h-[400px] rounded-lg"
                title="Pré-visualização do documento"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              📄 Pré-visualização do documento gerado. Quando o cliente assinar, o PDF assinado será enviado automaticamente pelo WhatsApp.
            </p>
          </div>
        )}

        {/* Step 2: Review fields and send */}
        {step === 'fill' && !showPreview && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            {extracting ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Extraindo dados com IA...</span>
                <span className="text-xs text-muted-foreground">Analisando conversa, imagens e documentos</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => { setExtracting(true); extractDataWithAI().finally(() => setExtracting(false)); }} className="ml-auto gap-1 h-7 text-xs">
                    <Sparkles className="h-3 w-3" />
                    Re-extrair com IA
                  </Button>
                </div>

                <Tabs defaultValue="filled" className="flex-1 overflow-hidden flex flex-col">
                  <TabsList className="w-full grid grid-cols-2 shrink-0">
                    <TabsTrigger value="filled" className="gap-1.5 text-xs">
                      <CheckCircle2 className="h-3 w-3" />
                      Preenchidos ({filledFields.length})
                    </TabsTrigger>
                    <TabsTrigger value="missing" className="gap-1.5 text-xs">
                      <AlertCircle className="h-3 w-3" />
                      Faltantes ({emptyFields.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="filled" className="flex-1 overflow-auto mt-2">
                    <ScrollArea className="h-[300px] pr-2">
                      <div className="space-y-2">
                        {filledFields.length > 0 ? filledFields.map(field => {
                          const globalIdx = templateFields.indexOf(field);
                          return renderFieldCard(field, globalIdx);
                        }) : (
                          <p className="text-sm text-muted-foreground text-center py-6">Nenhum campo preenchido ainda.</p>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="missing" className="flex-1 overflow-auto mt-2">
                    <ScrollArea className="h-[300px] pr-2">
                      <div className="space-y-2">
                        {emptyFields.length > 0 ? emptyFields.map(field => {
                          const globalIdx = templateFields.indexOf(field);
                          return renderFieldCard(field, globalIdx);
                        }) : (
                          <p className="text-sm text-muted-foreground text-center py-6">Todos os campos estão preenchidos! ✅</p>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>

                <div className="flex gap-2">
                  {emptyFields.length > 0 && (
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
          {showPreview && (
            <Button onClick={() => onOpenChange(false)} className="w-full">
              <Check className="h-4 w-4 mr-2" />
              Fechar
            </Button>
          )}
          {step === 'select' && !showPreview && (
            <Button onClick={handleSelectTemplate} disabled={!selectedTemplate}>
              <Sparkles className="h-4 w-4 mr-2" />
              Extrair dados e preencher
            </Button>
          )}
          {step === 'fill' && !extracting && !showPreview && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setStep('select')}>Voltar</Button>
              <Button className="flex-1 gap-2" onClick={handleCreateAndSend} disabled={creating || emptyFields.length > 0}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {emptyFields.length > 0 ? `Preencha ${emptyFields.length} campo(s) faltante(s)` : 'Gerar e enviar pelo WhatsApp'}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
