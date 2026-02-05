import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Loader2,
  ExternalLink,
  MessageCircle,
  Heart,
  Eye,
  UserPlus,
  Settings,
  RefreshCw,
  MapPin,
  Image,
  Video,
  LayoutGrid,
  MinusCircle,
  HelpCircle,
  Filter,
  Hash,
  CalendarIcon,
  AlertTriangle,
  Save,
  Check,
  History,
  Trash2,
  Clock,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CaseSearchResultCard } from './CaseSearchResultCard';
import { format, subDays, subMonths, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { parseAdvancedSearch, SEARCH_TIPS } from '@/utils/advancedSearchParser';

interface SearchResult {
  postId: string;
  postUrl: string;
  username: string;
  userUrl: string;
  caption: string;
  postedDate: string | null;
  location: string | null;
  mediaType: string;
  thumbnailUrl: string;
  mediaUrls: string[];
  hashtags: string[];
  mentions: string[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  isAd: boolean;
  searchKeyword: string;
  scrapedAt: string;
  // Extended data after fetching comments
  comments?: CommentData[];
  matchingComments?: CommentData[];
}

type MediaTypeFilter = 'all' | 'image' | 'video' | 'carousel';

interface CommentData {
  id: string;
  text: string;
  ownerUsername: string;
  timestamp: string;
}

const RELATIONSHIP_KEYWORDS = [
  'colega',
  'trabalha comigo',
  'cunhado',
  'cunhada',
  'esposo',
  'esposa',
  'marido',
  'filho',
  'filha',
  'pai',
  'mãe',
  'irmão',
  'irmã',
  'primo',
  'prima',
  'tio',
  'tia',
  'avô',
  'avó',
  'sogro',
  'sogra',
  'genro',
  'nora',
  'sobrinho',
  'sobrinha',
  'vizinho',
  'vizinha',
  'amigo',
  'amiga',
  'conhecido',
  'conhecida',
  'parente',
  'família',
];

const STORAGE_KEY = 'case_search_settings';

interface SavedSettings {
  instagramCookies: string;
  accountName: string;
}

export function CaseSearchEngine() {
  const [keywords, setKeywords] = useState('');
  const [minComments, setMinComments] = useState(5);
  const [maxPosts, setMaxPosts] = useState(50);
  const [commentKeywords, setCommentKeywords] = useState<string[]>(['colega', 'cunhado', 'esposo', 'filho']);
  const [customCommentKeyword, setCustomCommentKeyword] = useState('');
  const [instagramCookies, setInstagramCookies] = useState('');
  const [accountName, setAccountName] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingComments, setLoadingComments] = useState<string | null>(null);
  
  // Date range filters
  const [dateFrom, setDateFrom] = useState<Date | undefined>(subMonths(new Date(), 1));
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date());
  const [periodPreset, setPeriodPreset] = useState<string>('30');

  // Advanced filters (post-search)
  const [excludeTerms, setExcludeTerms] = useState<string[]>([]);
  const [customExcludeTerm, setCustomExcludeTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);
  const [advancedSearchQuery, setAdvancedSearchQuery] = useState('');
  const [showSearchTips, setShowSearchTips] = useState(false);
  
  // Search history hook
  const { history, isLoading: isLoadingHistory, createSearchRecord, updateSearchResults, deleteSearchRecord } = useSearchHistory();

  // Load saved settings
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const settings: SavedSettings = JSON.parse(saved);
        setInstagramCookies(settings.instagramCookies || '');
        setAccountName(settings.accountName || '');
      } catch (e) {
        console.error('Error loading saved settings:', e);
      }
    }
  }, []);

  const saveSettings = () => {
    const settings: SavedSettings = {
      instagramCookies,
      accountName,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    toast.success('Configurações salvas!');
  };

  const handlePeriodPreset = (value: string) => {
    setPeriodPreset(value);
    const now = new Date();
    
    switch (value) {
      case '7':
        setDateFrom(subDays(now, 7));
        setDateTo(now);
        break;
      case '15':
        setDateFrom(subDays(now, 15));
        setDateTo(now);
        break;
      case '30':
        setDateFrom(subMonths(now, 1));
        setDateTo(now);
        break;
      case '90':
        setDateFrom(subMonths(now, 3));
        setDateTo(now);
        break;
      case '180':
        setDateFrom(subMonths(now, 6));
        setDateTo(now);
        break;
      case 'custom':
        // Keep current dates
        break;
    }
  };

  const pollForResults = async (runId: string) => {
    const maxAttempts = 120; // 10 minutes max (5s * 120)
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      setSearchStatus(`Aguardando resultados... (${attempts * 5}s)`);

      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      try {
        const { data: statusData, error: statusError } = await supabase.functions.invoke('search-instagram-posts', {
          body: { action: 'status', runId },
        });

        if (statusError) throw statusError;

        if (statusData?.isFailed) {
          throw new Error('A busca falhou no Apify');
        }

        if (statusData?.isComplete) {
          setSearchStatus('Carregando resultados...');
          
          // Fetch results
          const { data: resultsData, error: resultsError } = await supabase.functions.invoke('search-instagram-posts', {
            body: { action: 'results', runId },
          });

          if (resultsError) throw resultsError;

          if (resultsData?.success) {
            const posts = resultsData.posts || [];
            setResults(posts);
            
            // Save to history
            if (currentSearchId) {
              await updateSearchResults(currentSearchId, posts, 'completed');
            }
            
            toast.success(`Encontrados ${resultsData.total} posts`);
            return posts;
          } else {
            throw new Error(resultsData?.error || 'Erro ao buscar resultados');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        throw error;
      }
    }

    throw new Error('Timeout: a busca demorou mais de 10 minutos');
  };

  const handleSearch = async () => {
    if (!keywords.trim()) {
      toast.error('Digite pelo menos uma palavra-chave');
      return;
    }

    if (!instagramCookies.trim()) {
      toast.error('Configure os cookies do Instagram nas configurações');
      setSettingsOpen(true);
      return;
    }

    setIsSearching(true);
    setResults([]);
    setSearchStatus('Iniciando busca...');

    try {
      const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);

      // Start the search
      const { data, error } = await supabase.functions.invoke('search-instagram-posts', {
        body: {
          action: 'start',
          keywords: keywordList,
          maxPosts,
          instagramCookies,
          minComments,
        },
      });

      if (error) throw error;

      if (data?.success && data?.runId) {
        // Create search history record
        const searchId = await createSearchRecord(keywordList, maxPosts, minComments, data.runId);
        setCurrentSearchId(searchId);
        
        setSearchStatus('Busca iniciada, aguardando Apify...');
        await pollForResults(data.runId);
      } else {
        throw new Error(data?.error || 'Erro ao iniciar busca');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao buscar posts');
      
      // Update history record as failed
      if (currentSearchId) {
        await updateSearchResults(currentSearchId, [], 'failed');
      }
    } finally {
      setIsSearching(false);
      setSearchStatus('');
      setCurrentSearchId(null);
    }
  };

  const loadFromHistory = (item: typeof history[0]) => {
    if (item.results && Array.isArray(item.results)) {
      setResults(item.results as unknown as SearchResult[]);
      setKeywords(item.keywords.join(', '));
      toast.success(`Carregados ${item.results_count} posts do histórico`);
      setShowHistory(false);
    } else {
      toast.error('Esta busca não possui resultados salvos');
    }
  };

  const handleFetchComments = async (result: SearchResult) => {
    setLoadingComments(result.postId);

    try {
      const { data, error } = await supabase.functions.invoke('fetch-post-comments', {
        body: {
          postUrl: result.postUrl,
          maxComments: 100,
        },
      });

      if (error) throw error;

      if (data?.success) {
        const comments: CommentData[] = data.comments.map((c: any) => ({
          id: c.id,
          text: c.text,
          ownerUsername: c.ownerUsername,
          timestamp: c.timestamp,
        }));

        // Filter comments matching keywords
        const matchingComments = comments.filter(c => {
          const text = c.text.toLowerCase();
          return commentKeywords.some(kw => text.includes(kw.toLowerCase()));
        });

        // Update result with comments
        setResults(prev => prev.map(r => 
          r.postId === result.postId 
            ? { ...r, comments, matchingComments }
            : r
        ));

        if (matchingComments.length > 0) {
          toast.success(`${matchingComments.length} comentários com palavras-chave encontrados!`);
        } else {
          toast.info('Nenhum comentário com as palavras-chave selecionadas');
        }
      }
    } catch (error) {
      console.error('Fetch comments error:', error);
      toast.error('Erro ao buscar comentários');
    } finally {
      setLoadingComments(null);
    }
  };

  const addCommentKeyword = () => {
    if (customCommentKeyword.trim() && !commentKeywords.includes(customCommentKeyword.trim())) {
      setCommentKeywords([...commentKeywords, customCommentKeyword.trim()]);
      setCustomCommentKeyword('');
    }
  };

  const removeCommentKeyword = (kw: string) => {
    setCommentKeywords(commentKeywords.filter(k => k !== kw));
  };

  const handleCreateLead = async (result: SearchResult, comment?: CommentData) => {
    try {
      const { error } = await supabase.from('leads').insert({
        lead_name: comment?.ownerUsername || result.username,
        instagram_username: comment?.ownerUsername || result.username,
        source: 'case_search',
        notes: `Post: ${result.postUrl}\n\nCaption: ${result.caption?.substring(0, 500)}\n\n${comment ? `Comentário: ${comment.text}` : ''}`,
        news_link: result.postUrl,
      });

      if (error) throw error;

      toast.success('Lead criado com sucesso!');
    } catch (error) {
      console.error('Create lead error:', error);
      toast.error('Erro ao criar lead');
    }
  };

  // Helper functions for advanced filters
  const addExcludeTerm = () => {
    if (customExcludeTerm.trim() && !excludeTerms.includes(customExcludeTerm.trim())) {
      setExcludeTerms([...excludeTerms, customExcludeTerm.trim()]);
      setCustomExcludeTerm('');
    }
  };

  const removeExcludeTerm = (term: string) => {
    setExcludeTerms(excludeTerms.filter(t => t !== term));
  };

  // Create advanced search matcher
  const advancedMatcher = parseAdvancedSearch(advancedSearchQuery);
  
  // Filter results with all criteria
  const filteredResults = results.filter(r => {
    // Minimum comments filter
    if (r.commentsCount < minComments) return false;
    
    // Advanced search query filter (applies to caption + location + username)
    if (advancedSearchQuery.trim()) {
      const textToCheck = `${r.caption || ''} ${r.location || ''} ${r.username || ''}`;
      if (!advancedMatcher(textToCheck)) {
        return false;
      }
    }
    
    // Exclude terms filter (check caption and location)
    if (excludeTerms.length > 0) {
      const textToCheck = `${r.caption || ''} ${r.location || ''}`.toLowerCase();
      if (excludeTerms.some(term => textToCheck.includes(term.toLowerCase()))) {
        return false;
      }
    }
    
    // Location filter
    if (locationFilter.trim()) {
      const location = (r.location || '').toLowerCase();
      const caption = (r.caption || '').toLowerCase();
      const filterLower = locationFilter.toLowerCase();
      if (!location.includes(filterLower) && !caption.includes(filterLower)) {
        return false;
      }
    }
    
    // Media type filter
    if (mediaTypeFilter !== 'all') {
      const mediaType = (r.mediaType || '').toLowerCase();
      switch (mediaTypeFilter) {
        case 'image':
          if (mediaType !== 'image' && mediaType !== 'photo') return false;
          break;
        case 'video':
          if (mediaType !== 'video' && mediaType !== 'reel') return false;
          break;
        case 'carousel':
          if (mediaType !== 'carousel' && mediaType !== 'album') return false;
          break;
      }
    }
    
    return true;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" />
                Máquina de Busca de Casos
              </CardTitle>
              {accountName && (
                <Badge variant="outline" className="text-xs">
                  Conta: @{accountName}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* History Button */}
              <Dialog open={showHistory} onOpenChange={setShowHistory}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <History className="h-4 w-4 mr-2" />
                    Histórico
                    {history.length > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {history.length}
                      </Badge>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <History className="h-5 w-5" />
                      Histórico de Buscas
                    </DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[500px] pr-4">
                    {isLoadingHistory ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : history.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>Nenhuma busca realizada ainda</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {history.map((item) => (
                          <div
                            key={item.id}
                            className="border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {item.keywords.map((kw, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">
                                      {kw}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}
                                  <span>•</span>
                                  <span>{item.results_count || 0} posts</span>
                                  <span>•</span>
                                  <Badge 
                                    variant={item.status === 'completed' ? 'default' : item.status === 'running' ? 'secondary' : 'destructive'}
                                    className="text-xs"
                                  >
                                    {item.status === 'completed' ? 'Concluída' : item.status === 'running' ? 'Em andamento' : 'Falhou'}
                                  </Badge>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {item.status === 'completed' && item.results_count && item.results_count > 0 ? (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => loadFromHistory(item)}
                                    className="gap-1"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    Abrir Pesquisa
                                  </Button>
                                ) : item.status === 'running' ? (
                                  <Button variant="ghost" size="sm" disabled>
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    Aguardando
                                  </Button>
                                ) : (
                                  <Badge variant="destructive" className="text-xs">
                                    Sem resultados
                                  </Badge>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => deleteSearchRecord(item.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              {/* Settings Button */}
              <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4 mr-2" />
                    Configurações
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Configurações da Busca</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Nome da Conta (para identificação)</Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Nome da conta secundária que você está usando para scraping
                      </p>
                      <Input
                        placeholder="conta_scraping"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                      />
                    </div>
                    
                    <div>
                      <Label>Cookies do Instagram (JSON)</Label>
                      <div className="bg-muted/50 rounded-lg p-3 mb-3 text-xs space-y-2">
                        <p className="font-medium text-foreground">Como exportar os cookies:</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>Instale a extensão <a href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm" target="_blank" rel="noopener noreferrer" className="text-primary underline">Cookie-Editor</a> no Chrome</li>
                          <li>Faça login no Instagram com a conta secundária</li>
                          <li>Clique no ícone da extensão Cookie-Editor</li>
                          <li>Clique em <strong>"Export"</strong> (ícone de download)</li>
                          <li>Selecione <strong>"Export as JSON"</strong></li>
                          <li>Cole o JSON copiado no campo abaixo</li>
                        </ol>
                      </div>
                      <Textarea
                        placeholder='[{"name":"sessionid","value":"...","domain":".instagram.com",...}]'
                        value={instagramCookies}
                        onChange={(e) => setInstagramCookies(e.target.value)}
                        rows={6}
                        className="font-mono text-xs"
                      />
                    </div>
                    
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                          <p className="font-medium">Segurança</p>
                          <p>Use uma conta secundária do Instagram para scraping. Nunca use sua conta pessoal principal.</p>
                        </div>
                      </div>
                    </div>
                    
                    <Button onClick={saveSettings} className="w-full">
                      <Save className="h-4 w-4 mr-2" />
                      Salvar Configurações
                    </Button>
                    
                    {instagramCookies && (
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <Check className="h-4 w-4" />
                        Cookies configurados
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Keywords */}
          <div>
            <Label>Palavras-chave de busca</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Separe múltiplas palavras-chave por vírgula (ex: acidente trabalho, morte trabalhador)
            </p>
            <Input
              placeholder="acidente trabalho, morte trabalhador, acidente fatal"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>

          {/* Period Filter */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              Período de Publicação
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Select value={periodPreset} onValueChange={handlePeriodPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7 dias</SelectItem>
                  <SelectItem value="15">Últimos 15 dias</SelectItem>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="90">Últimos 3 meses</SelectItem>
                  <SelectItem value="180">Últimos 6 meses</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "dd/MM/yyyy", { locale: ptBR }) : "De"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={(date) => {
                      setDateFrom(date);
                      setPeriodPreset('custom');
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "dd/MM/yyyy", { locale: ptBR }) : "Até"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={(date) => {
                      setDateTo(date);
                      setPeriodPreset('custom');
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              
              <div className="text-xs text-muted-foreground flex items-center">
                {dateFrom && dateTo && (
                  <span>
                    {Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24))} dias
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Mínimo de Comentários</Label>
              <Select value={minComments.toString()} onValueChange={(v) => setMinComments(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sem mínimo</SelectItem>
                  <SelectItem value="5">5+ comentários</SelectItem>
                  <SelectItem value="10">10+ comentários</SelectItem>
                  <SelectItem value="20">20+ comentários</SelectItem>
                  <SelectItem value="50">50+ comentários</SelectItem>
                  <SelectItem value="100">100+ comentários</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Máximo de Posts</Label>
              <Select value={maxPosts.toString()} onValueChange={(v) => setMaxPosts(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 posts</SelectItem>
                  <SelectItem value="50">50 posts</SelectItem>
                  <SelectItem value="100">100 posts</SelectItem>
                  <SelectItem value="200">200 posts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleSearch} disabled={isSearching} className="w-full">
                {isSearching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {searchStatus || 'Buscando...'}
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Buscar
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Search Progress Indicator */}
          {isSearching && searchStatus && (
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{searchStatus}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                A busca pode demorar alguns minutos dependendo da quantidade de posts
              </p>
            </div>
          )}

          <Separator />

          {/* Advanced Post Filters */}
          <div className="space-y-4">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
            >
              <Filter className="h-4 w-4" />
              Filtros Avançados (Pós-Busca)
              <Badge variant="secondary" className="text-xs">
                {(advancedSearchQuery ? 1 : 0) + excludeTerms.length + (locationFilter ? 1 : 0) + (mediaTypeFilter !== 'all' ? 1 : 0)} ativos
              </Badge>
            </button>

            {showAdvancedFilters && (
              <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
                {/* Advanced Search Query */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-primary" />
                      Busca Avançada com Operadores
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setShowSearchTips(!showSearchTips)}
                    >
                      <HelpCircle className="h-3 w-3 mr-1" />
                      {showSearchTips ? 'Ocultar dicas' : 'Ver dicas'}
                    </Button>
                  </div>
                  
                  {showSearchTips && (
                    <div className="bg-muted/50 rounded-lg p-3 mb-3 text-xs space-y-2">
                      <p className="font-medium text-foreground mb-2">Operadores disponíveis:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {SEARCH_TIPS.map((tip, index) => (
                          <div key={index} className="flex items-start gap-2 p-2 bg-background/50 rounded">
                            <Badge variant="outline" className="font-mono text-xs shrink-0">
                              {tip.operator}
                            </Badge>
                            <div>
                              <code className="text-primary text-xs">{tip.example}</code>
                              <p className="text-muted-foreground text-xs">{tip.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <Input
                    placeholder='Ex: "acidente fatal" E (colega OU cunhado) NÃO leve'
                    value={advancedSearchQuery}
                    onChange={(e) => setAdvancedSearchQuery(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use operadores E, OU, NÃO, aspas para texto exato, * para curinga, ()~n para proximidade
                  </p>
                </div>

                <Separator />

                {/* Exclude Terms */}
                <div>
                  <Label className="flex items-center gap-2 mb-2">
                    <MinusCircle className="h-4 w-4 text-destructive" />
                    Excluir posts com estes termos
                  </Label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {excludeTerms.map(term => (
                      <Badge 
                        key={term} 
                        variant="destructive" 
                        className="cursor-pointer hover:bg-destructive/80"
                        onClick={() => removeExcludeTerm(term)}
                      >
                        {term} ×
                      </Badge>
                    ))}
                    {excludeTerms.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">Nenhum termo excluído</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Termo para excluir..."
                      value={customExcludeTerm}
                      onChange={(e) => setCustomExcludeTerm(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addExcludeTerm()}
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={addExcludeTerm}>
                      Excluir
                    </Button>
                  </div>
                </div>

                {/* Location Filter */}
                <div>
                  <Label className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-blue-500" />
                    Filtrar por localização
                  </Label>
                  <Input
                    placeholder="Ex: São Paulo, Campinas, MG..."
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Busca na localização do post ou na legenda
                  </p>
                </div>

                {/* Media Type Filter */}
                <div>
                  <Label className="flex items-center gap-2 mb-2">
                    <LayoutGrid className="h-4 w-4" />
                    Tipo de Mídia
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={mediaTypeFilter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMediaTypeFilter('all')}
                    >
                      Todos
                    </Button>
                    <Button
                      variant={mediaTypeFilter === 'image' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMediaTypeFilter('image')}
                    >
                      <Image className="h-4 w-4 mr-1" />
                      Imagens
                    </Button>
                    <Button
                      variant={mediaTypeFilter === 'video' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMediaTypeFilter('video')}
                    >
                      <Video className="h-4 w-4 mr-1" />
                      Reels/Vídeos
                    </Button>
                    <Button
                      variant={mediaTypeFilter === 'carousel' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMediaTypeFilter('carousel')}
                    >
                      <LayoutGrid className="h-4 w-4 mr-1" />
                      Carrosseis
                    </Button>
                  </div>
                </div>

                {/* Clear all filters */}
                {(excludeTerms.length > 0 || locationFilter || mediaTypeFilter !== 'all') && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setExcludeTerms([]);
                      setLocationFilter('');
                      setMediaTypeFilter('all');
                    }}
                    className="text-muted-foreground"
                  >
                    Limpar todos os filtros
                  </Button>
                )}
              </div>
            )}
          </div>

          <Separator />
          <div>
            <Label className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Palavras-chave nos Comentários (para filtrar)
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Após buscar posts, filtre comentários que contenham estas palavras (relacionamentos familiares)
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {commentKeywords.map(kw => (
                <Badge 
                  key={kw} 
                  variant="secondary" 
                  className="cursor-pointer hover:bg-destructive/20"
                  onClick={() => removeCommentKeyword(kw)}
                >
                  {kw} ×
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Adicionar palavra-chave..."
                value={customCommentKeyword}
                onChange={(e) => setCustomCommentKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addCommentKeyword()}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addCommentKeyword}>
                Adicionar
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-xs text-muted-foreground">Sugestões:</span>
              {RELATIONSHIP_KEYWORDS.filter(k => !commentKeywords.includes(k)).slice(0, 10).map(kw => (
                <Badge 
                  key={kw} 
                  variant="outline" 
                  className="cursor-pointer text-xs hover:bg-primary/10"
                  onClick={() => setCommentKeywords([...commentKeywords, kw])}
                >
                  + {kw}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {filteredResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-2">
                Resultados
                <Badge variant="secondary">{filteredResults.length} posts</Badge>
                {results.length !== filteredResults.length && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({results.length - filteredResults.length} filtrados)
                  </span>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              <div className="space-y-4">
                {filteredResults.map((result) => (
                  <CaseSearchResultCard
                    key={result.postId}
                    result={result}
                    commentKeywords={commentKeywords}
                    isLoadingComments={loadingComments === result.postId}
                    onFetchComments={() => handleFetchComments(result)}
                  />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* No Results */}
      {!isSearching && results.length > 0 && filteredResults.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum post com {minComments}+ comentários encontrado</p>
            <Button variant="link" onClick={() => setMinComments(0)}>
              Remover filtro de comentários
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
