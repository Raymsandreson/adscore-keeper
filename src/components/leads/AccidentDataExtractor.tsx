import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
}

interface AccidentDataExtractorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDataExtracted: (data: ExtractedAccidentData) => void;
}

export function AccidentDataExtractor({
  open,
  onOpenChange,
  onDataExtracted,
}: AccidentDataExtractorProps) {
  const [documentText, setDocumentText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedAccidentData | null>(null);

  const handleExtract = async () => {
    if (!documentText.trim()) {
      toast.error('Cole o texto do documento');
      return;
    }

    setIsExtracting(true);
    setExtractedData(null);

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

      setExtractedData(data.data);
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
      onDataExtracted(extractedData);
      onOpenChange(false);
      setDocumentText('');
      setExtractedData(null);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setDocumentText('');
    setExtractedData(null);
  };

  const renderField = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return null;
    return (
      <div className="flex justify-between py-1 border-b border-muted last:border-0">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className="text-sm font-medium max-w-[60%] text-right">{value}</span>
      </div>
    );
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

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Cole o texto da petição inicial, decisão judicial ou notícia
            </label>
            <Textarea
              placeholder="Cole aqui o conteúdo do documento..."
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              rows={10}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Copie e cole o texto do PDF ou documento que contém informações sobre o acidente
            </p>
          </div>
        </div>

        {!extractedData && (
          <Button 
            onClick={handleExtract} 
            disabled={isExtracting}
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
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Dados extraídos com sucesso!</span>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 space-y-1">
              <h4 className="font-medium text-sm mb-3">Dados Identificados:</h4>
              {renderField('Nome da Vítima', extractedData.victim_name)}
              {renderField('Idade', extractedData.victim_age)}
              {renderField('Data do Acidente', extractedData.accident_date)}
              {renderField('Local do Acidente', extractedData.accident_address)}
              {renderField('Dano', extractedData.damage_description)}
              {renderField('Empresa Terceirizada', extractedData.contractor_company)}
              {renderField('Empresa Tomadora', extractedData.main_company)}
              {renderField('Setor', extractedData.sector)}
              {renderField('Tipo de Caso', extractedData.case_type)}
              {renderField('Tipo de Responsabilidade', extractedData.liability_type)}
              {renderField('Cidade', extractedData.visit_city)}
              {renderField('Estado', extractedData.visit_state)}
              {extractedData.legal_viability && (
                <div className="pt-2 mt-2 border-t">
                  <span className="text-muted-foreground text-sm">Viabilidade Jurídica:</span>
                  <p className="text-sm mt-1">{extractedData.legal_viability}</p>
                </div>
              )}
              
              {!extractedData.victim_name && !extractedData.accident_date && !extractedData.damage_description && (
                <div className="flex items-center gap-2 text-yellow-600 py-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">Poucos dados identificados. Verifique se o conteúdo está completo.</span>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setExtractedData(null)}>
                Tentar Novamente
              </Button>
              <Button onClick={handleConfirm}>
                Usar Dados Extraídos
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
