import { useState, useEffect, useRef, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, FileSignature, Sparkles, Send, Pencil, Check, CheckCircle2, AlertCircle, Upload, FileText, X, Plus, Trash2, UserPlus, MessageSquare, Eye, Copy } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, subDays, subHours, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { StateCombobox, CityCombobox, CepInput, detectLocationFieldType } from '@/components/shared/BrazilianLocationInput';

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

interface SignerInfo {
  name: string;
  email: string;
  phone: string;
  role: 'sign' | 'witness' | 'approve';
  auth_mode: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  contactName?: string;
  contactId?: string;
  leadId?: string;
  legalCaseId?: string;
  instanceName?: string;
  messages?: Array<{ direction: string; message_text: string | null; media_url?: string | null; media_type?: string | null; created_at?: string; timestamp?: string }>;
  leadData?: Record<string, any>;
  contactData?: Record<string, any>;
  onSendMessage?: (message: string) => Promise<boolean>;
}

export function ZapSignDocumentDialog({
  open, onOpenChange, phone, contactName, contactId, leadId, legalCaseId, instanceName,
  messages = [], leadData, contactData, onSendMessage
}: Props) {
  const { user } = useAuthContext();
  const [step, setStep] = useState<'select' | 'signers' | 'fill' | 'creating'>('select');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<ZapSignTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateFields, setTemplateFields] = useState<Array<ExtractedField>>([]);
  const [extracting, setExtracting] = useState(false);
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [previewAttachments, setPreviewAttachments] = useState<any>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  const handleViewPrompt = async () => {
    setShowPromptDialog(true);
    setLoadingPrompt(true);
    try {
      const vars = templateFields.map(f => f.de).filter(Boolean);
      const { data } = await cloudFunctions.invoke('zapsign-api', {
        body: {
          action: 'preview_extract_prompt',
          messages: extractionSource === 'upload_only' ? (pastedText ? [{ direction: 'inbound', message_text: pastedText }] : []) : [...filteredMessages.slice(-50), ...(pastedText ? [{ direction: 'inbound', message_text: pastedText }] : [])],
          template_fields: vars,
          lead_data: leadData || fetchedLeadData || {},
          contact_data: contactData || fetchedContactData || {},
          uploaded_documents: uploadedDocs.map(d => ({ name: d.name, type: d.type, dataUrl: d.dataUrl })),
        },
      });
      if (data?.success) {
        setPreviewPrompt(data.prompt || '');
        setPreviewAttachments(data.attachments || null);
      } else {
        toast.error('Erro ao gerar prévia do prompt');
      }
    } catch (err) {
      console.error('Preview prompt error:', err);
      toast.error('Erro ao carregar prompt');
    } finally {
      setLoadingPrompt(false);
    }
  };
  const [creating, setCreating] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [extractionSource, setExtractionSource] = useState<'upload_only' | 'upload_and_chat'>('upload_and_chat');
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingSignUrl, setPendingSignUrl] = useState<string | null>(null);
  const [pendingDocData, setPendingDocData] = useState<any>(null);
  const [sendingLink, setSendingLink] = useState(false);
  const [fetchedContactData, setFetchedContactData] = useState<Record<string, any>>({});
  const [fetchedLeadData, setFetchedLeadData] = useState<Record<string, any>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dbMessages, setDbMessages] = useState<Array<{ direction: string; message_text: string | null; media_url?: string | null; media_type?: string | null; created_at?: string }>>([]);

  // Signers state
  const [signers, setSigners] = useState<SignerInfo[]>([]);
  const [messagePeriod, setMessagePeriod] = useState<string>('7d');
  const [nextLeadNumber, setNextLeadNumber] = useState<string | null>(null);
  const [lastLeadNumber, setLastLeadNumber] = useState<string | null>(null);
  const [showNumberConfirm, setShowNumberConfirm] = useState(false);
  const [confirmStep, setConfirmStep] = useState<null | 'pre-create' | 'pre-send'>(null);

  // Funnel defaults (source of truth — configured in Onboarding > Grupo)
  const [funnelDefaults, setFunnelDefaults] = useState<{
    signer_auth_mode: string;
    notify_on_signature: boolean;
    send_signed_pdf: boolean;
  }>({ signer_auth_mode: 'assinaturaTela', notify_on_signature: true, send_signed_pdf: true });

  const applyFunnelDefaults = (data: any) => {
    const auth = data?.signer_auth_mode || 'assinaturaTela';
    const nextDefaults = {
      signer_auth_mode: auth,
      notify_on_signature: data?.notify_on_signature !== false,
      send_signed_pdf: data?.send_signed_pdf !== false,
    };
    setFunnelDefaults(nextDefaults);
    setSigners(prev => prev.map(s => ({ ...s, auth_mode: auth })));
    return nextDefaults;
  };

  const authModeLabels: Record<string, string> = {
    assinaturaTela: '✍️ Assinatura em tela',
    tokenEmail: '📧 Token por e-mail',
    tokenSms: '📱 Token por SMS',
    assinaturaImagem: '🖼️ Assinatura por imagem',
    selfieFoto: '🤳 Selfie',
    selfieDocFoto: '🪪 Selfie + foto do documento',
  };

  // Filter messages by period
  const filteredMessages = useMemo(() => {
    // Use DB messages (full history) when available, fall back to props
    const source = dbMessages.length > 0 ? dbMessages : messages;
    if (messagePeriod === 'all') return source;
    const now = new Date();
    let cutoff: Date;
    switch (messagePeriod) {
      case 'today': cutoff = startOfDay(now); break;
      case '3d': cutoff = subDays(now, 3); break;
      case '7d': cutoff = subDays(now, 7); break;
      case '15d': cutoff = subDays(now, 15); break;
      case '30d': cutoff = subDays(now, 30); break;
      default: cutoff = subDays(now, 7);
    }
    const cutoffTs = cutoff.getTime();
    return source.filter(m => {
      const ts = (m as any).created_at || (m as any).timestamp;
      if (!ts) return true;
      return new Date(ts).getTime() >= cutoffTs;
    });
  }, [messages, dbMessages, messagePeriod]);

  const messageCountByPeriod = useMemo(() => {
    const now = new Date();
    const source = dbMessages.length > 0 ? dbMessages : messages;
    const countFor = (days: number | 'today' | 'all') => {
      if (days === 'all') return source.length;
      const cutoff = days === 'today' ? startOfDay(now) : subDays(now, days as number);
      return source.filter(m => {
        const ts = (m as any).created_at || (m as any).timestamp;
        if (!ts) return true;
        return new Date(ts).getTime() >= cutoff.getTime();
      }).length;
    };
    return {
      today: countFor('today'),
      '3d': countFor(3),
      '7d': countFor(7),
      '15d': countFor(15),
      '30d': countFor(30),
      all: countFor('all'),
    };
  }, [messages, dbMessages]);

  // Fetch full message history from database when dialog opens
  const fetchDbMessages = async () => {
    if (!phone) return;
    try {
      const { data, error } = await externalSupabase
        .from('whatsapp_messages')
        .select('direction, message_text, media_url, media_type, message_type, created_at')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!error && data && data.length > 0) {
        setDbMessages(data);
      }
    } catch (err) {
      console.error('Error fetching messages for ZapSign extraction:', err);
    }
  };

  const fetchCrmData = async () => {
    if (contactId) {
      try {
        const { data } = await externalSupabase.from('contacts').select('*').eq('id', contactId).single();
        if (data) setFetchedContactData(data);
      } catch {}
    }
    if (leadId) {
      try {
        const { data } = await externalSupabase.from('leads').select('*').eq('id', leadId).single();
        if (data) setFetchedLeadData(data);
      } catch {}
    }
  };

  useEffect(() => {
    if (open) {
      loadTemplates();
      fetchCrmData();
      fetchDbMessages();
      fetchFunnelDefaults();
      setStep('select');
      setTemplateFields([]);
      setSelectedTemplate('');
      setUploadedDocs([]);
      setPastedText('');
      setExtractionSource('upload_and_chat');
      setMessagePeriod('7d');
      setPreviewPdfUrl(null);
      setShowPreview(false);
      setPendingSignUrl(null);
      setPendingDocData(null);
      setSendingLink(false);
      setDbMessages([]);
      // Initialize with default signer from contact/lead
      const defaultName = contactName || contactData?.full_name || leadData?.lead_name || '';
      const defaultEmail = contactData?.email || leadData?.email || '';
      const defaultPhone = phone || contactData?.phone || leadData?.phone || '';
      setSigners([{ name: defaultName, email: defaultEmail, phone: defaultPhone, role: 'sign', auth_mode: 'assinaturaTela' }]);
    }
  }, [open]);

  // Load funnel defaults (configured in Onboarding > Grupo) — source of truth
  const fetchFunnelDefaults = async (templateToken?: string) => {
    try {
      let boardId: string | null = null;
      if (leadId) {
        const { data: lead } = await externalSupabase.from('leads').select('board_id').eq('id', leadId).maybeSingle();
        boardId = (lead as any)?.board_id || null;
      }
      if (!boardId && !templateToken) return null;

      let query = (externalSupabase as any)
        .from('funnel_zapsign_defaults')
        .select('board_id, signer_auth_mode, notify_on_signature, send_signed_pdf')
        .limit(1);

      query = boardId
        ? query.eq('board_id', boardId)
        : query.eq('zapsign_template_token', templateToken);

      const { data } = await query.maybeSingle();
      if (data) {
        boardId = boardId || (data as any).board_id || null;
        const defaults = applyFunnelDefaults(data);

        if (!boardId) return defaults;
      }

      // Fetch next/last lead numbering for confirmation step
      const { data: settings } = await (externalSupabase as any)
        .from('board_group_settings')
        .select('closed_group_name_prefix, closed_current_sequence, group_name_prefix, current_sequence')
        .eq('board_id', boardId)
        .maybeSingle();
      if (settings) {
        const prefix = settings.closed_group_name_prefix || settings.group_name_prefix || '';
        const currentSeq = settings.closed_current_sequence ?? settings.current_sequence ?? 0;
        const next = currentSeq + 1;
        const pad = (n: number) => String(n).padStart(4, '0');
        setNextLeadNumber(prefix ? `${prefix} ${pad(next)}` : pad(next));
        setLastLeadNumber(currentSeq > 0 ? (prefix ? `${prefix} ${pad(currentSeq)}` : pad(currentSeq)) : null);
      }
    } catch (err) {
      console.error('Error fetching funnel defaults:', err);
    }
  };

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('zapsign-api', {
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
        setUploadedDocs(prev => [...prev, { name: file.name, type: file.type, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeDoc = (index: number) => {
    setUploadedDocs(prev => prev.filter((_, i) => i !== index));
  };

  // Signer management
  const addSigner = () => {
    setSigners(prev => [...prev, { name: '', email: '', phone: '', role: 'witness', auth_mode: funnelDefaults.signer_auth_mode || 'assinaturaTela' }]);
  };

  const removeSigner = (index: number) => {
    if (signers.length <= 1) return;
    setSigners(prev => prev.filter((_, i) => i !== index));
  };

  const updateSigner = (index: number, field: keyof SignerInfo, value: string) => {
    setSigners(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const roleLabels: Record<string, string> = {
    sign: 'Assinar',
    witness: 'Testemunha',
    approve: 'Aprovar',
  };

  const [extractingSigners, setExtractingSigners] = useState(false);

  // After selecting template, extract signers with AI then go to signers step
  const handleSelectTemplate = async () => {
    if (!selectedTemplate) return;
    setStep('signers');
    setExtractingSigners(true);

    try {
      const defaults = await fetchFunnelDefaults(selectedTemplate);
      const configuredAuthMode = defaults?.signer_auth_mode || funnelDefaults.signer_auth_mode || 'assinaturaTela';
      const { data, error } = await cloudFunctions.invoke('zapsign-api', {
        body: {
          action: 'extract_signers',
          messages: extractionSource === 'upload_only' ? (pastedText ? [{ direction: 'inbound', message_text: pastedText }] : []) : [...filteredMessages.slice(-50), ...(pastedText ? [{ direction: 'inbound', message_text: pastedText }] : [])],
          contact_data: contactData || fetchedContactData || {},
          lead_data: leadData || fetchedLeadData || {},
          uploaded_documents: uploadedDocs.map(d => ({ name: d.name, type: d.type, dataUrl: d.dataUrl })),
        },
      });

      if (data?.success && Array.isArray(data.signers) && data.signers.length > 0) {
        const extracted: SignerInfo[] = data.signers.map((s: any, idx: number) => ({
          name: s.name || '',
          email: s.email || '',
          phone: s.phone || '',
          role: idx === 0 ? 'sign' : (s.role === 'witness' ? 'witness' : s.role || 'witness'),
          auth_mode: configuredAuthMode,
        }));
        // Merge: keep defaults for empty fields on main signer
        const defaultSigner = signers[0];
        if (extracted[0]) {
          if (!extracted[0].email && defaultSigner?.email) extracted[0].email = defaultSigner.email;
          if (!extracted[0].phone && defaultSigner?.phone) extracted[0].phone = defaultSigner.phone;
          if (!extracted[0].name && defaultSigner?.name) extracted[0].name = defaultSigner.name;
        }
        setSigners(extracted);
        const witnessCount = extracted.length - 1;
        if (witnessCount > 0) {
          toast.success(`IA identificou ${witnessCount} testemunha(s) na conversa!`);
        } else {
          toast.info('IA extraiu o nome do signatário. Você pode editar ou adicionar testemunhas.');
        }
      }
    } catch (err) {
      console.error('Error extracting signers:', err);
    } finally {
      setExtractingSigners(false);
    }
  };

  // After configuring signers, proceed to fill fields
  const handleConfirmSigners = async () => {
    const mainSigner = signers[0];
    if (!mainSigner?.name.trim()) {
      toast.error('Informe o nome do signatário principal.');
      return;
    }
    setStep('fill');
    setExtracting(true);

    try {
      const [templateRes] = await Promise.all([
        cloudFunctions.invoke('zapsign-api', {
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
      const { data, error } = await cloudFunctions.invoke('zapsign-api', {
        body: {
          action: 'extract_data',
          messages: extractionSource === 'upload_only' ? (pastedText ? [{ direction: 'inbound', message_text: pastedText }] : []) : [...filteredMessages.slice(-50), ...(pastedText ? [{ direction: 'inbound', message_text: pastedText }] : [])],
          template_fields: vars.length > 0 ? vars : undefined,
          lead_data: leadData || fetchedLeadData || {},
          contact_data: contactData || fetchedContactData || {},
          uploaded_documents: uploadedDocs.map(d => ({ name: d.name, type: d.type, dataUrl: d.dataUrl })),
          extraction_source: extractionSource,
        },
      });
      if (data?.success && Array.isArray(data.extracted_data)) {
        const extracted: ExtractedField[] = data.extracted_data
          .filter((item: any) => item.de)
          .map((item: any) => ({ de: item.de, para: item.para || '', editing: false, source: 'ai' as const }));
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
    if (missing.length === 0) { toast.info('Todos os campos já estão preenchidos!'); return; }
    const fieldNames = missing.map(f => formatFieldLabel(f.de)).join('\n• ');
    const name = signers[0]?.name || contactName || '';
    const message = `Olá ${name}! 👋\n\nPara dar andamento ao seu documento, preciso que me envie os seguintes dados:\n\n• ${fieldNames}\n\nPor favor, envie as informações aqui pelo chat. Obrigado! 🙏`;
    if (onSendMessage) {
      const sent = await onSendMessage(message);
      if (sent) toast.success('Mensagem enviada pedindo os dados faltantes!');
    } else {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada!');
    }
  };

  const handleCreateDocument = async (skipConfirm = false) => {
    if (!selectedTemplate) return;
    if (!skipConfirm) {
      setConfirmStep('pre-create');
      return;
    }
    setCreating(true);
    try {
      const template = templates.find(t => t.token === selectedTemplate);
      const mainSigner = signers[0];
      const filledFieldsData = templateFields.filter(f => f.de && f.para.trim());

      // Build signers array for the API
      const signersPayload = signers.map(s => ({
        name: s.name,
        email: s.email || undefined,
        phone: s.phone || undefined,
        role: s.role,
        auth_mode: s.auth_mode || 'assinaturaTela',
      }));

      const { data, error } = await cloudFunctions.invoke('zapsign-api', {
        body: {
          action: 'create_doc',
          template_id: selectedTemplate,
          signer_name: mainSigner.name,
          signer_email: mainSigner.email || undefined,
          signer_phone: mainSigner.phone || undefined,
          signers: signersPayload,
          data: filledFieldsData,
          document_name: template?.name || 'Documento',
          lead_id: leadId || null,
          contact_id: contactId || null,
          legal_case_id: legalCaseId || null,
          created_by: user?.id || null,
          send_via_whatsapp: false,
           whatsapp_phone: phone,
           notify_on_signature: funnelDefaults.notify_on_signature,
           send_signed_pdf: funnelDefaults.send_signed_pdf,
           instance_name: instanceName || null,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar documento');

      const url = data.sign_url;
      const originalPdfUrl = data.document?.original_file || null;
      const emptyFieldsList = templateFields.filter(f => f.de && !f.para.trim());

      setPendingSignUrl(url);
      setPendingDocData({ template, signerName: mainSigner.name, emptyFieldsList, allSignUrls: data.all_sign_urls || [] });

      if (originalPdfUrl) setPreviewPdfUrl(originalPdfUrl);
      setShowPreview(true);
      toast.success('Documento gerado! Confira o PDF antes de enviar.');
    } catch (err: any) {
      toast.error('Erro: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSendSigningLink = async (skipConfirm = false) => {
    console.log('[ZapSignDialog] handleSendSigningLink', {
      hasPendingUrl: !!pendingSignUrl,
      hasOnSendMessage: !!onSendMessage,
      pendingSignUrl,
      skipConfirm,
    });
    if (!pendingSignUrl || !onSendMessage) {
      console.warn('[ZapSignDialog] aborted: missing url or sender');
      return;
    }
    if (!skipConfirm) {
      setConfirmStep('pre-send');
      return;
    }
    setSendingLink(true);
    try {
      const { template, signerName, emptyFieldsList } = pendingDocData || {};
      const missingList = emptyFieldsList?.length > 0
        ? `\n\n⚠️ *Campos para você preencher:*\n${emptyFieldsList.map((f: any) => `• ${formatFieldLabel(f.de)}`).join('\n')}`
        : '';

      const message = `📝 *Documento para assinatura*\n\nOlá ${signerName}! Segue o link para assinar o documento *${template?.name || 'Documento'}*:\n\n👉 ${pendingSignUrl}${missingList}\n\n*Instruções:*\n1. Clique no link acima\n2. ${emptyFieldsList?.length > 0 ? 'Preencha os campos indicados' : 'Confira seus dados'}\n3. Assine digitalmente no local indicado\n4. Pronto! Você receberá uma cópia por email.\n\nQualquer dúvida, estou à disposição! 🙏`;

      console.log('[ZapSignDialog] calling onSendMessage', { messageLength: message.length });
      const sent = await onSendMessage(message);
      console.log('[ZapSignDialog] onSendMessage returned', { sent });
      if (sent) {
        toast.success('Link de assinatura enviado pelo WhatsApp!');
        onOpenChange(false);
      } else {
        toast.error('Não foi possível enviar a mensagem.');
      }
    } catch (err: any) {
      console.error('[ZapSignDialog] handleSendSigningLink exception', err);
      toast.error('Erro ao enviar: ' + err.message);
    } finally {
      setSendingLink(false);
    }
  };

  const filledFields = templateFields.filter(f => f.para.trim() && !f.editing);
  const emptyFields = templateFields.filter(f => f.de && (!f.para.trim() || f.editing));

  const findStateValue = () => {
    const f = templateFields.find(tf => detectLocationFieldType(tf.de) === 'state');
    return f?.para || '';
  };

  const setFieldByType = (type: 'state' | 'city' | 'cep', value: string) => {
    setTemplateFields(prev => prev.map(f => detectLocationFieldType(f.de) === type ? { ...f, para: value } : f));
  };

  const renderFieldCard = (field: ExtractedField, globalIndex: number) => {
    const locType = detectLocationFieldType(field.de);
    return (
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
          {!locType && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleEditField(globalIndex)}>
              {field.editing ? <Check className="h-3 w-3 text-primary" /> : <Pencil className="h-3 w-3" />}
            </Button>
          )}
        </div>
      </div>
      {locType === 'state' ? (
        <StateCombobox
          value={field.para}
          onChange={v => {
            updateFieldValue(globalIndex, v);
            // limpa cidade se UF mudar
            setTemplateFields(prev => prev.map(f => detectLocationFieldType(f.de) === 'city' ? { ...f, para: '' } : f));
          }}
        />
      ) : locType === 'city' ? (
        <CityCombobox
          value={field.para}
          onChange={v => updateFieldValue(globalIndex, v)}
          stateUf={findStateValue()}
        />
      ) : locType === 'cep' ? (
        <CepInput
          value={field.para}
          onChange={v => updateFieldValue(globalIndex, v)}
          onAddressFound={addr => {
            setFieldByType('state', addr.state);
            // pequeno delay para o fetch de cidades carregar antes
            setTimeout(() => setFieldByType('city', addr.city), 50);
          }}
        />
      ) : field.editing ? (
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
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            {showPreview && 'Conferir Documento Gerado'}
            {!showPreview && step === 'select' && 'Gerar Documento para Assinatura'}
            {!showPreview && step === 'signers' && 'Configurar Signatários'}
            {!showPreview && step === 'fill' && 'Revisar e Preencher Campos'}
            {!showPreview && step === 'creating' && 'Criando documento...'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select template + upload docs */}
        {step === 'select' && (
          <div className="space-y-4 flex-1 overflow-auto">
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
                    <SelectTrigger><SelectValue placeholder="Selecione um modelo" /></SelectTrigger>
                    <SelectContent>
                      {templates.map(t => (
                        <SelectItem key={t.token} value={t.token}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templates.length === 0 && !loading && (
                    <p className="text-xs text-muted-foreground mt-1">Nenhum modelo encontrado.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    Documentos para extração (opcional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Envie RG, CPF, comprovante de endereço, etc. A IA irá extrair os dados automaticamente.
                  </p>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" onChange={handleFileUpload} className="hidden" />
                  <Button variant="outline" size="sm" className="w-full gap-2 border-dashed" onClick={() => fileInputRef.current?.click()}>
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

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Texto para extração (opcional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Cole aqui informações do cliente (nome, CPF, endereço, etc.) para a IA extrair automaticamente.
                  </p>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                    placeholder="Ex: João da Silva, CPF 123.456.789-00, RG 1234567, Rua das Flores 123, Bairro Centro, Teresina-PI, CEP 64000-000..."
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Fonte de extração da IA</Label>
                  <Select value={extractionSource} onValueChange={(v: 'upload_only' | 'upload_and_chat') => setExtractionSource(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upload_and_chat">📄 Uploads + 💬 Conversa do chat</SelectItem>
                      <SelectItem value="upload_only">📄 Somente uploads</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {extractionSource === 'upload_and_chat' && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Período da conversa ({filteredMessages.length} mensagens)
                    </Label>
                    <Select value={messagePeriod} onValueChange={setMessagePeriod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="today">Hoje ({messageCountByPeriod.today} msgs)</SelectItem>
                        <SelectItem value="3d">Últimos 3 dias ({messageCountByPeriod['3d']} msgs)</SelectItem>
                        <SelectItem value="7d">Últimos 7 dias ({messageCountByPeriod['7d']} msgs)</SelectItem>
                        <SelectItem value="15d">Últimos 15 dias ({messageCountByPeriod['15d']} msgs)</SelectItem>
                        <SelectItem value="30d">Últimos 30 dias ({messageCountByPeriod['30d']} msgs)</SelectItem>
                        <SelectItem value="all">Todas ({messageCountByPeriod.all} msgs)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 2: Configure signers */}
        {step === 'signers' && !showPreview && (
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            {extractingSigners ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">IA analisando conversa para identificar signatários e testemunhas...</span>
              </div>
            ) : (
            <>
            <p className="text-sm text-muted-foreground">
              A IA identificou os signatários abaixo. Você pode editar ou adicionar testemunhas.
            </p>

            <ScrollArea className="flex-1 min-h-0 pr-2">
              <div className="space-y-4 pb-2">
                {signers.map((signer, idx) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-3 bg-card">
                    <div className="flex items-center justify-between">
                      <Badge variant={idx === 0 ? 'default' : 'secondary'} className="text-xs">
                        {idx === 0 ? '📝 Signatário principal' : `👁️ ${roleLabels[signer.role] || 'Testemunha'} ${idx}`}
                      </Badge>
                      {idx > 0 && (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeSigner(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">Nome *</Label>
                        <Input
                          placeholder="Nome completo"
                          value={signer.name}
                          onChange={e => updateSigner(idx, 'name', e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Celular</Label>
                        <Input
                          placeholder="5511999999999"
                          value={signer.phone}
                          onChange={e => updateSigner(idx, 'phone', e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      {idx > 0 && (
                        <div>
                          <Label className="text-xs">Função</Label>
                          <Select value={signer.role} onValueChange={(v) => updateSigner(idx, 'role', v)}>
                            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sign">Assinar</SelectItem>
                              <SelectItem value="witness">Testemunha</SelectItem>
                              <SelectItem value="approve">Aprovar</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Button variant="outline" size="sm" className="w-full gap-2 border-dashed" onClick={addSigner}>
              <UserPlus className="h-4 w-4" />
              Adicionar testemunha / signatário
            </Button>

            {/* Configuração herdada do Onboarding (somente leitura) */}
            <div className="border rounded-lg p-3 space-y-2 bg-muted/20 mt-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">⚙️ Configuração do funil</Label>
                <span className="text-[10px] text-muted-foreground italic">Definido no Onboarding › Grupo</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Modo de assinatura:</span>
                <Badge variant="secondary" className="text-[10px]">
                  {authModeLabels[funnelDefaults.signer_auth_mode] || funnelDefaults.signer_auth_mode}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={funnelDefaults.notify_on_signature ? 'text-foreground' : 'text-muted-foreground line-through'}>
                  {funnelDefaults.notify_on_signature ? '✅' : '⛔'} Avisar quando o documento for assinado
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={funnelDefaults.send_signed_pdf ? 'text-foreground' : 'text-muted-foreground line-through'}>
                  {funnelDefaults.send_signed_pdf ? '✅' : '⛔'} Enviar o PDF assinado via WhatsApp
                </span>
              </div>
            </div>
            </>
            )}
          </div>
        )}

        {/* PDF Preview after creation */}
        {showPreview && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>Documento gerado! Confira o PDF abaixo antes de enviar o link.</span>
            </div>
            {previewPdfUrl ? (
              <div className="flex-1 overflow-hidden rounded-lg border bg-muted/30 flex flex-col items-center justify-center p-4 min-h-[200px]">
                <object data={previewPdfUrl} type="application/pdf" className="w-full h-[400px] rounded-lg">
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <p className="text-sm text-muted-foreground text-center">Não foi possível carregar a pré-visualização.</p>
                    <a href={previewPdfUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition">
                      Abrir PDF em nova aba
                    </a>
                  </div>
                </object>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-8">
                <p className="text-sm text-muted-foreground">Pré-visualização não disponível.</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground text-center">
              📄 Confira se o documento está correto. Clique em "Enviar link de assinatura" para enviar ao cliente.
            </p>
          </div>
        )}

        {/* Step 3: Review fields and send */}
        {step === 'fill' && !showPreview && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            {extracting ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Extraindo dados com IA...</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={handleViewPrompt} className="gap-1 h-7 text-xs">
                    <Eye className="h-3 w-3" /> Ver prompt da IA
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setExtracting(true); extractDataWithAI().finally(() => setExtracting(false)); }} className="ml-auto gap-1 h-7 text-xs">
                    <Sparkles className="h-3 w-3" /> Re-extrair com IA
                  </Button>
                </div>

                <Tabs defaultValue="filled" className="flex-1 overflow-hidden flex flex-col">
                  <TabsList className="w-full grid grid-cols-2 shrink-0">
                    <TabsTrigger value="filled" className="gap-1.5 text-xs">
                      <CheckCircle2 className="h-3 w-3" /> Preenchidos ({filledFields.length})
                    </TabsTrigger>
                    <TabsTrigger value="missing" className="gap-1.5 text-xs">
                      <AlertCircle className="h-3 w-3" /> Faltantes ({emptyFields.length})
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
                      <Send className="h-3 w-3" /> Pedir dados faltantes
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          {showPreview && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button className="flex-1 gap-2" onClick={() => handleSendSigningLink(false)} disabled={sendingLink}>
                {sendingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar link de assinatura
              </Button>
            </div>
          )}
          {step === 'select' && !showPreview && (
            <Button onClick={handleSelectTemplate} disabled={!selectedTemplate}>
              <Sparkles className="h-4 w-4 mr-2" /> Próximo: Signatários
            </Button>
          )}
          {step === 'signers' && !showPreview && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setStep('select')}>Voltar</Button>
              <Button className="flex-1 gap-2" onClick={handleConfirmSigners} disabled={!signers[0]?.name.trim() || extractingSigners}>
                {extractingSigners ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Extrair dados e preencher
              </Button>
            </div>
          )}
          {step === 'fill' && !extracting && !showPreview && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setStep('signers')}>Voltar</Button>
              <Button className="flex-1 gap-2" onClick={() => handleCreateDocument(false)} disabled={creating || emptyFields.length > 0}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                {emptyFields.length > 0 ? `Preencha ${emptyFields.length} campo(s) faltante(s)` : 'Gerar documento'}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-primary" /> Prompt enviado para a IA
            </DialogTitle>
          </DialogHeader>
          {loadingPrompt ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col gap-3">
              {previewAttachments && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">📝 {previewAttachments.text_messages} msgs</Badge>
                  <Badge variant="secondary">🖼️ {previewAttachments.chat_images} imgs chat</Badge>
                  <Badge variant="secondary">📄 {previewAttachments.chat_pdfs} PDFs chat</Badge>
                  <Badge variant="secondary">⬆️ {previewAttachments.uploaded_images} imgs upload</Badge>
                  <Badge variant="secondary">⬆️ {previewAttachments.uploaded_pdfs} PDFs upload</Badge>
                </div>
              )}
              <Textarea
                value={previewPrompt}
                readOnly
                className="flex-1 min-h-[400px] text-xs font-mono leading-relaxed"
              />
              <div className="flex justify-between items-center">
                <p className="text-[10px] text-muted-foreground">
                  Mídias são anexadas em paralelo ao texto acima.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(previewPrompt);
                    toast.success('Prompt copiado!');
                  }}
                  className="gap-1 h-7 text-xs"
                >
                  <Copy className="h-3 w-3" /> Copiar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmStep !== null} onOpenChange={(o) => { if (!o) setConfirmStep(null); }}>
        <AlertDialogContent>
          {confirmStep === 'pre-create' && (() => {
            const mainSigner = signers[0];
            const effectiveAuth = mainSigner?.auth_mode || funnelDefaults.signer_auth_mode;
            const authMatches = effectiveAuth === funnelDefaults.signer_auth_mode;
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar geração do documento</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3 text-sm pt-2">
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Lead / Caso</div>
                        {nextLeadNumber && <div>➡️ Próximo: <span className="font-mono font-medium">{nextLeadNumber}</span></div>}
                        {lastLeadNumber && <div>📌 Último fechado: <span className="font-mono">{lastLeadNumber}</span></div>}
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Signatário principal</div>
                        <div>👤 {mainSigner?.name || '—'}</div>
                        <div className="text-xs text-muted-foreground">📱 {mainSigner?.phone || phone || '—'} {mainSigner?.email && `· ✉️ ${mainSigner.email}`}</div>
                        {signers.length > 1 && <div className="text-xs">+ {signers.length - 1} testemunha(s)/co-signatário(s)</div>}
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Modo de assinatura</div>
                        <div>{authModeLabels[effectiveAuth] || effectiveAuth}</div>
                        {!authMatches && (
                          <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                            ⚠️ Modo dos signatários ({authModeLabels[effectiveAuth] || effectiveAuth}) difere do configurado no funil ({authModeLabels[funnelDefaults.signer_auth_mode] || funnelDefaults.signer_auth_mode}).
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground border-t pt-2">
                        Ao confirmar, o documento será criado no ZapSign. O link só será enviado depois de você revisar o PDF.
                      </div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setConfirmStep(null)}>Cancelar</AlertDialogCancel>
                  <Button variant="outline" onClick={() => { setConfirmStep(null); setStep('signers'); }}>Editar signatários</Button>
                  <AlertDialogAction onClick={() => { setConfirmStep(null); handleCreateDocument(true); }}>Confirmar e gerar</AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
          {confirmStep === 'pre-send' && (() => {
            const { signerName } = pendingDocData || {};
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar envio do link</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3 text-sm pt-2">
                      <div>O link de assinatura será enviado por WhatsApp para:</div>
                      <div className="bg-muted/50 p-3 rounded space-y-1">
                        <div>👤 <span className="font-medium">{signerName || '—'}</span></div>
                        <div className="text-xs">📱 {phone || '—'}</div>
                        {instanceName && <div className="text-xs text-muted-foreground">via instância: <span className="font-mono">{instanceName}</span></div>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Confirme que o número acima está correto antes de enviar.
                      </div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setConfirmStep(null)}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setConfirmStep(null); handleSendSigningLink(true); }}>Confirmar e enviar</AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
