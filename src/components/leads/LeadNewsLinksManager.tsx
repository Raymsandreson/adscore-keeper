import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import {
  ExternalLink,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Newspaper,
  MessageSquare,
  Check,
  X,
  ArrowRight,
} from 'lucide-react';

interface ExtractedField {
  field: string;
  label: string;
  currentValue: string;
  newValue: string;
}

interface LeadNewsLinksManagerProps {
  newsLinks: string[];
  onChange: (links: string[]) => void;
  // Current lead data for side-by-side comparison
  currentData: {
    victim_name?: string;
    victim_age?: string;
    accident_date?: string;
    accident_address?: string;
    damage_description?: string;
    case_type?: string;
    contractor_company?: string;
    main_company?: string;
    sector?: string;
    liability_type?: string;
    legal_viability?: string;
    visit_city?: string;
    visit_state?: string;
    notes?: string;
  };
  onApplyUpdates: (updates: Record<string, string>) => void;
  onFetchComments?: (url: string) => void;
}

export function LeadNewsLinksManager({
  newsLinks,
  onChange,
  currentData,
  onApplyUpdates,
  onFetchComments,
}: LeadNewsLinksManagerProps) {
  const [newLink, setNewLink] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichingUrl, setEnrichingUrl] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const handleAddLink = () => {
    const url = newLink.trim();
    if (!url) return;
    if (newsLinks.includes(url)) {
      toast.error('Este link já foi adicionado');
      return;
    }
    onChange([...newsLinks, url]);
    setNewLink('');
    toast.success('Link adicionado!');
  };

  const handleRemoveLink = (url: string) => {
    onChange(newsLinks.filter(l => l !== url));
  };

  const handleEnrich = async (url: string) => {
    setIsEnriching(true);
    setEnrichingUrl(url);

    try {
      // Scrape the news content
      const { data: scrapeData, error: scrapeError } = await cloudFunctions.invoke('scrape-news', {
        body: { url },
      });

      if (scrapeError || !scrapeData?.success) {
        throw new Error(scrapeData?.error || 'Erro ao buscar conteúdo');
      }

      const content = scrapeData.content || scrapeData.text || '';
      if (!content) {
        toast.error('Não foi possível extrair conteúdo desta página');
        return;
      }

      // Use AI to extract structured data
      const { data: aiData, error: aiError } = await cloudFunctions.invoke('extract-social-post-data', {
        body: {
          postUrl: url,
          caption: content.substring(0, 5000),
          targetType: 'accident',
        },
      });

      if (aiError || !aiData?.success || !aiData?.extracted) {
        throw new Error('Erro ao extrair dados da notícia');
      }

      const extracted = aiData.extracted;

      // Build side-by-side comparison
      const fieldMap: { field: string; label: string; extractedKey: string }[] = [
        { field: 'victim_name', label: 'Nome da Vítima', extractedKey: 'victim_name' },
        { field: 'victim_age', label: 'Idade da Vítima', extractedKey: 'victim_age' },
        { field: 'accident_date', label: 'Data do Acidente', extractedKey: 'accident_date' },
        { field: 'accident_address', label: 'Local do Acidente', extractedKey: 'accident_address' },
        { field: 'damage_description', label: 'Descrição do Dano', extractedKey: 'damage_description' },
        { field: 'case_type', label: 'Tipo do Caso', extractedKey: 'tipo_caso' },
        { field: 'contractor_company', label: 'Empresa Terceirizada', extractedKey: 'contractor_company' },
        { field: 'main_company', label: 'Empresa Tomadora', extractedKey: 'main_company' },
        { field: 'sector', label: 'Setor', extractedKey: 'sector' },
        { field: 'visit_city', label: 'Cidade', extractedKey: 'cidade' },
        { field: 'visit_state', label: 'Estado', extractedKey: 'estado' },
      ];

      const fields: ExtractedField[] = [];
      const autoSelect = new Set<string>();

      for (const fm of fieldMap) {
        const newVal = extracted[fm.extractedKey] || '';
        if (!newVal) continue;
        const currentVal = (currentData as any)[fm.field] || '';
        fields.push({
          field: fm.field,
          label: fm.label,
          currentValue: currentVal,
          newValue: String(newVal),
        });
        // Auto-select fields that are empty in current data
        if (!currentVal) {
          autoSelect.add(fm.field);
        }
      }

      // Add notes/context
      const noteParts = [
        extracted.contexto,
        extracted.observacoes,
        extracted.profissao ? `Profissão: ${extracted.profissao}` : null,
        `Fonte: ${url}`,
      ].filter(Boolean).join('\n');

      if (noteParts) {
        fields.push({
          field: 'notes',
          label: 'Notas (adicionar)',
          currentValue: currentData.notes || '',
          newValue: noteParts,
        });
        autoSelect.add('notes');
      }

      if (fields.length === 0) {
        toast.info('Nenhum dado novo foi encontrado nesta notícia');
        return;
      }

      setExtractedFields(fields);
      setSelectedFields(autoSelect);
      setReviewOpen(true);
      toast.success(`${fields.length} campos extraídos para revisão!`);
    } catch (err: any) {
      console.error('Enrich error:', err);
      toast.error(err.message || 'Erro ao enriquecer com link');
    } finally {
      setIsEnriching(false);
      setEnrichingUrl('');
    }
  };

  const toggleField = (field: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const handleApplySelected = () => {
    const updates: Record<string, string> = {};
    for (const f of extractedFields) {
      if (!selectedFields.has(f.field)) continue;
      if (f.field === 'notes') {
        // Append to existing notes
        const current = currentData.notes || '';
        updates.notes = current ? `${current}\n\n---\n${f.newValue}` : f.newValue;
      } else {
        updates[f.field] = f.newValue;
      }
    }
    onApplyUpdates(updates);
    setReviewOpen(false);
    setExtractedFields([]);
    toast.success('Dados aplicados ao lead!');
  };

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1 text-sm font-medium">
        <Newspaper className="h-3.5 w-3.5" />
        Links de Notícias ({newsLinks.length})
      </Label>

      {/* Existing links */}
      {newsLinks.length > 0 && (
        <div className="space-y-2">
          {newsLinks.map((link, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-muted/50 rounded-md p-2 text-sm">
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-primary underline truncate text-xs"
                title={link}
              >
                {link}
              </a>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Enriquecer com dados desta notícia"
                  onClick={() => handleEnrich(link)}
                  disabled={isEnriching}
                >
                  {isEnriching && enrichingUrl === link ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                </Button>
                {onFetchComments && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Buscar comentários"
                    onClick={() => onFetchComments(link)}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => handleRemoveLink(link)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new link */}
      <div className="flex gap-2">
        <Input
          value={newLink}
          onChange={(e) => setNewLink(e.target.value)}
          placeholder="https://... cole o link da notícia"
          className="flex-1 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLink())}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAddLink}
          disabled={!newLink.trim()}
        >
          <Plus className="h-4 w-4 mr-1" />
          Adicionar
        </Button>
      </div>

      {/* Review Dialog - Side by Side Comparison */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Revisar Dados Extraídos
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Selecione quais dados deseja aplicar ao lead. Campos vazios são pré-selecionados.
            </p>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-3">
              {extractedFields.map((field) => {
                const isSelected = selectedFields.has(field.field);
                const hasCurrentValue = !!field.currentValue;

                return (
                  <Card
                    key={field.field}
                    className={`p-3 cursor-pointer transition-colors border-2 ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-transparent hover:border-muted-foreground/20'
                    }`}
                    onClick={() => toggleField(field.field)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'
                      }`}>
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium">{field.label}</span>
                          {hasCurrentValue && (
                            <Badge variant="outline" className="text-[10px] py-0">
                              Já preenchido
                            </Badge>
                          )}
                        </div>

                        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                          {/* Current value */}
                          <div className="min-w-0">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Atual</span>
                            <p className={`text-xs mt-0.5 break-words ${
                              field.currentValue ? '' : 'text-muted-foreground italic'
                            }`}>
                              {field.currentValue
                                ? (field.field === 'notes'
                                    ? field.currentValue.substring(0, 100) + (field.currentValue.length > 100 ? '...' : '')
                                    : field.currentValue)
                                : 'Vazio'}
                            </p>
                          </div>

                          <ArrowRight className="h-4 w-4 text-muted-foreground mt-4 shrink-0" />

                          {/* New value */}
                          <div className="min-w-0">
                            <span className="text-[10px] text-primary uppercase tracking-wider font-medium">Novo</span>
                            <p className="text-xs mt-0.5 font-medium break-words">
                              {field.field === 'notes'
                                ? field.newValue.substring(0, 100) + (field.newValue.length > 100 ? '...' : '')
                                : field.newValue}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <div className="flex items-center gap-2 mr-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFields(new Set(extractedFields.map(f => f.field)))}
              >
                Selecionar Tudo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFields(new Set())}
              >
                Limpar
              </Button>
            </div>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleApplySelected}
              disabled={selectedFields.size === 0}
            >
              <Check className="h-4 w-4 mr-1" />
              Aplicar {selectedFields.size} campo(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
