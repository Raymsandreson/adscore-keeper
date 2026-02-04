import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  Filter,
  Hash,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CaseSearchResultCard } from './CaseSearchResultCard';

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

export function CaseSearchEngine() {
  const [keywords, setKeywords] = useState('');
  const [minComments, setMinComments] = useState(5);
  const [maxPosts, setMaxPosts] = useState(50);
  const [commentKeywords, setCommentKeywords] = useState<string[]>(['colega', 'cunhado', 'esposo', 'filho']);
  const [customCommentKeyword, setCustomCommentKeyword] = useState('');
  const [instagramCookies, setInstagramCookies] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingComments, setLoadingComments] = useState<string | null>(null);

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

    try {
      const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);

      const { data, error } = await supabase.functions.invoke('search-instagram-posts', {
        body: {
          keywords: keywordList,
          maxPosts,
          instagramCookies,
          minComments,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setResults(data.posts || []);
        toast.success(`Encontrados ${data.total} posts`);
      } else {
        throw new Error(data?.error || 'Erro na busca');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao buscar posts');
    } finally {
      setIsSearching(false);
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

  // Filter results by minimum comments
  const filteredResults = results.filter(r => r.commentsCount >= minComments);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              Máquina de Busca de Casos
            </CardTitle>
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
                    <Label>Cookies do Instagram (JSON)</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Exporte os cookies do Instagram usando a extensão EditThisCookie ou Cookie-Editor
                    </p>
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
                </div>
              </DialogContent>
            </Dialog>
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
                    Buscando...
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

          <Separator />

          {/* Comment Keywords Filter */}
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
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                Resultados
                <Badge variant="secondary">{filteredResults.length} posts</Badge>
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
                    onCreateLead={(comment) => handleCreateLead(result, comment)}
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
