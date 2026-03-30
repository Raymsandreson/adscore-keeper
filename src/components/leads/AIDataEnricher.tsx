import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Loader2, 
  Sparkles, 
  FileText, 
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ArrowRight,
  Link,
  Download,
  ImagePlus,
  X,
  Camera,
  Instagram,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Lead } from '@/hooks/useLeads';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ExtractedField {
  key: string;
  label: string;
  extractedValue: string | number | null;
  currentValue: string | number | null;
  hasConflict: boolean;
  selected: boolean;
}

interface AIDataEnricherProps {
  lead: Lead;
  onApplyData: (updates: Partial<Lead>) => void;
}

const FIELD_LABELS: Record<string, string> = {
  victim_name: 'Nome da Vítima',
  victim_age: 'Idade da Vítima',
  accident_date: 'Data do Acidente',
  accident_address: 'Endereço do Acidente',
  damage_description: 'Descrição do Dano',
  contractor_company: 'Empresa Terceirizada',
  main_company: 'Empresa Tomadora',
  sector: 'Setor',
  case_type: 'Tipo de Caso',
  liability_type: 'Tipo de Responsabilidade',
  legal_viability: 'Viabilidade Jurídica',
  visit_city: 'Cidade',
  visit_state: 'Estado',
  company_size_justification: 'Análise do Porte da Empresa',
};

// Map extracted fields to lead fields
const FIELD_MAP: Record<string, keyof Lead> = {
  victim_name: 'victim_name' as keyof Lead,
  victim_age: 'victim_age' as keyof Lead,
  accident_date: 'accident_date' as keyof Lead,
  accident_address: 'accident_address' as keyof Lead,
  damage_description: 'damage_description' as keyof Lead,
  contractor_company: 'contractor_company' as keyof Lead,
  main_company: 'main_company' as keyof Lead,
  sector: 'sector' as keyof Lead,
  case_type: 'case_type' as keyof Lead,
  liability_type: 'liability_type' as keyof Lead,
  legal_viability: 'legal_viability' as keyof Lead,
  visit_city: 'city',
  visit_state: 'state',
  company_size_justification: 'company_size_justification' as keyof Lead,
};

export function AIDataEnricher({ lead, onApplyData }: AIDataEnricherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [documentText, setDocumentText] = useState('');
  const [newsLink, setNewsLink] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isFetchingLink, setIsFetchingLink] = useState(false);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [hasResults, setHasResults] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [screenshotFromNews, setScreenshotFromNews] = useState<string | null>(null);
  const [isSearchingInstagram, setIsSearchingInstagram] = useState(false);
  const [instagramResults, setInstagramResults] = useState<Array<{
    id: string;
    ownerUsername: string;
    caption: string;
    likesCount: number;
    commentsCount: number;
    url: string;
    timestamp: string;
  }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFetchLink = async () => {
    if (!newsLink.trim()) {
      toast.error('Cole o link da notícia');
      return;
    }

    setIsFetchingLink(true);

    try {
      const { data, error } = await cloudFunctions.invoke('scrape-news', {
        body: { url: newsLink.trim() },
      });

      if (error) {
        console.error('Error fetching link:', error);
        toast.error('Erro ao buscar página');
        return;
      }

      if (!data.success) {
        toast.error(data.error || 'Não foi possível buscar a página');
        return;
      }

      if (data.content) {
        setDocumentText(prev => prev ? `${prev}\n\n${data.content}` : data.content);
        toast.success('Conteúdo da notícia carregado!');
      }
      
      // Capture screenshot from news if available
      if (data.screenshot) {
        setScreenshotFromNews(data.screenshot);
        toast.success('Imagem da notícia capturada!');
      }
      
      if (!data.content && !data.screenshot) {
        toast.warning('Página encontrada mas sem conteúdo de texto ou imagem');
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Erro ao buscar página');
    } finally {
      setIsFetchingLink(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) {
        toast.error('Apenas imagens são permitidas');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        setUploadedImages(prev => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeScreenshot = () => {
    setScreenshotFromNews(null);
  };

  // Generate search keywords from lead data
  const generateSearchKeywords = (): string[] => {
    const keywords: string[] = [];
    const leadAny = lead as any;
    
    if (leadAny.victim_name) keywords.push(leadAny.victim_name);
    if (leadAny.main_company) keywords.push(leadAny.main_company);
    if (leadAny.contractor_company) keywords.push(leadAny.contractor_company);
    if (lead.city && lead.state) keywords.push(`${lead.city} ${lead.state}`);
    if (leadAny.case_type) keywords.push(leadAny.case_type);
    if (leadAny.accident_date) {
      const date = new Date(leadAny.accident_date);
      keywords.push(date.toLocaleDateString('pt-BR'));
    }
    
    return keywords.filter(k => k && k.trim().length > 2);
  };

  const handleSearchInstagram = async () => {
    const keywords = generateSearchKeywords();
    
    if (keywords.length === 0) {
      toast.error('Preencha dados do lead para buscar no Instagram (vítima, empresa, cidade, etc.)');
      return;
    }

    setIsSearchingInstagram(true);
    setInstagramResults([]);

    try {
      // Use Apify to search Instagram posts
      const { data, error } = await cloudFunctions.invoke('search-instagram-posts', {
        body: {
          action: 'start',
          keywords: keywords.slice(0, 3), // Limit to first 3 keywords
          maxPosts: 10,
          period: 30, // Last 30 days
        },
      });

      if (error) {
        console.error('Error searching Instagram:', error);
        toast.error('Erro ao buscar no Instagram');
        return;
      }

      if (!data.success && data.error) {
        toast.error(data.error);
        return;
      }

      // If we got immediate results
      if (data.results && data.results.length > 0) {
        setInstagramResults(data.results);
        toast.success(`${data.results.length} post(s) encontrado(s)!`);
        return;
      }

      // If async run started, we need to poll for results
      if (data.runId) {
        toast.info('Buscando posts no Instagram... isso pode levar alguns segundos');
        
        // Poll for results
        let attempts = 0;
        const maxAttempts = 20;
        
        const pollResults = async () => {
          attempts++;
          
          const { data: statusData, error: statusError } = await cloudFunctions.invoke('search-instagram-posts', {
            body: { action: 'status', runId: data.runId },
          });
          
          if (statusError || !statusData) {
            if (attempts < maxAttempts) {
              setTimeout(pollResults, 3000);
            } else {
              toast.error('Tempo esgotado ao buscar posts');
              setIsSearchingInstagram(false);
            }
            return;
          }
          
          if (statusData.status === 'SUCCEEDED') {
            // Fetch results
            const { data: resultsData } = await cloudFunctions.invoke('search-instagram-posts', {
              body: { action: 'results', runId: data.runId },
            });
            
            if (resultsData?.results) {
              setInstagramResults(resultsData.results);
              toast.success(`${resultsData.results.length} post(s) encontrado(s)!`);
            }
            setIsSearchingInstagram(false);
          } else if (statusData.status === 'FAILED' || statusData.status === 'ABORTED') {
            toast.error('Busca no Instagram falhou');
            setIsSearchingInstagram(false);
          } else if (attempts < maxAttempts) {
            setTimeout(pollResults, 3000);
          } else {
            toast.error('Tempo esgotado ao buscar posts');
            setIsSearchingInstagram(false);
          }
        };
        
        setTimeout(pollResults, 3000);
      } else {
        toast.info('Nenhum post encontrado com as palavras-chave');
        setIsSearchingInstagram(false);
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Erro ao buscar no Instagram');
      setIsSearchingInstagram(false);
    }
  };
  
  const handleExtract = async () => {
    // Collect all images
    const allImages: string[] = [];
    if (screenshotFromNews) allImages.push(screenshotFromNews);
    allImages.push(...uploadedImages);

    const sanitizedText = documentText.replace(/\u0000/g, '').trim();

    if (!sanitizedText && allImages.length === 0) {
      toast.error('Cole o texto ou adicione imagens para análise');
      return;
    }

    const MAX_TEXT_LENGTH = 30000;
    const truncatedText = sanitizedText.length > MAX_TEXT_LENGTH
      ? sanitizedText.slice(0, MAX_TEXT_LENGTH)
      : sanitizedText;

    if (sanitizedText.length > MAX_TEXT_LENGTH) {
      toast.info('Texto muito grande: analisando apenas os primeiros 30.000 caracteres');
    }

    setIsExtracting(true);
    setExtractedFields([]);
    setHasResults(false);

    try {
      const { data, error } = await cloudFunctions.invoke('extract-accident-data', {
        body: {
          content: truncatedText || null,
          type: 'text',
          images: allImages.length > 0 ? allImages : undefined,
        },
      });

      if (error) {
        console.error('Error extracting data:', error);
        try {
          const errorBody = null;
          if (errorBody?.error) {
            toast.error(errorBody.error);
            return;
          }
        } catch {}

        const status = null;
        if (status === 413) {
          toast.error('Texto muito grande para processamento. Tente com um trecho menor.');
          return;
        }

        toast.error('Erro ao extrair dados. Tente novamente.');
        return;
      }

      if (!data.success) {
        toast.error(data.error || 'Não foi possível extrair os dados');
        return;
      }

      // Compare extracted data with current lead data
      const extracted = data.data;
      const fields: ExtractedField[] = [];

      Object.entries(extracted).forEach(([key, extractedValue]) => {
        if (extractedValue === null || extractedValue === undefined) return;
        
        const leadField = FIELD_MAP[key];
        if (!leadField) return;

        const currentValue = (lead as any)[leadField];
        const hasValue = currentValue !== null && currentValue !== undefined && currentValue !== '';
        const hasConflict = hasValue && String(currentValue) !== String(extractedValue);

        fields.push({
          key,
          label: FIELD_LABELS[key] || key,
          extractedValue: extractedValue as string | number,
          currentValue: currentValue,
          hasConflict,
          // Auto-select only if no conflict (new data) or if it's empty
          selected: !hasConflict || !hasValue,
        });
      });

      if (fields.length === 0) {
        toast.info('Nenhuma informação nova foi identificada no texto');
        return;
      }

      setExtractedFields(fields);
      setHasResults(true);

      const conflictsCount = fields.filter(f => f.hasConflict).length;
      const newFieldsCount = fields.filter(f => !f.hasConflict).length;

      if (conflictsCount > 0) {
        toast.warning(`${conflictsCount} conflito(s) detectado(s). Revise antes de aplicar.`);
      } else {
        toast.success(`${newFieldsCount} informação(ões) nova(s) identificada(s)!`);
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Erro ao processar solicitação');
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleFieldSelection = (key: string) => {
    setExtractedFields(prev => 
      prev.map(f => f.key === key ? { ...f, selected: !f.selected } : f)
    );
  };

  const updateFieldValue = (key: string, newValue: string | number) => {
    setExtractedFields(prev => 
      prev.map(f => f.key === key ? { ...f, extractedValue: newValue } : f)
    );
  };

  const handleApply = () => {
    const updates: Partial<Lead> = {};
    
    extractedFields
      .filter(f => f.selected)
      .forEach(f => {
        const leadField = FIELD_MAP[f.key];
        if (leadField) {
          (updates as any)[leadField] = f.extractedValue;
        }
      });

    // Incluir link da notícia se fornecido
    if (newsLink.trim()) {
      updates.news_link = newsLink.trim();
    }

    if (Object.keys(updates).length === 0) {
      toast.info('Nenhum campo selecionado para aplicar');
      return;
    }

    onApplyData(updates);
    
    // Reset state
    setDocumentText('');
    setNewsLink('');
    setExtractedFields([]);
    setHasResults(false);
    setUploadedImages([]);
    setScreenshotFromNews(null);
    setIsOpen(false);
    
    toast.success(`${Object.keys(updates).length} campo(s) atualizado(s)!`);
  };

  const conflicts = extractedFields.filter(f => f.hasConflict);
  const newFields = extractedFields.filter(f => !f.hasConflict);
  const selectedCount = extractedFields.filter(f => f.selected).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-4 h-auto">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-medium">Completar com IA</span>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="px-4 pb-4">
        <div className="max-h-[55vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
          <div className="space-y-4 pb-4">
            <div className="space-y-3">
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block flex items-center gap-2">
              <Link className="h-3 w-3" />
              Link da notícia
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="https://..."
                value={newsLink}
                onChange={(e) => setNewsLink(e.target.value)}
                className="text-sm flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchLink}
                disabled={isFetchingLink || !newsLink.trim()}
                className="shrink-0"
              >
                {isFetchingLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-1" />
                    Buscar
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Cole o link e clique em "Buscar" para carregar o texto automaticamente
            </p>
          </div>
          
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block flex items-center gap-2">
              <FileText className="h-3 w-3" />
              Texto da notícia ou documento
            </label>
            <Textarea
              placeholder="Cole aqui o texto ou use o botão acima para buscar automaticamente do link..."
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              rows={5}
              className="resize-none text-sm"
            />
          </div>
          
          {/* Image Upload Section */}
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block flex items-center gap-2">
              <Camera className="h-3 w-3" />
              Imagens do acidente (opcional)
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              A IA analisa imagens para identificar porte da empresa, setor, condições de segurança e logos/marcas
            </p>
            
            {/* Screenshot from news */}
            {screenshotFromNews && (
              <div className="mb-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Download className="h-3 w-3" />
                  Captura da notícia
                </div>
                <div className="relative inline-block">
                  <img 
                    src={screenshotFromNews} 
                    alt="Screenshot da notícia" 
                    className="h-20 w-auto rounded border object-cover"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-5 w-5"
                    onClick={removeScreenshot}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
            
            {/* Uploaded images preview */}
            {uploadedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {uploadedImages.map((img, index) => (
                  <div key={index} className="relative">
                    <img 
                      src={img} 
                      alt={`Imagem ${index + 1}`} 
                      className="h-16 w-16 rounded border object-cover"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-5 w-5"
                      onClick={() => removeImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              multiple
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <ImagePlus className="h-4 w-4 mr-2" />
              Adicionar Imagens
            </Button>
          </div>
        </div>

        <Button 
          onClick={handleExtract} 
          disabled={isExtracting || (!documentText.trim() && uploadedImages.length === 0 && !screenshotFromNews)}
          className="w-full"
          size="sm"
        >
          {isExtracting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analisando...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Extrair Informações
            </>
          )}
        </Button>

        {/* Instagram Search Section */}
        <div className="pt-3 border-t">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-muted-foreground flex items-center gap-2">
              <Instagram className="h-3 w-3" />
              Buscar no Instagram
            </label>
            {generateSearchKeywords().length > 0 && (
              <div className="flex flex-wrap gap-1">
                {generateSearchKeywords().slice(0, 2).map((keyword, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {keyword.substring(0, 15)}{keyword.length > 15 ? '...' : ''}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Busca posts relacionados ao acidente usando dados do lead (vítima, empresa, cidade, data)
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearchInstagram}
            disabled={isSearchingInstagram || generateSearchKeywords().length === 0}
            className="w-full"
          >
            {isSearchingInstagram ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Buscando...
              </>
            ) : (
              <>
                <Instagram className="h-4 w-4 mr-2" />
                Buscar Posts Relacionados
              </>
            )}
          </Button>
          
          {/* Instagram Results */}
          {instagramResults.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">{instagramResults.length} post(s) encontrado(s)</span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {instagramResults.map((post) => (
                  <div 
                    key={post.id}
                    className="flex items-start gap-2 p-2 rounded-md bg-muted/50 border text-xs"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-medium">@{post.ownerUsername}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {post.likesCount} ❤️ • {post.commentsCount} 💬
                        </Badge>
                      </div>
                      <p className="text-muted-foreground line-clamp-2">
                        {post.caption?.substring(0, 100)}
                        {post.caption?.length > 100 && '...'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => window.open(post.url, '_blank')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {hasResults && extractedFields.length > 0 && (
          <div className="space-y-3 pt-2 border-t">
            {/* Conflicts Section */}
            {conflicts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">Conflitos Detectados</span>
                </div>
                <div className="space-y-2">
                  {conflicts.map(field => (
                    <div 
                      key={field.key}
                      className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30"
                    >
                      <Checkbox
                        checked={field.selected}
                        onCheckedChange={() => toggleFieldSelection(field.key)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {field.label}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          Atual: {String(field.currentValue).substring(0, 50)}
                          {String(field.currentValue).length > 50 && '...'}
                        </div>
                        <Input
                          value={String(field.extractedValue || '')}
                          onChange={(e) => updateFieldValue(field.key, e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Novo valor..."
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New Fields Section */}
            {newFields.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Informações Novas</span>
                </div>
                <div className="space-y-1.5">
                  {newFields.map(field => (
                    <div 
                      key={field.key}
                      className="flex items-start gap-2 p-2 rounded-md bg-primary/10 border border-primary/30"
                    >
                      <Checkbox
                        checked={field.selected}
                        onCheckedChange={() => toggleFieldSelection(field.key)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {field.label}
                        </span>
                        <Input
                          value={String(field.extractedValue || '')}
                          onChange={(e) => updateFieldValue(field.key, e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Valor..."
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {selectedCount} de {extractedFields.length} selecionado(s)
              </span>
              <Button 
                onClick={handleApply} 
                disabled={selectedCount === 0}
                size="sm"
              >
                Aplicar Selecionados
              </Button>
            </div>
          </div>
        )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
