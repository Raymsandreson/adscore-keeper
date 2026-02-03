import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  Upload,
  File,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
  const [activeTab, setActiveTab] = useState<'text' | 'pdf'>('text');
  const [documentText, setDocumentText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedAccidentData | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractTextFromPdf = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n\n';
    }
    
    return fullText.trim();
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast.error('Por favor, selecione um arquivo PDF');
      return;
    }

    setIsLoadingPdf(true);
    setPdfFileName(file.name);

    try {
      const text = await extractTextFromPdf(file);
      setDocumentText(text);
      toast.success('PDF carregado com sucesso!');
    } catch (err) {
      console.error('Error extracting PDF:', err);
      toast.error('Erro ao ler o PDF. Tente copiar e colar o texto manualmente.');
      setPdfFileName(null);
    } finally {
      setIsLoadingPdf(false);
    }
  };

  const handleExtract = async () => {
    if (!documentText.trim()) {
      toast.error('Carregue um PDF ou cole o texto do documento');
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
      resetState();
    }
  };

  const resetState = () => {
    setDocumentText('');
    setExtractedData(null);
    setPdfFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
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

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'text' | 'pdf')} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text" className="gap-2">
              <FileText className="h-4 w-4" />
              Colar Texto
            </TabsTrigger>
            <TabsTrigger value="pdf" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload PDF
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
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
                Copie e cole o texto do documento que contém informações sobre o acidente
              </p>
            </div>
          </TabsContent>

          <TabsContent value="pdf" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Faça upload do arquivo PDF
              </label>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handlePdfUpload}
                className="hidden"
                id="pdf-upload"
              />
              
              <div 
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                {isLoadingPdf ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Carregando PDF...</span>
                  </div>
                ) : pdfFileName ? (
                  <div className="flex flex-col items-center gap-2">
                    <File className="h-8 w-8 text-primary" />
                    <span className="text-sm font-medium">{pdfFileName}</span>
                    <span className="text-xs text-muted-foreground">Clique para trocar o arquivo</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Clique para selecionar um PDF
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Petição inicial, decisão judicial ou notícia
                    </span>
                  </div>
                )}
              </div>

              {documentText && pdfFileName && (
                <div className="mt-4">
                  <label className="text-sm font-medium mb-2 block">
                    Texto extraído do PDF (você pode editar se necessário)
                  </label>
                  <Textarea
                    value={documentText}
                    onChange={(e) => setDocumentText(e.target.value)}
                    rows={6}
                    className="resize-none text-xs"
                  />
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {!extractedData && (
          <Button 
            onClick={handleExtract} 
            disabled={isExtracting || isLoadingPdf || !documentText.trim()}
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
