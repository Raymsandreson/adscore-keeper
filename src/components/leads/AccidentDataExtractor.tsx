import React, { useState, useRef } from 'react';
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
  Link as LinkIcon,
  Upload,
  Image as ImageIcon,
  FileUp,
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
  const [activeTab, setActiveTab] = useState('link');
  const [documentText, setDocumentText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedAccidentData | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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
          } else if (documentText.trim()) {
            requestBody = { content: documentText.trim(), type: 'text' };
          } else {
            toast.error('Cole o texto ou faça upload de um arquivo');
            return;
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

      const { data, error } = await supabase.functions.invoke('extract-accident-data', {
        body: requestBody,
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
    setUrlInput('');
    setExtractedData(null);
    setUploadedFile(null);
    setUploadedImage(null);
    setActiveTab('link');
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
                  Cole o link da notícia
                </label>
                <Input
                  type="url"
                  placeholder="https://g1.globo.com/..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  A IA irá acessar a página e extrair os dados do acidente
                </p>
              </div>
            </TabsContent>

            {/* Document Tab */}
            <TabsContent value="document" className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  Upload de documento (PDF, Word, TXT)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".pdf,.doc,.docx,.txt"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploadedFile ? uploadedFile.name : 'Escolher arquivo'}
                  </Button>
                  {uploadedFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setUploadedFile(null)}
                    >
                      ×
                    </Button>
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
