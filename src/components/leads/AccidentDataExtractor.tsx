import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  Loader2, 
  Sparkles, 
  FileText,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Link as LinkIcon,
  Upload,
  Image as ImageIcon,
  FileUp,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { usePostMetadata } from '@/hooks/usePostMetadata';

// Detect if URL belongs to a social network that Firecrawl cannot scrape
const SOCIAL_HOST_REGEX = /(?:^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.watch|threads\.net|tiktok\.com)$/i;
function isSocialUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.trim());
    return SOCIAL_HOST_REGEX.test(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface ExtractedAccidentData {
  victim_name?: string | null;
  victim_age?: number | null;
  accident_date?: string | null;
  accident_address?: string | null;
  damage_description?: string | null;
  contractor_company?: string | null;
  main_company?: string | null;
  sector?: string | null;
  case_type?: string | null;
  liability_type?: string | null;
  legal_viability?: string | null;
  visit_city?: string | null;
  visit_state?: string | null;
  news_link?: string | null;
}

// Current lead data for comparison
export interface CurrentLeadData {
  victim_name?: string | null;
  victim_age?: number | null;
  accident_date?: string | null;
  accident_address?: string | null;
  damage_description?: string | null;
  contractor_company?: string | null;
  main_company?: string | null;
  sector?: string | null;
  case_type?: string | null;
  liability_type?: string | null;
  legal_viability?: string | null;
  visit_city?: string | null;
  visit_state?: string | null;
  news_link?: string | null;
}

interface AccidentDataExtractorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDataExtracted: (data: ExtractedAccidentData) => void;
  currentData?: CurrentLeadData;
}

type FieldStatus = 'new' | 'conflict' | 'same' | 'empty';

interface FieldComparisonResult {
  key: keyof ExtractedAccidentData;
  label: string;
  extractedValue: string | number | null | undefined;
  currentValue: string | number | null | undefined;
  status: FieldStatus;
  selected: boolean;
}

export function AccidentDataExtractor({
  open,
  onOpenChange,
  onDataExtracted,
  currentData,
}: AccidentDataExtractorProps) {
  const [activeTab, setActiveTab] = useState('link');
  const [documentText, setDocumentText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedAccidentData | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [fieldSelections, setFieldSelections] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { fetchMetadata } = usePostMetadata();

  const fieldLabels: Record<keyof ExtractedAccidentData, string> = {
    victim_name: 'Nome da Vítima',
    victim_age: 'Idade',
    accident_date: 'Data do Acidente',
    accident_address: 'Local do Acidente',
    damage_description: 'Dano / Lesão',
    contractor_company: 'Empresa Terceirizada',
    main_company: 'Empresa Tomadora',
    sector: 'Setor',
    case_type: 'Tipo de Caso',
    liability_type: 'Tipo de Responsabilidade',
    legal_viability: 'Viabilidade Jurídica',
    visit_city: 'Cidade',
    visit_state: 'Estado',
    news_link: 'Link da Notícia',
  };

  const comparisons = useMemo<FieldComparisonResult[]>(() => {
    if (!extractedData) return [];

    const fields: (keyof ExtractedAccidentData)[] = [
      'victim_name', 'victim_age', 'accident_date', 'accident_address',
      'damage_description', 'contractor_company', 'main_company', 'sector',
      'case_type', 'liability_type', 'visit_city', 'visit_state', 'legal_viability', 'news_link'
    ];

    return fields.map(key => {
      const extractedValue = extractedData[key];
      const currentValue = currentData?.[key];

      let status: FieldStatus;
      if (extractedValue === null || extractedValue === undefined || extractedValue === '') {
        status = 'empty';
      } else if (currentValue === null || currentValue === undefined || currentValue === '') {
        status = 'new';
      } else if (String(extractedValue).toLowerCase().trim() !== String(currentValue).toLowerCase().trim()) {
        status = 'conflict';
      } else {
        status = 'same';
      }

      const defaultSelected = status === 'new' || status === 'conflict';
      const selected = fieldSelections[key] ?? defaultSelected;

      return {
        key,
        label: fieldLabels[key],
        extractedValue,
        currentValue,
        status,
        selected,
      };
    }).filter(f => f.status !== 'empty');
  }, [extractedData, currentData, fieldSelections]);

  const selectedCount = useMemo(
    () => comparisons.filter(f => f.selected).length,
    [comparisons]
  );

  const toggleFieldSelection = useCallback((key: string) => {
    setFieldSelections(prev => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }, []);

  const selectAllFields = useCallback((status?: FieldStatus) => {
    setFieldSelections(prev => {
      const newSelections: Record<string, boolean> = { ...prev };
      comparisons.forEach(f => {
        if (!status || f.status === status) {
          newSelections[f.key] = true;
        }
      });
      return newSelections;
    });
  }, [comparisons]);

  const deselectAllFields = useCallback(() => {
    setFieldSelections(() => {
      const newSelections: Record<string, boolean> = {};
      comparisons.forEach(f => {
        newSelections[f.key] = false;
      });
      return newSelections;
    });
  }, [comparisons]);

  const urlIsSocial = useMemo(() => {
    const trimmed = urlInput.trim();
    return trimmed.length > 0 && isSocialUrl(trimmed);
  }, [urlInput]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
      ];
      if (!validTypes.includes(file.type)) {
        toast.error('Tipo de arquivo não suportado. Use PDF, Word ou TXT.');
        return;
      }
      setUploadedFile(file);
      toast.success(`Arquivo "${file.name}" carregado`);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate image type
      if (!file.type.startsWith('image/')) {
        toast.error('Por favor, selecione um arquivo de imagem');
        return;
      }
      setUploadedImage(file);
      toast.success(`Imagem "${file.name}" carregada`);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix to get just the base64 content
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleExtract = async () => {
    setIsExtracting(true);
    setExtractedData(null);

    try {
      // Special path: social-media URLs (Instagram/Facebook/etc.) — Firecrawl gets blocked (403),
      // so we fetch the caption (and optionally comments) via Apify, then send the assembled text
      // to extract-accident-data which has the CORRECT accident schema (victim_name, accident_date, etc.).
      if (activeTab === 'link' && isSocialUrl(urlInput)) {
        const trimmedUrl = urlInput.trim();

        // 1) Fetch caption via Apify
        toast.info('Detectado link de rede social — buscando legenda via Apify...');
        const metadata = await fetchMetadata(trimmedUrl);
        const caption = metadata?.caption?.trim() || '';

        if (!caption) {
          toast.error('Não foi possível extrair a legenda do post. Cole o texto manualmente na aba PDF/Texto.');
          return;
        }

        // 2) Send caption to extract-accident-data as plain text — uses the correct accident schema
        const analysisText = `URL do post: ${trimmedUrl}\n\nLEGENDA:\n${caption}`;
        const { data, error } = await cloudFunctions.invoke('extract-accident-data', {
          body: { content: analysisText, type: 'text' },
        });

        if (error) {
          console.error('extract-accident-data error (social path):', error);
          toast.error('Erro ao analisar dados com IA');
          return;
        }
        if (!data?.success) {
          toast.error(data?.error || 'Não foi possível extrair os dados');
          return;
        }

        // 3) Preserve the source URL so the lead form receives the news/social link
        const merged: ExtractedAccidentData = {
          ...(data.data || {}),
          news_link: trimmedUrl,
        };
        setExtractedData(merged);
        toast.success('Dados extraídos com sucesso!');
        return;
      }

      let requestBody: { content: string; type: string; url?: string; mimeType?: string };

      switch (activeTab) {
        case 'link':
          if (!urlInput.trim()) {
            toast.error('Cole o link da notícia');
            return;
          }
          requestBody = { content: urlInput.trim(), type: 'url', url: urlInput.trim() };
          break;

        case 'document':
          if (uploadedFile) {
            // Read file and send as base64
            const base64Content = await fileToBase64(uploadedFile);
            requestBody = { 
              content: base64Content, 
              type: 'document',
              mimeType: uploadedFile.type,
            };
          } else {
            const sanitizedText = documentText.replace(/\u0000/g, '').trim();
            if (!sanitizedText) {
              toast.error('Cole o texto ou faça upload de um arquivo');
              return;
            }
            const MAX_TEXT_LENGTH = 30000;
            const truncatedText = sanitizedText.length > MAX_TEXT_LENGTH
              ? sanitizedText.slice(0, MAX_TEXT_LENGTH)
              : sanitizedText;
            if (sanitizedText.length > MAX_TEXT_LENGTH) {
              toast.info('Texto muito grande: analisando apenas os primeiros 30.000 caracteres');
            }
            requestBody = { content: truncatedText, type: 'text' };
          }
          break;

        case 'image':
          if (!uploadedImage) {
            toast.error('Faça upload de uma imagem');
            return;
          }
          const imageBase64 = await fileToBase64(uploadedImage);
          requestBody = { 
            content: imageBase64, 
            type: 'image',
            mimeType: uploadedImage.type,
          };
          break;

        default:
          toast.error('Selecione uma opção de entrada');
          return;
      }

      const { data, error } = await cloudFunctions.invoke('extract-accident-data', {
        body: requestBody,
      });

      if (error) {
        console.error('Error extracting data:', error);
        // Extract meaningful error message
        const errorMsg = error?.message || '';
        // Try to parse error body from the message (cloudFunctions wraps status + body)
        const statusMatch = errorMsg.match(/Function error (\d+): (.*)/s);
        if (statusMatch) {
          try {
            const parsed = JSON.parse(statusMatch[2]);
            if (parsed?.error) {
              toast.error(parsed.error);
              return;
            }
          } catch {}
          toast.error(statusMatch[2].slice(0, 200) || 'Erro ao extrair dados');
        } else {
          toast.error(errorMsg || 'Erro ao extrair dados. Tente novamente.');
        }
        return;
      }

      if (!data.success) {
        toast.error(data.error || 'Não foi possível extrair os dados');
        return;
      }

      setExtractedData({
        ...(data.data || {}),
        news_link: activeTab === 'link' ? urlInput.trim() : data.data?.news_link,
      });
      toast.success('Dados extraídos com sucesso!');
    } catch (err) {
      console.error('Error:', err);
      toast.error('Erro ao processar solicitação');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirm = () => {
    if (extractedData) {
      // Build data with only selected fields
      const comparisons = compareFields();
      const selectedData: ExtractedAccidentData = {};
      
      comparisons.forEach(field => {
        if (field.selected && field.extractedValue !== null && field.extractedValue !== undefined) {
          (selectedData as any)[field.key] = field.extractedValue;
        }
      });

      onDataExtracted(selectedData);
      onOpenChange(false);
      resetState();
    }
  };

  const resetState = () => {
    setDocumentText('');
    setUrlInput('');
    setExtractedData(null);
    setUploadedFile(null);
    setUploadedImage(null);
    setActiveTab('link');
    setFieldSelections({});
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  const getStatusBadge = (status: FieldStatus) => {
    switch (status) {
      case 'new':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Novo
          </Badge>
        );
      case 'conflict':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Conflito
          </Badge>
        );
      case 'same':
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
            Igual
          </Badge>
        );
      default:
        return null;
    }
  };

  const formatDisplayValue = (key: string, value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    if (key === 'accident_date' && typeof value === 'string') {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('pt-BR');
        }
      } catch { /* ignore */ }
    }
    return String(value);
  };

  const renderComparisonField = (field: FieldComparisonResult) => {
    return (
      <div 
        key={field.key} 
        className={cn(
          "p-3 rounded-lg border transition-colors",
          field.selected ? "bg-primary/5 border-primary/30" : "bg-muted/30 border-muted"
        )}
      >
        <div className="flex items-start gap-3">
          <Checkbox
            id={`field-${field.key}`}
            checked={field.selected}
            onCheckedChange={() => toggleFieldSelection(field.key)}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label 
                htmlFor={`field-${field.key}`}
                className="text-sm font-medium cursor-pointer"
              >
                {field.label}
              </label>
              {getStatusBadge(field.status)}
            </div>
            
            {field.status === 'conflict' ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground min-w-[50px]">Atual:</span>
                  <span className="text-muted-foreground line-through truncate">
                    {formatDisplayValue(field.key, field.currentValue)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-600 min-w-[50px]">Novo:</span>
                  <ArrowRight className="h-3 w-3 text-emerald-600" />
                  <span className="text-foreground font-medium truncate">
                    {formatDisplayValue(field.key, field.extractedValue)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground truncate">
                {formatDisplayValue(field.key, field.extractedValue)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const canExtract = () => {
    switch (activeTab) {
      case 'link':
        return urlInput.trim().length > 0;
      case 'document':
        return documentText.trim().length > 0 || uploadedFile !== null;
      case 'image':
        return uploadedImage !== null;
      default:
        return false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Extrair Dados do Acidente com IA
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="link" className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                Link
              </TabsTrigger>
              <TabsTrigger value="document" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                PDF / Word
              </TabsTrigger>
              <TabsTrigger value="image" className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Imagem
              </TabsTrigger>
            </TabsList>

            {/* Link Tab */}
            <TabsContent value="link" className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  Cole o link da notícia ou post (Instagram / Facebook)
                </label>
                <Input
                  type="url"
                  placeholder="https://g1.globo.com/... ou https://instagram.com/p/..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                {urlInput.trim() && isSocialUrl(urlInput) ? (
                  <p className="text-xs text-primary mt-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Detectado link de rede social — usaremos Apify (mesma rota do Importar Link Social)
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    A IA irá acessar a página e extrair os dados do acidente
                  </p>
                )}
              </div>

              {urlInput.trim() && isSocialUrl(urlInput) && (
                <div className="rounded-lg border border-dashed p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    Para deixar esse fluxo rápido no Adicionar Lead, aqui eu extraio só a legenda do post e preservo o link da publicação no campo <strong>Link da Notícia</strong>.
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Document Tab */}
            <TabsContent value="document" className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  Upload de documento (PDF, Word, TXT)
                </label>
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                    uploadedFile ? "border-primary/50 bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50"
                  )}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
                      if (!validTypes.includes(file.type)) {
                        toast.error('Tipo de arquivo não suportado. Use PDF, Word ou TXT.');
                        return;
                      }
                      setUploadedFile(file);
                      toast.success(`Arquivo "${file.name}" carregado`);
                    }
                  }}
                  onClick={() => !uploadedFile && fileInputRef.current?.click()}
                >
                  <Input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".pdf,.doc,.docx,.txt"
                    className="hidden"
                  />
                  {uploadedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileUp className="h-5 w-5 text-primary" />
                      <span className="text-sm font-medium">{uploadedFile.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }}
                      >
                        ×
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">Arraste um arquivo aqui ou clique para selecionar</p>
                      <p className="text-xs text-muted-foreground/70">PDF, Word ou TXT</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">ou cole o texto</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Cole o texto da petição, decisão judicial ou notícia
                </label>
                <Textarea
                  placeholder="Cole aqui o conteúdo do documento..."
                  value={documentText}
                  onChange={(e) => setDocumentText(e.target.value)}
                  rows={8}
                  className="resize-none"
                />
              </div>
            </TabsContent>

            {/* Image Tab */}
            <TabsContent value="image" className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Upload de imagem (print de notícia, documento escaneado)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="file"
                    ref={imageInputRef}
                    onChange={handleImageUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex-1"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploadedImage ? uploadedImage.name : 'Escolher imagem'}
                  </Button>
                  {uploadedImage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setUploadedImage(null)}
                    >
                      ×
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  A IA irá analisar a imagem e extrair os dados do acidente (OCR)
                </p>
              </div>

              {uploadedImage && (
                <div className="mt-4 p-4 border rounded-lg">
                  <img
                    src={URL.createObjectURL(uploadedImage)}
                    alt="Preview"
                    className="max-h-48 mx-auto rounded object-contain"
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {!extractedData && (
          <Button 
            onClick={handleExtract} 
            disabled={isExtracting || !canExtract()}
            className="w-full mt-4"
          >
            {isExtracting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extraindo dados...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Extrair Dados com IA
              </>
            )}
          </Button>
        )}

        {extractedData && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Dados extraídos com sucesso!</span>
              </div>
              
              {/* Legend */}
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Novo</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-muted-foreground">Conflito</span>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => selectAllFields()}
                className="text-xs"
              >
                Selecionar Todos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => selectAllFields('new')}
                className="text-xs"
              >
                Só Novos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => deselectAllFields()}
                className="text-xs"
              >
                Limpar Seleção
              </Button>
            </div>

            {/* Fields comparison */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {compareFields().map(field => renderComparisonField(field))}
              
              {compareFields().length === 0 && (
                <div className="flex items-center gap-2 text-amber-600 py-4 justify-center">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">Nenhum dado identificado. Verifique se o conteúdo está completo.</span>
                </div>
              )}
            </div>

            {/* Summary */}
            {compareFields().length > 0 && (
              <div className="text-xs text-muted-foreground">
                {compareFields().filter(f => f.selected).length} de {compareFields().length} campos selecionados
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setExtractedData(null)}>
                Tentar Novamente
              </Button>
              <Button 
                onClick={handleConfirm}
                disabled={compareFields().filter(f => f.selected).length === 0}
              >
                Usar Dados Selecionados
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
