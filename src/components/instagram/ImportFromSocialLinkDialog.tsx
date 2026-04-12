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
import { Link2, Loader2, Sparkles, UserPlus, FileText, ClipboardList, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { usePostMetadata } from '@/hooks/usePostMetadata';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
}

export function ImportFromSocialLinkDialog({ open, onOpenChange, onSuccess, initialUrl }: ImportFromSocialLinkDialogProps) {
  const [url, setUrl] = useState(initialUrl || '');
  const [caption, setCaption] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('lead');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [step, setStep] = useState<'input' | 'review' | 'saving'>('input');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const { fetchMetadata } = usePostMetadata();

  // Update URL when initialUrl changes (e.g. from share target)
  useEffect(() => {
    if (initialUrl && initialUrl !== url) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

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
      const { data, error } = await cloudFunctions.invoke('extract-social-post-data', {
        body: { postUrl: url.trim(), caption: caption.trim(), targetType },
      });
      if (error) throw error;
      if (data?.success && data?.extracted) {
        setExtractedData(data.extracted);
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

  const handleSave = async () => {
    if (!extractedData) return;
    setStep('saving');

    try {
      if (targetType === 'lead') {
        const { error } = await supabase.from('leads').insert({
          lead_name: extractedData.nome || `Lead ${detectPlatform(url)}`,
          lead_phone: extractedData.telefone || null,
          lead_email: extractedData.email || null,
          city: extractedData.cidade || null,
          state: extractedData.estado || null,
          source: detectPlatform(url).toLowerCase(),
          case_type: extractedData.tipo_caso || null,
          notes: [
            extractedData.profissao ? `Profissão: ${extractedData.profissao}` : null,
            extractedData.interesse ? `Interesse: ${extractedData.interesse}` : null,
            extractedData.contexto,
            extractedData.observacoes,
            url ? `Fonte: ${url}` : null,
            extractedData.tags?.length ? `Tags: ${extractedData.tags.join(', ')}` : null,
          ].filter(Boolean).join('\n'),
        });
        if (error) throw error;
        toast.success('Lead criado com sucesso!');
      } else if (targetType === 'contact') {
        const { error } = await supabase.from('contacts').insert({
          full_name: extractedData.nome || `Contato ${detectPlatform(url)}`,
          phone: extractedData.telefone || null,
          email: extractedData.email || null,
          cpf: extractedData.cpf || null,
          city: extractedData.cidade || null,
          state: extractedData.estado || null,
          profession: extractedData.profissao || null,
          notes: [
            extractedData.contexto,
            extractedData.observacoes,
            url ? `Fonte: ${url}` : null,
          ].filter(Boolean).join('\n'),
        });
        if (error) throw error;
        toast.success('Contato criado com sucesso!');
      } else if (targetType === 'activity') {
        const { error } = await supabase.from('lead_activities').insert({
          title: extractedData.interesse || extractedData.contexto || `Atividade via ${detectPlatform(url)}`,
          description: [
            extractedData.contexto,
            extractedData.observacoes,
            extractedData.nome ? `Pessoa: ${extractedData.nome}` : null,
            extractedData.telefone ? `Tel: ${extractedData.telefone}` : null,
            url ? `Fonte: ${url}` : null,
          ].filter(Boolean).join('\n'),
          activity_type: 'tarefa',
          status: 'pendente',
          priority: extractedData.urgencia === 'alta' ? 'alta' : 'normal',
        });
        if (error) throw error;
        toast.success('Atividade criada com sucesso!');
      }

      onSuccess?.();
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
      setStep('review');
    }
  };

  const handleClose = () => {
    setUrl('');
    setCaption('');
    setExtractedData(null);
    setStep('input');
    setTargetType('lead');
    onOpenChange(false);
  };

  const platform = detectPlatform(url);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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

        {step === 'review' && extractedData && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Dados extraídos pela IA — edite antes de salvar</span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nome do Lead *</Label>
                <Input
                  value={extractedData.nome || ''}
                  onChange={(e) => setExtractedData({ ...extractedData, nome: e.target.value })}
                  placeholder="Nome completo"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Telefone</Label>
                  <Input
                    value={extractedData.telefone || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, telefone: e.target.value })}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    value={extractedData.email || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, email: e.target.value })}
                    placeholder="email@exemplo.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Cidade</Label>
                  <Input
                    value={extractedData.cidade || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, cidade: e.target.value })}
                    placeholder="Cidade"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Estado</Label>
                  <Input
                    value={extractedData.estado || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, estado: e.target.value })}
                    placeholder="UF"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Profissão</Label>
                  <Input
                    value={extractedData.profissao || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, profissao: e.target.value })}
                    placeholder="Profissão"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Tipo de Caso</Label>
                  <Input
                    value={extractedData.tipo_caso || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, tipo_caso: e.target.value })}
                    placeholder="Ex: trabalhista"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Origem</Label>
                <Input
                  value={detectPlatform(url).toLowerCase()}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-1">
                <Label>Observações / Contexto</Label>
                <Textarea
                  value={[
                    extractedData.interesse ? `Interesse: ${extractedData.interesse}` : null,
                    extractedData.contexto,
                    extractedData.observacoes,
                    extractedData.tags?.length ? `Tags: ${extractedData.tags.join(', ')}` : null,
                  ].filter(Boolean).join('\n')}
                  onChange={(e) => setExtractedData({ ...extractedData, contexto: e.target.value, observacoes: null, interesse: null, tags: null })}
                  rows={3}
                />
              </div>
            </div>
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
              <Button onClick={handleSave}>
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
