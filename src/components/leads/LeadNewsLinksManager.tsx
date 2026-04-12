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
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Newspaper,
  MessageSquare,
  Check,
  ArrowRight,
  User,
  ThumbsUp,
  Clock,
  Building,
  Users,
  FileText,
  Phone,
  Mail,
  AtSign,
  Copy,
  UserPlus,
  Reply,
  Send,
} from 'lucide-react';

interface ExtractedField {
  field: string;
  label: string;
  currentValue: string;
  newValue: string;
}

interface CommentContactInfo {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  other_social?: string | null;
}

interface NewsComment {
  author: string;
  text: string;
  date?: string;
  likes?: number;
  is_reply?: boolean;
  contact_info?: CommentContactInfo;
  suggested_reply?: string;
  suggested_dm?: string;
}

interface NewsDetails {
  additional_victims?: string[];
  witnesses?: string[];
  companies_mentioned?: string[];
  authorities_mentioned?: string[];
  timeline?: string;
  summary?: string;
}

interface LeadNewsLinksManagerProps {
  newsLinks: string[];
  onChange: (links: string[]) => void;
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
    lead_name?: string;
  };
  onApplyUpdates: (updates: Record<string, string>) => void;
  onCreateContact?: (contactData: { full_name: string; phone?: string; email?: string; instagram?: string; notes?: string }) => void;
}

export function LeadNewsLinksManager({
  newsLinks,
  onChange,
  currentData,
  onApplyUpdates,
  onCreateContact,
}: LeadNewsLinksManagerProps) {
  const [newLink, setNewLink] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichingUrl, setEnrichingUrl] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  // Comments state
  const [isFetchingComments, setIsFetchingComments] = useState(false);
  const [fetchingCommentsUrl, setFetchingCommentsUrl] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<NewsComment[]>([]);
  const [newsDetails, setNewsDetails] = useState<NewsDetails | null>(null);
  const [commentsPageTitle, setCommentsPageTitle] = useState('');

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
        if (!currentVal) {
          autoSelect.add(fm.field);
        }
      }

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

  const handleFetchComments = async (url: string) => {
    setIsFetchingComments(true);
    setFetchingCommentsUrl(url);

    try {
      const { data, error } = await cloudFunctions.invoke('extract-news-comments', {
        body: {
          url,
          leadContext: {
            victim_name: currentData.victim_name,
            case_type: currentData.case_type,
            accident_date: currentData.accident_date,
            main_company: currentData.main_company,
            contractor_company: currentData.contractor_company,
            damage_description: currentData.damage_description,
          },
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || 'Erro ao buscar comentários');
      }

      setComments(data.comments || []);
      setNewsDetails(data.details || null);
      setCommentsPageTitle(data.page_title || '');
      setCommentsOpen(true);

      if (data.comments?.length > 0) {
        toast.success(`${data.comments.length} comentários encontrados!`);
      } else {
        toast.info('Nenhum comentário encontrado nesta página');
      }
    } catch (err: any) {
      console.error('Comments fetch error:', err);
      toast.error(err.message || 'Erro ao buscar comentários');
    } finally {
      setIsFetchingComments(false);
      setFetchingCommentsUrl('');
    }
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiada!`);
  };

  const handleCreateContact = (comment: NewsComment) => {
    if (!onCreateContact) {
      toast.error('Função de criar contato não disponível');
      return;
    }
    const ci = comment.contact_info;
    const name = ci?.full_name || comment.author;
    const notes = `Comentarista encontrado em notícia: "${commentsPageTitle}"\nComentário: "${comment.text.substring(0, 200)}"`;
    onCreateContact({
      full_name: name,
      phone: ci?.phone || undefined,
      email: ci?.email || undefined,
      instagram: ci?.instagram || undefined,
      notes,
    });
    toast.success(`Contato "${name}" sugerido para criação!`);
  };

  const hasContactInfo = (comment: NewsComment) => {
    const ci = comment.contact_info;
    return ci && (ci.phone || ci.email || ci.instagram || ci.full_name || ci.other_social);
  };

  const handleAddDetailsToNotes = () => {
    if (!newsDetails) return;

    const parts: string[] = [];
    if (newsDetails.summary) parts.push(`📰 Resumo: ${newsDetails.summary}`);
    if (newsDetails.additional_victims?.length) parts.push(`👥 Outras vítimas: ${newsDetails.additional_victims.join(', ')}`);
    if (newsDetails.witnesses?.length) parts.push(`👁 Testemunhas: ${newsDetails.witnesses.join(', ')}`);
    if (newsDetails.companies_mentioned?.length) parts.push(`🏢 Empresas: ${newsDetails.companies_mentioned.join(', ')}`);
    if (newsDetails.authorities_mentioned?.length) parts.push(`⚖️ Autoridades: ${newsDetails.authorities_mentioned.join(', ')}`);
    if (newsDetails.timeline) parts.push(`📅 Cronologia: ${newsDetails.timeline}`);

    if (comments.length > 0) {
      parts.push(`\n💬 Comentários relevantes (${comments.length}):`);
      comments.slice(0, 10).forEach(c => {
        parts.push(`- ${c.author}: "${c.text.substring(0, 150)}${c.text.length > 150 ? '...' : ''}"`);
      });
    }

    if (parts.length > 0) {
      const current = currentData.notes || '';
      const newNotes = current ? `${current}\n\n---\n${parts.join('\n')}` : parts.join('\n');
      onApplyUpdates({ notes: newNotes });
      toast.success('Detalhes e comentários adicionados às notas!');
      setCommentsOpen(false);
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
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Buscar comentários e detalhes"
                  onClick={() => handleFetchComments(link)}
                  disabled={isFetchingComments}
                >
                  {isFetchingComments && fetchingCommentsUrl === link ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}
                </Button>
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

      {/* Review Dialog */}
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedFields(new Set(extractedFields.map(f => f.field)))}>
                Selecionar Tudo
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedFields(new Set())}>
                Limpar
              </Button>
            </div>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancelar</Button>
            <Button onClick={handleApplySelected} disabled={selectedFields.size === 0}>
              <Check className="h-4 w-4 mr-1" />
              Aplicar {selectedFields.size} campo(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comments & Details Dialog */}
      <Dialog open={commentsOpen} onOpenChange={setCommentsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Comentários & Detalhes
            </DialogTitle>
            {commentsPageTitle && (
              <p className="text-sm text-muted-foreground truncate">{commentsPageTitle}</p>
            )}
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {/* News Details */}
              {newsDetails && (
                <div className="space-y-3">
                  {newsDetails.summary && (
                    <Card className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Resumo</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{newsDetails.summary}</p>
                    </Card>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {newsDetails.additional_victims && newsDetails.additional_victims.length > 0 && (
                      <Card className="p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Users className="h-3.5 w-3.5 text-destructive" />
                          <span className="text-xs font-medium">Outras Vítimas</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {newsDetails.additional_victims.map((v, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{v}</Badge>
                          ))}
                        </div>
                      </Card>
                    )}

                    {newsDetails.witnesses && newsDetails.witnesses.length > 0 && (
                      <Card className="p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <User className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-xs font-medium">Testemunhas</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {newsDetails.witnesses.map((w, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{w}</Badge>
                          ))}
                        </div>
                      </Card>
                    )}

                    {newsDetails.companies_mentioned && newsDetails.companies_mentioned.length > 0 && (
                      <Card className="p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Building className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-xs font-medium">Empresas</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {newsDetails.companies_mentioned.map((c, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
                          ))}
                        </div>
                      </Card>
                    )}

                    {newsDetails.authorities_mentioned && newsDetails.authorities_mentioned.length > 0 && (
                      <Card className="p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Building className="h-3.5 w-3.5 text-green-500" />
                          <span className="text-xs font-medium">Autoridades</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {newsDetails.authorities_mentioned.map((a, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{a}</Badge>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>

                  {newsDetails.timeline && (
                    <Card className="p-3">
                      <div className="flex items-center gap-1 mb-1">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium">Cronologia</span>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{newsDetails.timeline}</p>
                    </Card>
                  )}
                </div>
              )}

              {/* Comments */}
              {comments.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    {comments.length} Comentário(s)
                  </h4>
                  <div className="space-y-3">
                    {comments.map((comment, idx) => (
                      <Card key={idx} className={`p-3 ${comment.is_reply ? 'ml-4 border-l-2 border-primary/30' : ''}`}>
                        {/* Comment header */}
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs font-medium">{comment.author}</span>
                            {comment.is_reply && (
                              <Badge variant="outline" className="text-[9px] py-0">Resposta</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {comment.date && (
                              <span className="flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {comment.date}
                              </span>
                            )}
                            {comment.likes != null && comment.likes > 0 && (
                              <span className="flex items-center gap-0.5">
                                <ThumbsUp className="h-2.5 w-2.5" />
                                {comment.likes}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Comment text */}
                        <p className="text-xs text-muted-foreground">{comment.text}</p>

                        {/* Contact info badges */}
                        {hasContactInfo(comment) && (
                          <div className="mt-1.5 pt-1.5 border-t border-dashed flex flex-wrap gap-2 items-center">
                            {comment.contact_info?.full_name && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-muted px-1.5 py-0.5 rounded">
                                <User className="h-2.5 w-2.5" />
                                {comment.contact_info.full_name}
                              </span>
                            )}
                            {comment.contact_info?.phone && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded">
                                <Phone className="h-2.5 w-2.5" />
                                {comment.contact_info.phone}
                              </span>
                            )}
                            {comment.contact_info?.email && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">
                                <Mail className="h-2.5 w-2.5" />
                                {comment.contact_info.email}
                              </span>
                            )}
                            {comment.contact_info?.instagram && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-pink-500/10 text-pink-700 dark:text-pink-400 px-1.5 py-0.5 rounded">
                                <AtSign className="h-2.5 w-2.5" />
                                {comment.contact_info.instagram}
                              </span>
                            )}
                            {comment.contact_info?.other_social && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-muted px-1.5 py-0.5 rounded">
                                {comment.contact_info.other_social}
                              </span>
                            )}
                            {/* Create contact button */}
                            {onCreateContact && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-5 text-[10px] px-1.5 gap-1"
                                onClick={() => handleCreateContact(comment)}
                              >
                                <UserPlus className="h-2.5 w-2.5" />
                                Criar Contato
                              </Button>
                            )}
                          </div>
                        )}

                        {/* AI Suggested messages */}
                        {(comment.suggested_reply || comment.suggested_dm) && (
                          <div className="mt-2 pt-2 border-t space-y-2">
                            {comment.suggested_reply && (
                              <div className="bg-amber-500/5 border border-amber-500/20 rounded-md p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                    <Reply className="h-2.5 w-2.5" />
                                    Resposta pública sugerida
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 text-[10px] px-1.5 gap-1 text-amber-700 dark:text-amber-400"
                                    onClick={() => handleCopyText(comment.suggested_reply!, 'Resposta pública')}
                                  >
                                    <Copy className="h-2.5 w-2.5" />
                                    Copiar
                                  </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground italic">{comment.suggested_reply}</p>
                              </div>
                            )}

                            {comment.suggested_dm && (
                              <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1">
                                    <Send className="h-2.5 w-2.5" />
                                    Mensagem direta sugerida
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 text-[10px] px-1.5 gap-1 text-blue-700 dark:text-blue-400"
                                    onClick={() => handleCopyText(comment.suggested_dm!, 'Mensagem direta')}
                                  >
                                    <Copy className="h-2.5 w-2.5" />
                                    Copiar
                                  </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground italic">{comment.suggested_dm}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {comments.length === 0 && !newsDetails && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum comentário ou detalhe adicional encontrado
                </p>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentsOpen(false)}>
              Fechar
            </Button>
            {(comments.length > 0 || newsDetails) && (
              <Button onClick={handleAddDetailsToNotes}>
                <FileText className="h-4 w-4 mr-1" />
                Adicionar às Notas
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
