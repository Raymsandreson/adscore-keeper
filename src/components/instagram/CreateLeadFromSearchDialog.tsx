import { useState, useEffect } from 'react';
import { generateLeadName as generateLeadNameUtil } from '@/utils/generateLeadName';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { ExtractedAccidentData } from '@/components/leads/AccidentDataExtractor';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Sparkles, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface CommentData {
  id: string;
  text: string;
  ownerUsername: string;
  timestamp: string;
}

interface PostData {
  postId: string;
  postUrl: string;
  username: string;
  caption: string;
  location: string | null;
}

interface CreateLeadFromSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postData: PostData;
  comment?: CommentData;
  onSuccess?: () => void;
}

function getLeadInsertErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const typedError = error as { message?: string; details?: string; hint?: string };
    const parts = [typedError.message, typedError.details, typedError.hint]
      .filter((part): part is string => Boolean(part && part.trim()))
      .map((part) => part.trim());

    if (parts.length > 0) {
      return parts.join(' • ');
    }
  }

  return 'Erro ao criar lead';
}

const initialFormData: AccidentLeadFormData = {
  lead_name: '',
  lead_phone: '',
  lead_email: '',
  source: 'instagram',
  notes: '',
  acolhedor: '',
  case_type: '',
  group_link: '',
  client_classification: '',
  expected_birth_date: '',
  visit_city: '',
  visit_state: '',
  visit_region: '',
  visit_address: '',
  accident_date: '',
  damage_description: '',
  victim_name: '',
  victim_age: '',
  accident_address: '',
  contractor_company: '',
  main_company: '',
  sector: '',
  news_link: '',
  company_size_justification: '',
  liability_type: '',
  legal_viability: '',
};

// Inline AI Extractor component specifically for search context
function SearchContentExtractor({
  open,
  onOpenChange,
  onDataExtracted,
  initialContent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDataExtracted: (data: ExtractedAccidentData) => void;
  initialContent: string;
}) {
  const [documentText, setDocumentText] = useState(initialContent);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedAccidentData | null>(null);

  useEffect(() => {
    if (open) {
      setDocumentText(initialContent);
      setExtractedData(null);
    }
  }, [open, initialContent]);

  const handleExtract = async () => {
    const sanitizedText = documentText.replace(/\u0000/g, '').trim();
    if (!sanitizedText) {
      toast.error('Cole o texto do documento');
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
    setExtractedData(null);

    try {
      const { data, error } = await cloudFunctions.invoke('extract-accident-data', {
        body: { content: truncatedText, type: 'text' },
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
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Extrair Dados com IA
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <label className="text-sm font-medium mb-2 block flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Conteúdo para análise
            </label>
            <Textarea
              placeholder="Cole aqui o conteúdo..."
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              rows={10}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              O conteúdo da postagem foi pré-carregado. Você pode adicionar mais informações.
            </p>
          </div>
        </div>

        {!extractedData && (
          <Button 
            onClick={handleExtract} 
            disabled={isExtracting || !documentText.trim()}
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

export function CreateLeadFromSearchDialog({
  open,
  onOpenChange,
  postData,
  comment,
  onSuccess,
}: CreateLeadFromSearchDialogProps) {
  const { user } = useAuthContext();
  const [formData, setFormData] = useState<AccidentLeadFormData>(() => ({
    ...initialFormData,
    lead_name: comment?.ownerUsername || postData.username,
    news_link: postData.postUrl,
    notes: buildNotes(postData, comment),
    source: 'instagram',
  }));
  const [showExtractor, setShowExtractor] = useState(false);
  const teamProfiles = useProfilesList();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (open) {
      setFormData({
        ...initialFormData,
        lead_name: comment?.ownerUsername || postData.username,
        news_link: postData.postUrl,
        notes: buildNotes(postData, comment),
        source: 'instagram',
      });
    }
  }, [open, postData, comment]);

  const handleFormChange = (data: Partial<AccidentLeadFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const handleExtractedData = (data: ExtractedAccidentData) => {
    // Generate lead name following standard pattern
    const generatedName = generateLeadNameUtil({
      city: data.visit_city,
      state: data.visit_state,
      victim_name: data.victim_name,
      main_company: data.main_company,
      contractor_company: data.contractor_company,
      accident_date: data.accident_date,
      damage_description: data.damage_description,
    }, comment?.ownerUsername || postData.username);

    setFormData(prev => ({
      ...prev,
      lead_name: generatedName,
      victim_name: data.victim_name || prev.victim_name,
      victim_age: data.victim_age?.toString() || prev.victim_age,
      accident_date: data.accident_date || prev.accident_date,
      accident_address: data.accident_address || prev.accident_address,
      damage_description: data.damage_description || prev.damage_description,
      contractor_company: data.contractor_company || prev.contractor_company,
      main_company: data.main_company || prev.main_company,
      sector: data.sector || prev.sector,
      case_type: data.case_type || prev.case_type,
      liability_type: data.liability_type || prev.liability_type,
      legal_viability: data.legal_viability || prev.legal_viability,
      visit_city: data.visit_city || prev.visit_city,
      visit_state: data.visit_state || prev.visit_state,
      // Preserve source and link
      source: 'instagram',
      news_link: postData.postUrl,
    }));
    setShowExtractor(false);
    toast.success('Dados extraídos aplicados ao formulário!');
  };

  const handleSubmit = async () => {
    if (!formData.lead_name.trim()) {
      toast.error('O nome do lead é obrigatório');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('leads').insert({
        lead_name: formData.lead_name,
        lead_phone: formData.lead_phone || null,
        lead_email: formData.lead_email || null,
        source: formData.source,
        notes: formData.notes || null,
        acolhedor: formData.acolhedor || null,
        case_type: formData.case_type || null,
        group_link: formData.group_link || null,
        city: formData.visit_city || null,
        state: formData.visit_state || null,
        visit_region: formData.visit_region || null,
        visit_address: formData.visit_address || null,
        accident_date: formData.accident_date || null,
        damage_description: formData.damage_description || null,
        victim_name: formData.victim_name || null,
        victim_age: formData.victim_age ? parseInt(formData.victim_age) : null,
        accident_address: formData.accident_address || null,
        contractor_company: formData.contractor_company || null,
        main_company: formData.main_company || null,
        sector: formData.sector || null,
        news_link: formData.news_link || null,
        company_size_justification: formData.company_size_justification || null,
        liability_type: formData.liability_type || null,
        legal_viability: formData.legal_viability || null,
        instagram_username: comment?.ownerUsername || postData.username,
        created_by: user?.id || null,
        updated_by: user?.id || null,
      });

      if (error) throw error;

      toast.success('Lead criado com sucesso!');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Create lead error:', error);
      toast.error(getLeadInsertErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pre-populate extractor with post content for AI to analyze
  const getPostContentForExtraction = () => {
    let content = '';
    if (postData.caption) {
      content += `LEGENDA DO POST:\n${postData.caption}\n\n`;
    }
    if (postData.location) {
      content += `LOCALIZAÇÃO: ${postData.location}\n\n`;
    }
    if (comment) {
      content += `COMENTÁRIO DE @${comment.ownerUsername}:\n${comment.text}\n\n`;
    }
    return content;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar Lead</DialogTitle>
          </DialogHeader>

          <AccidentLeadForm
            formData={formData}
            onChange={handleFormChange}
            onOpenExtractor={() => setShowExtractor(true)}
            teamMembers={teamProfiles}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Extractor Dialog */}
      <SearchContentExtractor
        open={showExtractor}
        onOpenChange={setShowExtractor}
        onDataExtracted={handleExtractedData}
        initialContent={getPostContentForExtraction()}
      />
    </>
  );
}

// Helper function to build notes from post and comment data
function buildNotes(postData: PostData, comment?: CommentData): string {
  let notes = '';
  
  notes += `📸 Post: ${postData.postUrl}\n`;
  notes += `👤 Perfil: @${postData.username}\n`;
  
  if (postData.location) {
    notes += `📍 Localização: ${postData.location}\n`;
  }
  
  if (postData.caption) {
    notes += `\n📝 Legenda:\n${postData.caption.substring(0, 500)}${postData.caption.length > 500 ? '...' : ''}\n`;
  }
  
  if (comment) {
    notes += `\n💬 Comentário de @${comment.ownerUsername}:\n${comment.text}\n`;
  }
  
  return notes;
}
