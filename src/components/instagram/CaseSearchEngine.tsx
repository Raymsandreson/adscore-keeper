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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Sparkles,
  Lightbulb,
  AlertTriangle,
  Save,
  Check,
  History,
  Trash2,
  Clock,
  CheckSquare,
  Square,
  Link2,
  Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';
import { CaseSearchResultCard } from './CaseSearchResultCard';
import { PostCommentsFetcher } from './PostCommentsFetcher';
import { PostExtractionHistory } from './PostExtractionHistory';
import { PostGroupedView } from './PostGroupedView';
import { HistoryCommentsDialog } from './HistoryCommentsDialog';
import { HistoryItemCard } from './HistoryItemCard';
import { format, subDays, subMonths, subWeeks, subYears, startOfDay, startOfWeek, startOfMonth, startOfYear, endOfDay, endOfWeek, endOfMonth, endOfYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { parseAdvancedSearch, SEARCH_TIPS } from '@/utils/advancedSearchParser';
import { ProfileSearchEngine } from './ProfileSearchEngine';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  const { user } = useAuthContext();
  const [keywords, setKeywords] = useState('');
  const [minComments, setMinComments] = useState(0);
  const [maxPosts, setMaxPosts] = useState(50);
  const [commentKeywords, setCommentKeywords] = useState<string[]>(['colega', 'cunhado', 'esposo', 'filho']);
  const [customCommentKeyword, setCustomCommentKeyword] = useState('');
  const [filterByCommentKeywords, setFilterByCommentKeywords] = useState(false); // Toggle to enable keyword filtering
  const [instagramCookies, setInstagramCookies] = useState('');
  const [accountName, setAccountName] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingComments, setLoadingComments] = useState<string | null>(null);
  const [isLoadingAllComments, setIsLoadingAllComments] = useState(false);
  const [loadingAllProgress, setLoadingAllProgress] = useState({ current: 0, total: 0 });
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  
  // Date range filters
  const [dateFrom, setDateFrom] = useState<Date | undefined>(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState<Date | undefined>(new Date());
  const [periodPreset, setPeriodPreset] = useState<string>('last_x_days');
  const [customDays, setCustomDays] = useState<number>(30);

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
  const [selectedHistoryComments, setSelectedHistoryComments] = useState<{
    open: boolean;
    postUrls: string[];
    comments: any[];
    postMetadata?: {
      postUrl: string;
      caption?: string;
      thumbnailUrl?: string;
      mediaType?: 'image' | 'video';
      postOwner?: string;
      commentsCount?: number;
      viewsCount?: number;
    };
  }>({ open: false, postUrls: [], comments: [] });
  
  // Separate search fields for posts and comments
  const [postSearchQuery, setPostSearchQuery] = useState('');
  const [commentSearchQuery, setCommentSearchQuery] = useState('');
  const [searchInPosts, setSearchInPosts] = useState(true);
  const [searchInComments, setSearchInComments] = useState(true);
  
  // AI keyword suggestions
  const [aiTopic, setAiTopic] = useState('');
  const [isLoadingAiSuggestions, setIsLoadingAiSuggestions] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  
  // Search history hook
  const { history, isLoading: isLoadingHistory, resumingId, createSearchRecord, updateSearchResults, resumeSearch, deleteSearchRecord } = useSearchHistory();

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
      case 'today':
        setDateFrom(startOfDay(now));
        setDateTo(endOfDay(now));
        break;
      case 'yesterday':
        const yesterday = subDays(now, 1);
        setDateFrom(startOfDay(yesterday));
        setDateTo(endOfDay(yesterday));
        break;
      case 'this_week':
        setDateFrom(startOfWeek(now, { weekStartsOn: 0 }));
        setDateTo(endOfDay(now));
        break;
      case 'this_month':
        setDateFrom(startOfMonth(now));
        setDateTo(endOfDay(now));
        break;
      case 'this_year':
        setDateFrom(startOfYear(now));
        setDateTo(endOfDay(now));
        break;
      case 'last_year':
        const lastYear = subYears(now, 1);
        setDateFrom(startOfYear(lastYear));
        setDateTo(endOfYear(lastYear));
        break;
      case 'last_x_days':
        setDateFrom(subDays(now, customDays));
        setDateTo(now);
        break;
      case 'custom':
        // Keep current dates
        break;
    }
  };

  const handleCustomDaysChange = (days: number) => {
    setCustomDays(days);
    if (periodPreset === 'last_x_days') {
      const now = new Date();
      setDateFrom(subDays(now, days));
      setDateTo(now);
    }
  };

  // Quando datas são alteradas manualmente, mudar para custom
  const handleDateFromChange = (date: Date | undefined) => {
    setDateFrom(date);
    setPeriodPreset('custom');
  };

  const handleDateToChange = (date: Date | undefined) => {
    setDateTo(date);
    setPeriodPreset('custom');
  };

  const pollForResults = async (runId: string) => {
    const maxAttempts = 360; // 30 minutes max (5s * 360) - increased for large multi-keyword searches
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      setSearchStatus(`Aguardando resultados... (${attempts * 5}s)`);

      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      try {
        const { data: statusData, error: statusError } = await cloudFunctions.invoke('search-instagram-posts', {
          body: { action: 'status', runId },
        });

        if (statusError) throw statusError;

        if (statusData?.isFailed) {
          throw new Error('A busca falhou no Apify');
        }

        if (statusData?.isComplete) {
          setSearchStatus('Carregando resultados...');
          
          // Fetch results
          const { data: resultsData, error: resultsError } = await cloudFunctions.invoke('search-instagram-posts', {
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
      const { data, error } = await cloudFunctions.invoke('search-instagram-posts', {
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

  const loadCommentsFromHistory = (item: typeof history[0]) => {
    if (item.results && Array.isArray(item.results) && item.search_type === 'post') {
      // Extract post metadata from the first comment or results
      const firstResult = item.results[0] as any;
      const postMetadata = firstResult?.metadata ? {
        postUrl: item.post_urls?.[0] || '',
        caption: firstResult.metadata.post_caption,
        thumbnailUrl: firstResult.metadata.post_thumbnail || firstResult.metadata.thumbnail_url,
        mediaType: firstResult.metadata.media_type as 'image' | 'video' | undefined,
        postOwner: firstResult.metadata.post_owner,
        commentsCount: item.results_count || item.results.length,
      } : item.post_urls?.[0] ? {
        postUrl: item.post_urls[0],
        commentsCount: item.results_count || item.results.length,
      } : undefined;

      setSelectedHistoryComments({
        open: true,
        postUrls: item.post_urls || [],
        comments: item.results as any[],
        postMetadata,
      });
      setShowHistory(false);
    } else {
      toast.error('Esta extração não possui comentários salvos');
    }
  };

  const handleResumeSearch = async (item: typeof history[0]) => {
    const results = await resumeSearch(item);
    if (results && results.length > 0) {
      setResults(results as unknown as SearchResult[]);
      setKeywords(item.keywords.join(', '));
      setShowHistory(false);
    }
  };

  const handleFetchComments = async (result: SearchResult) => {
    setLoadingComments(result.postId);

    try {
      const { data, error } = await cloudFunctions.invoke('fetch-post-comments', {
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

  // Shared function to load comments for a list of posts
  const loadCommentsForPosts = async (posts: SearchResult[]) => {
    setIsLoadingAllComments(true);
    setLoadingAllProgress({ current: 0, total: posts.length });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < posts.length; i++) {
      const result = posts[i];
      setLoadingAllProgress({ current: i + 1, total: posts.length });

      try {
        const { data, error } = await cloudFunctions.invoke('fetch-post-comments', {
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

          successCount++;
        }
      } catch (error) {
        console.error(`Error fetching comments for ${result.postId}:`, error);
        errorCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setIsLoadingAllComments(false);
    setLoadingAllProgress({ current: 0, total: 0 });

    if (successCount > 0) {
      toast.success(`Comentários carregados: ${successCount} posts`);
    }
    if (errorCount > 0) {
      toast.error(`Falha em ${errorCount} posts`);
    }
  };

  // Batch load comments for filtered/visible posts only
  const handleFetchAllComments = async () => {
    const postsWithoutComments = filteredResults.filter(r => !r.comments || r.comments.length === 0);
    
    if (postsWithoutComments.length === 0) {
      toast.info('Todos os posts já têm comentários carregados');
      return;
    }

    await loadCommentsForPosts(postsWithoutComments);
  };

  // Batch load comments for selected posts only
  const handleFetchSelectedComments = async () => {
    const selectedPostsArray = filteredResults.filter(r => 
      selectedPosts.has(r.postId) && (!r.comments || r.comments.length === 0)
    );
    
    if (selectedPostsArray.length === 0) {
      toast.info('Nenhum post selecionado ou todos já têm comentários');
      return;
    }

    await loadCommentsForPosts(selectedPostsArray);
    // Clear selection after loading
    setSelectedPosts(new Set());
    setSelectionMode(false);
  };

  // Selection handlers
  const handleSelectPost = (postId: string, selected: boolean) => {
    setSelectedPosts(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(postId);
      } else {
        next.delete(postId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const postsWithoutComments = filteredResults.filter(r => !r.comments || r.comments.length === 0);
    setSelectedPosts(new Set(postsWithoutComments.map(p => p.postId)));
  };

  const handleDeselectAll = () => {
    setSelectedPosts(new Set());
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectedPosts(new Set());
    }
    setSelectionMode(!selectionMode);
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
        created_by: user?.id || null,
        updated_by: user?.id || null,
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
  
  // Clear all filters function
  const clearAllFilters = () => {
    setAdvancedSearchQuery('');
    setExcludeTerms([]);
    setLocationFilter('');
    setMediaTypeFilter('all');
    setPostSearchQuery('');
    setCommentSearchQuery('');
    setMinComments(0);
    // Also reset date filters to show all results
    setDateFrom(undefined);
    setDateTo(undefined);
    setPeriodPreset('custom');
    setFilterByCommentKeywords(false);
  };
  
  // Check if any filter is active
  const hasActiveFilters = advancedSearchQuery || 
    excludeTerms.length > 0 || 
    locationFilter || 
    mediaTypeFilter !== 'all' || 
    postSearchQuery ||
    commentSearchQuery ||
    minComments > 0 ||
    dateFrom !== undefined ||
    dateTo !== undefined ||
    filterByCommentKeywords;

  // Create advanced search matcher
  const advancedMatcher = parseAdvancedSearch(advancedSearchQuery);
  const postMatcher = parseAdvancedSearch(postSearchQuery);
  const commentMatcher = parseAdvancedSearch(commentSearchQuery);
  
  // Filter results with all criteria
  const filteredResults = results.filter(r => {
    // Date range filter - filter by posted date
    if (dateFrom || dateTo) {
      const postedDate = r.postedDate ? new Date(r.postedDate) : null;
      
      if (postedDate) {
        if (dateFrom) {
          const fromStart = new Date(dateFrom);
          fromStart.setHours(0, 0, 0, 0);
          if (postedDate < fromStart) return false;
        }
        if (dateTo) {
          const toEnd = new Date(dateTo);
          toEnd.setHours(23, 59, 59, 999);
          if (postedDate > toEnd) return false;
        }
      }
    }
    
    // Minimum comments filter
    if (minComments > 0 && r.commentsCount < minComments) return false;
    
    // Advanced search query filter (applies to caption + location + username)
    if (advancedSearchQuery.trim()) {
      const textToCheck = `${r.caption || ''} ${r.location || ''} ${r.username || ''}`;
      if (!advancedMatcher(textToCheck)) {
        return false;
      }
    }
    
    // Post search query (searches in caption, location, username)
    if (postSearchQuery.trim() && searchInPosts) {
      const textToCheck = `${r.caption || ''} ${r.location || ''} ${r.username || ''}`;
      if (!postMatcher(textToCheck)) {
        return false;
      }
    }
    
    // Comment search query (searches in loaded comments)
    if (commentSearchQuery.trim() && searchInComments) {
      // Only filter if comments are loaded
      if (r.comments && r.comments.length > 0) {
        const hasMatchingComment = r.comments.some(c => 
          commentMatcher(c.text || '')
        );
        if (!hasMatchingComment) return false;
      }
      // If no comments loaded yet, don't filter by comments
    }
    
    // Comment keywords filter - filter posts that CONTAIN comments with these keywords
    if (filterByCommentKeywords && commentKeywords.length > 0) {
      // Only apply if comments are loaded
      if (r.comments && r.comments.length > 0) {
        const hasKeywordMatch = r.comments.some(c => {
          const text = (c.text || '').toLowerCase();
          return commentKeywords.some(kw => text.includes(kw.toLowerCase()));
        });
        if (!hasKeywordMatch) return false;
      } else {
        // If comments not loaded, hide the post when filter is active
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

  // Calculate selectable posts count after filteredResults is defined
  const selectablePostsCount = filteredResults.filter(r => !r.comments || r.comments.length === 0).length;

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
                          <HistoryItemCard
                            key={item.id}
                            item={item}
                            onViewComments={(histItem) => loadCommentsFromHistory(histItem as typeof history[0])}
                            onLoadResults={(histItem) => loadFromHistory(histItem as typeof history[0])}
                            onResume={(histItem) => handleResumeSearch(histItem as typeof history[0])}
                            onDelete={deleteSearchRecord}
                            isResuming={resumingId === item.id}
                          />
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
          <Tabs defaultValue="hashtag" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="hashtag" className="gap-2">
                <Hash className="h-4 w-4" />
                Busca por Hashtag
              </TabsTrigger>
              <TabsTrigger value="post" className="gap-2">
                <Link2 className="h-4 w-4" />
                Busca por Post
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-2">
                <Users className="h-4 w-4" />
                Busca por Perfil
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="post" className="mt-0 space-y-6">
              <PostCommentsFetcher />
              <PostGroupedView />
              <PostExtractionHistory />
            </TabsContent>

            <TabsContent value="profile" className="mt-0">
              <ProfileSearchEngine />
            </TabsContent>
            
            <TabsContent value="hashtag" className="mt-0 space-y-4">
          {/* AI Keyword Suggestions */}
          <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg p-4 border border-primary/20">
            <Label className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              Sugestão de Palavras-chave por IA
            </Label>
            <p className="text-xs text-muted-foreground mb-3">
              Digite o assunto que deseja buscar e a IA vai sugerir palavras-chave eficazes
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: acidente de trabalho em construção civil, atropelamento, incêndio..."
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="default"
                onClick={async () => {
                  if (!aiTopic.trim()) {
                    toast.error('Digite um assunto para buscar sugestões');
                    return;
                  }
                  setIsLoadingAiSuggestions(true);
                  setAiSuggestions([]);
                  try {
                    const { data, error } = await cloudFunctions.invoke('suggest-search-keywords', {
                      body: { topic: aiTopic },
                    });
                    if (error) throw error;
                    if (data?.success && data?.keywords) {
                      setAiSuggestions(data.keywords);
                      toast.success(`${data.keywords.length} sugestões geradas!`);
                    } else {
                      throw new Error(data?.error || 'Erro ao gerar sugestões');
                    }
                  } catch (error) {
                    console.error('AI suggestion error:', error);
                    toast.error(error instanceof Error ? error.message : 'Erro ao gerar sugestões');
                  } finally {
                    setIsLoadingAiSuggestions(false);
                  }
                }}
                disabled={isLoadingAiSuggestions || !aiTopic.trim()}
              >
                {isLoadingAiSuggestions ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Lightbulb className="h-4 w-4 mr-2" />
                    Sugerir
                  </>
                )}
              </Button>
            </div>
            
            {aiSuggestions.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Clique para adicionar às palavras-chave:
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => {
                      const allSuggestions = aiSuggestions.join(', ');
                      setKeywords(prev => prev ? `${prev}, ${allSuggestions}` : allSuggestions);
                      toast.success('Todas as sugestões adicionadas!');
                      setAiSuggestions([]);
                    }}
                  >
                    Adicionar todas
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {aiSuggestions.map((suggestion, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => {
                        setKeywords(prev => prev ? `${prev}, ${suggestion}` : suggestion);
                        setAiSuggestions(prev => prev.filter((_, idx) => idx !== i));
                        toast.success(`"${suggestion}" adicionado!`);
                      }}
                    >
                      + {suggestion}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          
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
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <Select value={periodPreset} onValueChange={handlePeriodPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="yesterday">Ontem</SelectItem>
                  <SelectItem value="this_week">Esta semana</SelectItem>
                  <SelectItem value="this_month">Este mês</SelectItem>
                  <SelectItem value="this_year">Este ano</SelectItem>
                  <SelectItem value="last_year">Ano passado</SelectItem>
                  <SelectItem value="last_x_days">Últimos X dias</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
              
              {periodPreset === 'last_x_days' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Últimos</span>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={customDays}
                    onChange={(e) => handleCustomDaysChange(parseInt(e.target.value) || 30)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              )}
              
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
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Palavras-chave nos Comentários (para filtrar)
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {filterByCommentKeywords ? 'Filtro ativo' : 'Apenas destaque'}
                </span>
                <Button
                  variant={filterByCommentKeywords ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterByCommentKeywords(!filterByCommentKeywords)}
                  className="h-7 text-xs"
                >
                  {filterByCommentKeywords ? 'Filtrando' : 'Ativar Filtro'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {filterByCommentKeywords 
                ? 'Mostrando apenas posts com comentários carregados que contenham estas palavras'
                : 'As palavras-chave destacam comentários, clique "Ativar Filtro" para filtrar posts'}
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {commentKeywords.map(kw => (
                <Badge 
                  key={kw} 
                  variant={filterByCommentKeywords ? 'default' : 'secondary'}
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
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-2">
                Resultados
                <Badge variant="secondary">{filteredResults.length} posts</Badge>
                {results.length !== filteredResults.length && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({results.length - filteredResults.length} filtrados de {results.length} total)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Selection mode toggle */}
                <Button
                  variant={selectionMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleSelectionMode}
                  className="gap-1"
                  disabled={selectablePostsCount === 0}
                >
                  {selectionMode ? (
                    <>
                      <CheckSquare className="h-4 w-4" />
                      Selecionando ({selectedPosts.size})
                    </>
                  ) : (
                    <>
                      <Square className="h-4 w-4" />
                      Selecionar
                    </>
                  )}
                </Button>
                
                {/* Selection actions */}
                {selectionMode && (
                  <>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={handleSelectAll}
                      className="text-xs"
                    >
                      Todos ({selectablePostsCount})
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={handleDeselectAll}
                      className="text-xs"
                      disabled={selectedPosts.size === 0}
                    >
                      Limpar
                    </Button>
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={handleFetchSelectedComments}
                      disabled={isLoadingAllComments || selectedPosts.size === 0}
                      className="gap-1"
                    >
                      {isLoadingAllComments ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {loadingAllProgress.current}/{loadingAllProgress.total}
                        </>
                      ) : (
                        <>
                          <MessageCircle className="h-4 w-4" />
                          Carregar ({selectedPosts.size})
                        </>
                      )}
                    </Button>
                  </>
                )}
                
                {/* Batch load all comments button */}
                {!selectionMode && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleFetchAllComments}
                    disabled={isLoadingAllComments || selectablePostsCount === 0}
                    className="gap-1"
                  >
                    {isLoadingAllComments ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {loadingAllProgress.current}/{loadingAllProgress.total}
                      </>
                    ) : (
                      <>
                        <MessageCircle className="h-4 w-4" />
                        Carregar Todos ({selectablePostsCount})
                      </>
                    )}
                  </Button>
                )}
                
                {hasActiveFilters && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={clearAllFilters}
                    className="gap-1"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Limpar Filtros
                  </Button>
                )}
              </div>
            </CardTitle>
            
            {/* Real-time search filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Search className="h-3.5 w-3.5" />
                  Buscar na legenda/post
                </Label>
                <Input
                  placeholder="Digite para filtrar posts..."
                  value={postSearchQuery}
                  onChange={(e) => setPostSearchQuery(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Buscar nos comentários
                </Label>
                <Input
                  placeholder="Digite para filtrar por comentários..."
                  value={commentSearchQuery}
                  onChange={(e) => setCommentSearchQuery(e.target.value)}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground">
                  Funciona apenas em posts com comentários carregados
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredResults.length > 0 ? (
              <ScrollArea className="h-[600px]">
                <div className="space-y-4">
                  {filteredResults.map((result) => (
                    <CaseSearchResultCard
                      key={result.postId}
                      result={result}
                      commentKeywords={commentKeywords}
                      isLoadingComments={loadingComments === result.postId}
                      onFetchComments={() => handleFetchComments(result)}
                      showSelection={selectionMode}
                      isSelected={selectedPosts.has(result.postId)}
                      onSelectChange={(selected) => handleSelectPost(result.postId, selected)}
                    />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                <Filter className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">Nenhum post corresponde aos filtros atuais</p>
                <p className="text-xs mb-4">
                  {minComments > 0 && `Mínimo de ${minComments} comentários • `}
                  {postSearchQuery && `Busca no post: "${postSearchQuery}" • `}
                  {commentSearchQuery && `Busca em comentários: "${commentSearchQuery}"`}
                </p>
                <Button variant="outline" onClick={clearAllFilters}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Limpar todos os filtros
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog to view comments from history - uses new component with full workflow UI */}
      <HistoryCommentsDialog
        open={selectedHistoryComments.open}
        onOpenChange={(open) => setSelectedHistoryComments(prev => ({ ...prev, open }))}
        postUrls={selectedHistoryComments.postUrls}
        comments={selectedHistoryComments.comments}
        postMetadata={selectedHistoryComments.postMetadata}
      />
    </div>
  );
}
