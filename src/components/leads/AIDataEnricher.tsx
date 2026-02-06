import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Lead } from '@/hooks/useLeads';

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
};

export function AIDataEnricher({ lead, onApplyData }: AIDataEnricherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [documentText, setDocumentText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [hasResults, setHasResults] = useState(false);

  const handleExtract = async () => {
    if (!documentText.trim()) {
      toast.error('Cole o texto para análise');
      return;
    }

    setIsExtracting(true);
    setExtractedFields([]);
    setHasResults(false);

    try {
      const { data, error } = await supabase.functions.invoke('extract-accident-data', {
        body: { content: documentText, type: 'text' },
      });

      if (error) {
        console.error('Error extracting data:', error);
        toast.error('Erro ao extrair dados');
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

    if (Object.keys(updates).length === 0) {
      toast.info('Nenhum campo selecionado para aplicar');
      return;
    }

    onApplyData(updates);
    
    // Reset state
    setDocumentText('');
    setExtractedFields([]);
    setHasResults(false);
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
      
      <CollapsibleContent className="px-4 pb-4 space-y-4">
        <div>
          <label className="text-sm text-muted-foreground mb-2 block flex items-center gap-2">
            <FileText className="h-3 w-3" />
            Cole texto de petições, notícias ou documentos para extrair informações faltantes
          </label>
          <Textarea
            placeholder="Cole aqui o texto para a IA analisar e encontrar informações que faltam no lead..."
            value={documentText}
            onChange={(e) => setDocumentText(e.target.value)}
            rows={4}
            className="resize-none text-sm"
          />
        </div>

        <Button 
          onClick={handleExtract} 
          disabled={isExtracting || !documentText.trim()}
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
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-muted-foreground">
                          {field.label}
                        </span>
                        <div className="flex items-center gap-2 text-xs mt-0.5 flex-wrap">
                          <Badge variant="outline" className="bg-background text-xs">
                            Atual: {String(field.currentValue).substring(0, 30)}
                            {String(field.currentValue).length > 30 && '...'}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <Badge variant="default" className="text-xs">
                            Novo: {String(field.extractedValue).substring(0, 30)}
                            {String(field.extractedValue).length > 30 && '...'}
                          </Badge>
                        </div>
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
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-muted-foreground">
                          {field.label}
                        </span>
                        <p className="text-sm truncate">
                          {String(field.extractedValue)}
                        </p>
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
      </CollapsibleContent>
    </Collapsible>
  );
}
