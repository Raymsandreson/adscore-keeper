import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Link2, Loader2, Sparkles, UserPlus, FileText, ClipboardList, CheckCircle2 } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { usePostMetadata } from '@/hooks/usePostMetadata';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AccidentLeadForm, AccidentLeadFormData } from '@/components/leads/AccidentLeadForm';
import { useAuthContext } from '@/contexts/AuthContext';

interface ImportFromSocialLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialUrl?: string;
}

type TargetType = 'lead' | 'contact' | 'activity';

interface ExtractedData {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  cpf?: string | null;
  cidade?: string | null;
  estado?: string | null;
  profissao?: string | null;
  interesse?: string | null;
  contexto?: string | null;
  tags?: string[] | null;
  urgencia?: string | null;
  tipo_caso?: string | null;
  observacoes?: string | null;
  victim_name?: string | null;
  victim_age?: string | null;
  accident_date?: string | null;
  accident_address?: string | null;
  damage_description?: string | null;
  contractor_company?: string | null;
  main_company?: string | null;
  sector?: string | null;
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

export function ImportFromSocialLinkDialog({ open, onOpenChange, onSuccess, initialUrl }: ImportFromSocialLinkDialogProps) {
  const { user } = useAuthContext();
  const [url, setUrl] = useState(initialUrl || '');
  const [caption, setCaption] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('lead');
  const [step, setStep] = useState<'input' | 'review' | 'saving'>('input');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { fetchMetadata } = usePostMetadata();

  // Lead form data (used in review step)
  const [formData, setFormData] = useState<AccidentLeadFormData>({ ...initialFormData });
  // Board selection
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  // Team profiles for acolhedor selector
  const [teamMembers, setTeamMembers] = useState<{ id: string; full_name: string | null; email: string | null }[]>([]);

  // Update URL when initialUrl changes
  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  // Load boards and team members when entering review step
  useEffect(() => {
    if (step === 'review') {
      if (boards.length === 0) {
        supabase.from('kanban_boards').select('id, name, board_type').order('display_order').then(({ data }) => {
          if (data) {
            setBoards(data.filter(b => b.board_type === 'funnel' || !b.board_type).map(b => ({ id: b.id, name: b.name })));
          }
        });
      }
      // Always reload team members to ensure fresh data
      supabase.from('profiles').select('id, user_id, full_name, email').order('full_name').then(({ data }) => {
        if (data) {
          setTeamMembers(data.map(p => ({ id: p.id, full_name: p.full_name, email: p.email })));
        }
      });
    }
  }, [step]);

  const detectPlatform = (u: string) => {
    if (u.includes('instagram.com')) return 'Instagram';
    if (u.includes('facebook.com') || u.includes('fb.com')) return 'Facebook';
    if (u.includes('tiktok.com')) return 'TikTok';
    return 'Link';
  };

  const handleFetchCaption = async () => {
    if (!url.trim()) return;
    setIsFetchingMeta(true);
    try {
      const meta = await fetchMetadata(url.trim());
      if (meta?.caption) {
        setCaption(meta.caption);
        toast.success('Legenda extraída com sucesso!');
      } else {
        toast.info('Não foi possível extrair a legenda automaticamente. Cole manualmente.');
      }
    } catch {
      toast.error('Erro ao buscar legenda');
    } finally {
      setIsFetchingMeta(false);
    }
  };

  const handleExtract = async () => {
    if (!caption.trim()) {
      toast.error('Cole ou extraia a legenda primeiro');
      return;
    }
    setIsExtracting(true);
    try {
      // Check for duplicate news_link
      if (url.trim()) {
        const { data: existing } = await supabase
          .from('leads')
          .select('id, lead_name')
          .eq('news_link', url.trim())
          .limit(1);
        if (existing && existing.length > 0) {
          toast.warning(`⚠️ Essa notícia já está cadastrada no lead "${existing[0].lead_name || 'Sem nome'}". Você pode continuar se desejar criar outro.`, { duration: 6000 });
        }
      }
      const { data, error } = await cloudFunctions.invoke('extract-social-post-data', {
        body: { postUrl: url.trim(), caption: caption.trim(), targetType },
      });
      if (error) throw error;
      if (data?.success && data?.extracted) {
        const extracted: ExtractedData = data.extracted;
        // Map extracted data to AccidentLeadFormData
        const noteParts = [
          extracted.profissao ? `Profissão: ${extracted.profissao}` : null,
          extracted.interesse ? `Interesse: ${extracted.interesse}` : null,
          extracted.contexto,
          extracted.observacoes,
          url ? `Fonte: ${url}` : null,
          extracted.tags?.length ? `Tags: ${extracted.tags.join(', ')}` : null,
        ].filter(Boolean).join('\n');

        setFormData({
          ...initialFormData,
          lead_name: extracted.nome || `Lead ${detectPlatform(url)}`,
          lead_phone: extracted.telefone || '',
          lead_email: extracted.email || '',
          source: detectPlatform(url).toLowerCase(),
          visit_city: extracted.cidade || '',
          visit_state: extracted.estado || '',
          case_type: extracted.tipo_caso || '',
          notes: noteParts,
          news_link: url || '',
          victim_name: extracted.victim_name || extracted.nome || '',
          victim_age: extracted.victim_age || '',
          accident_date: extracted.accident_date || '',
          accident_address: extracted.accident_address || '',
          damage_description: extracted.damage_description || extracted.interesse || '',
          contractor_company: extracted.contractor_company || '',
          main_company: extracted.main_company || '',
          sector: extracted.sector || '',
        });
        setStep('review');
        toast.success('Dados extraídos pela IA!');
      } else {
        toast.error(data?.error || 'Não foi possível extrair dados');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro na extração');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFormChange = (data: Partial<AccidentLeadFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const handleSave = async () => {
    // Validate required fields
    if (!formData.lead_name.trim()) {
      toast.error('O nome do lead é obrigatório');
      return;
    }
    if (!selectedBoardId) {
      toast.error('O funil de vendas é obrigatório');
      return;
    }
    if (!formData.acolhedor?.trim()) {
      toast.error('O acolhedor é obrigatório');
      return;
    }
    setIsSubmitting(true);
    setStep('saving');

    try {
      if (targetType === 'lead') {
        const { error } = await supabase.from('leads').insert({
          lead_name: formData.lead_name,
          lead_phone: formData.lead_phone || null,
          lead_email: formData.lead_email || null,
          source: formData.source || detectPlatform(url).toLowerCase(),
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
          board_id: selectedBoardId || null,
          created_by: user?.id || null,
          updated_by: user?.id || null,
        });
        if (error) throw error;
        toast.success('Lead criado com sucesso!');
      } else if (targetType === 'contact') {
        const { error } = await supabase.from('contacts').insert({
          full_name: formData.lead_name || `Contato ${detectPlatform(url)}`,
          phone: formData.lead_phone || null,
          email: formData.lead_email || null,
          city: formData.visit_city || null,
          state: formData.visit_state || null,
          notes: formData.notes || null,
        });
        if (error) throw error;
        toast.success('Contato criado com sucesso!');
      } else if (targetType === 'activity') {
        const { error } = await supabase.from('lead_activities').insert({
          title: formData.lead_name || `Atividade via ${detectPlatform(url)}`,
          description: formData.notes || null,
          activity_type: 'tarefa',
          status: 'pendente',
          priority: 'normal',
        });
        if (error) throw error;
        toast.success('Atividade criada com sucesso!');
      }

      onSuccess?.();
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
      setStep('review');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setCaption('');
    setFormData({ ...initialFormData });
    setSelectedBoardId('');
    setStep('input');
    setTargetType('lead');
    onOpenChange(false);
  };

  const platform = detectPlatform(url);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={step === 'review' ? "max-w-2xl max-h-[90vh] overflow-y-auto" : "max-w-lg max-h-[85vh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Importar de Link Social
          </DialogTitle>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4 py-2">
            {/* URL Input */}
            <div className="space-y-2">
              <Label>URL do Post</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://instagram.com/p/... ou cole link do Facebook"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1"
                />
                {url.trim() && (
                  <Badge variant="outline" className="shrink-0 self-center">
                    {platform}
                  </Badge>
                )}
              </div>
              {url.trim() && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetchCaption}
                  disabled={isFetchingMeta}
                  className="w-full"
                >
                  {isFetchingMeta ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Extrair legenda automaticamente
                </Button>
              )}
            </div>

            {/* Caption */}
            <div className="space-y-2">
              <Label>Legenda / Texto do Post</Label>
              <Textarea
                placeholder="Cole aqui a legenda do post ou clique acima para extrair automaticamente..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                A IA vai analisar este texto para extrair nome, telefone, interesse e outros dados
              </p>
            </div>

            {/* Target Type */}
            <div className="space-y-2">
              <Label>O que deseja criar?</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as TargetType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">
                    <span className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4" /> Lead
                    </span>
                  </SelectItem>
                  <SelectItem value="contact">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Contato
                    </span>
                  </SelectItem>
                  <SelectItem value="activity">
                    <span className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4" /> Atividade
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Dados extraídos pela IA — edite antes de salvar</span>
            </div>

            {/* Board (Funil) selector */}
            {targetType === 'lead' && (
              <div className="space-y-2">
                <Label>Funil de Vendas</Label>
                <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funil..." />
                  </SelectTrigger>
                  <SelectContent>
                    {boards.map(board => (
                      <SelectItem key={board.id} value={board.id}>
                        {board.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* AccidentLeadForm - same as CreateLeadFromSearchDialog */}
            <AccidentLeadForm
              formData={formData}
              onChange={handleFormChange}
              onOpenExtractor={() => {}}
              teamMembers={teamMembers}
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 'input' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleExtract} disabled={!caption.trim() || isExtracting}>
                {isExtracting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Analisar com IA
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={() => setStep('input')}>Voltar</Button>
              <Button onClick={handleSave} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <UserPlus className="h-4 w-4 mr-2" />
                Criar {targetType === 'lead' ? 'Lead' : targetType === 'contact' ? 'Contato' : 'Atividade'}
              </Button>
            </>
          )}
          {step === 'saving' && (
            <Button disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Salvando...
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
