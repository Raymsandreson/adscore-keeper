import { useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  Upload, 
  FileJson, 
  Check, 
  AlertCircle, 
  Filter, 
  ArrowUpFromLine,
  Users,
  ExternalLink,
  MessageCircle,
  Reply,
  UserPlus,
  Home,
  Globe
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface InstagramComment {
  media_list_data?: { uri: string }[];
  string_map_data: {
    Comment: { value: string };
    'Media Owner': { value: string };
    Time: { timestamp: number };
  };
}

interface ReelsComment {
  string_map_data: {
    Comment: { value: string };
    'Media Owner': { value: string };
    Time: { timestamp: number };
  };
}

interface ParsedComment {
  comment_text: string;
  media_owner: string;
  timestamp: number;
  created_at: string;
  post_uri: string | null;
  is_reply: boolean;
  mentioned_username: string | null;
  is_own_post: boolean;
}

interface ImportStats {
  total: number;
  outbound: number;
  own: number;
  replies: number;
  duplicates: number;
  imported: number;
}

interface ImportCommentsFromExportProps {
  ownAccountUsernames: string[];
  onImportComplete?: () => void;
}

export function ImportCommentsFromExport({ 
  ownAccountUsernames, 
  onImportComplete 
}: ImportCommentsFromExportProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [progress, setProgress] = useState(0);
  const [parsedComments, setParsedComments] = useState<ParsedComment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<'outbound' | 'own'>('outbound');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalize username for comparison
  const normalizeUsername = (username: string) => {
    return username.toLowerCase().replace(/[^a-z0-9._]/g, '');
  };

  // Check if comment is from own account
  const isOwnAccount = useCallback((mediaOwner: string) => {
    const normalized = normalizeUsername(mediaOwner);
    return ownAccountUsernames.some(own => normalizeUsername(own) === normalized);
  }, [ownAccountUsernames]);

  // Decode UTF-8 mojibake common in Instagram exports
  const decodeText = (text: string): string => {
    try {
      return decodeURIComponent(escape(text));
    } catch {
      return text;
    }
  };

  // Extract mentioned username from comment (e.g., "@username texto")
  const extractMention = (text: string): string | null => {
    const match = text.match(/^@([a-zA-Z0-9._]+)/);
    return match ? match[1] : null;
  };

  // Parse comment from JSON structure
  const parseComment = (item: InstagramComment | ReelsComment): ParsedComment | null => {
    try {
      const data = item.string_map_data;
      if (!data?.Comment?.value || !data['Media Owner']?.value || !data.Time?.timestamp) {
        return null;
      }

      const timestamp = data.Time.timestamp;
      const createdAt = new Date(timestamp * 1000).toISOString();
      const commentText = decodeText(data.Comment.value);
      const mediaOwner = data['Media Owner'].value;
      const postUri = 'media_list_data' in item && item.media_list_data?.[0]?.uri 
        ? item.media_list_data[0].uri 
        : null;
      
      const mentionedUsername = extractMention(commentText);
      const isReply = mentionedUsername !== null;
      const isOwnPost = isOwnAccount(mediaOwner);

      return {
        comment_text: commentText,
        media_owner: mediaOwner,
        timestamp,
        created_at: createdAt,
        post_uri: postUri,
        is_reply: isReply,
        mentioned_username: mentionedUsername,
        is_own_post: isOwnPost,
      };
    } catch {
      return null;
    }
  };

  // Filtered comments by type
  const outboundComments = useMemo(() => 
    parsedComments.filter(c => !c.is_own_post), [parsedComments]);
  
  const ownPostComments = useMemo(() => 
    parsedComments.filter(c => c.is_own_post), [parsedComments]);

  // Group comments by media_owner for preview
  const groupedOutbound = useMemo(() => {
    const groups: Record<string, ParsedComment[]> = {};
    outboundComments.forEach(c => {
      if (!groups[c.media_owner]) {
        groups[c.media_owner] = [];
      }
      groups[c.media_owner].push(c);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [outboundComments]);

  // Process files (shared logic for input and drag-drop)
  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setStats(null);
    setParsedComments([]);

    const allComments: ParsedComment[] = [];
    const fileArray = Array.from(files);

    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const text = await file.text();
        const json = JSON.parse(text);

        // Handle different export formats
        let items: (InstagramComment | ReelsComment)[] = [];
        
        if (Array.isArray(json)) {
          items = json;
        } else if (json.comments_reels_comments) {
          items = json.comments_reels_comments;
        } else if (json.comments_media_comments) {
          items = json.comments_media_comments;
        }

        for (const item of items) {
          const parsed = parseComment(item);
          if (parsed) {
            allComments.push(parsed);
          }
        }

        setProgress(((i + 1) / fileArray.length) * 50);
      }

      // Count replies
      const repliesCount = allComments.filter(c => c.is_reply).length;
      const outboundCount = allComments.filter(c => !c.is_own_post).length;
      const ownCount = allComments.filter(c => c.is_own_post).length;

      setParsedComments(allComments);
      setStats({
        total: allComments.length,
        outbound: outboundCount,
        own: ownCount,
        replies: repliesCount,
        duplicates: 0,
        imported: 0,
      });

      toast.success(`${allComments.length} comentários processados!`);
    } catch (error) {
      console.error('Error parsing files:', error);
      toast.error('Erro ao processar arquivos JSON');
    } finally {
      setIsProcessing(false);
      setProgress(50);
    }
  };

  // Handle file input change
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      await processFiles(files);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    const jsonFiles = Array.from(files).filter(f => f.name.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      toast.error('Por favor, arraste apenas arquivos .json');
      return;
    }

    await processFiles(jsonFiles);
  }, []);

  // Create contact from media owner
  const createContact = async (username: string) => {
    try {
      // Check if contact already exists
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('instagram_username', username)
        .limit(1);

      if (existing && existing.length > 0) {
        toast.info(`Contato @${username} já existe`);
        return;
      }

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('contacts')
        .insert({
          full_name: `@${username}`,
          instagram_username: username,
          instagram_url: `https://instagram.com/${username}`,
          notes: 'Criado via importação de comentários outbound',
          created_by: currentUser?.id || null,
        });

      if (error) throw error;
      toast.success(`Contato @${username} criado!`);
    } catch (error) {
      console.error('Error creating contact:', error);
      toast.error('Erro ao criar contato');
    }
  };

  // Import comments to database
  const handleImport = async (importType: 'outbound' | 'own' | 'all') => {
    const commentsToImport = importType === 'outbound' 
      ? outboundComments 
      : importType === 'own' 
        ? ownPostComments 
        : parsedComments;

    if (commentsToImport.length === 0) {
      toast.error('Nenhum comentário para importar');
      return;
    }

    setIsProcessing(true);
    let imported = 0;
    let duplicates = 0;

    try {
      for (let i = 0; i < commentsToImport.length; i++) {
        const comment = commentsToImport[i];

        // Check for existing comment (by timestamp and text)
        const { data: existing } = await supabase
          .from('instagram_comments')
          .select('id')
          .eq('comment_text', comment.comment_text)
          .gte('created_at', new Date((comment.timestamp - 60) * 1000).toISOString())
          .lte('created_at', new Date((comment.timestamp + 60) * 1000).toISOString())
          .limit(1);

        if (existing && existing.length > 0) {
          duplicates++;
        } else {
          // Determine comment type
          const commentType = comment.is_own_post 
            ? (comment.is_reply ? 'sent' : 'received') 
            : 'outbound_export';

          // Insert new comment
          const { error } = await supabase
            .from('instagram_comments')
            .insert({
              comment_text: comment.comment_text,
              comment_type: commentType,
              created_at: comment.created_at,
              platform: 'instagram',
              prospect_name: comment.media_owner,
              post_url: comment.post_uri || null,
              metadata: {
                source: 'instagram_export',
                media_owner: comment.media_owner,
                original_timestamp: comment.timestamp,
                is_reply: comment.is_reply,
                mentioned_username: comment.mentioned_username,
              },
            });

          if (!error) {
            imported++;
          }
        }

        setProgress(50 + ((i + 1) / commentsToImport.length) * 50);
      }

      setStats(prev => prev ? { ...prev, imported, duplicates } : null);
      toast.success(`${imported} comentários importados! (${duplicates} duplicados ignorados)`);
      onImportComplete?.();
    } catch (error) {
      console.error('Error importing:', error);
      toast.error('Erro ao importar comentários');
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Importar Comentários do Instagram
        </CardTitle>
        <CardDescription>
          Importe seus comentários exportados do Instagram para rastrear interações.
          Separa automaticamente comentários em posts próprios vs terceiros.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Account filter info */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground">Suas contas:</span>
          {ownAccountUsernames.map(username => (
            <Badge key={username} variant="secondary">
              @{username}
            </Badge>
          ))}
        </div>

        {/* Drag and Drop Zone */}
        <div className="space-y-2">
          <Label>Arquivos JSON do Instagram</Label>
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragging 
                ? "border-primary bg-primary/10" 
                : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
              isProcessing && "pointer-events-none opacity-50"
            )}
          >
            <Upload className={cn(
              "h-10 w-10 mx-auto mb-3",
              isDragging ? "text-primary" : "text-muted-foreground"
            )} />
            <p className="text-sm font-medium">
              {isDragging ? "Solte os arquivos aqui" : "Arraste arquivos JSON ou clique para selecionar"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              post_comments.json, reels_comments.json e similares
            </p>
          </div>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".json"
            multiple
            onChange={handleFileChange}
            disabled={isProcessing}
            className="hidden"
          />
        </div>

        {/* Progress bar */}
        {isProcessing && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground text-center">
              Processando... {Math.round(progress)}%
            </p>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <FileJson className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-500/10">
              <Globe className="h-5 w-5 mx-auto mb-1 text-blue-500" />
              <div className="text-2xl font-bold text-blue-500">{stats.outbound}</div>
              <div className="text-xs text-muted-foreground">Terceiros</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-purple-500/10">
              <Home className="h-5 w-5 mx-auto mb-1 text-purple-500" />
              <div className="text-2xl font-bold text-purple-500">{stats.own}</div>
              <div className="text-xs text-muted-foreground">Posts Próprios</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-orange-500/10">
              <Reply className="h-5 w-5 mx-auto mb-1 text-orange-500" />
              <div className="text-2xl font-bold text-orange-500">{stats.replies}</div>
              <div className="text-xs text-muted-foreground">Respostas (@)</div>
            </div>
            {stats.imported > 0 && (
              <div className="text-center p-3 rounded-lg bg-green-500/10">
                <Check className="h-5 w-5 mx-auto mb-1 text-green-500" />
                <div className="text-2xl font-bold text-green-500">{stats.imported}</div>
                <div className="text-xs text-muted-foreground">Importados</div>
              </div>
            )}
            {stats.duplicates > 0 && (
              <div className="text-center p-3 rounded-lg bg-yellow-500/10">
                <AlertCircle className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
                <div className="text-2xl font-bold text-yellow-500">{stats.duplicates}</div>
                <div className="text-xs text-muted-foreground">Duplicados</div>
              </div>
            )}
          </div>
        )}

        {/* Preview with Tabs */}
        {parsedComments.length > 0 && stats && stats.imported === 0 && (
          <div className="space-y-3">
            <Tabs value={activePreviewTab} onValueChange={(v) => setActivePreviewTab(v as 'outbound' | 'own')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="outbound" className="gap-2">
                  <Globe className="h-4 w-4" />
                  Terceiros ({outboundComments.length})
                </TabsTrigger>
                <TabsTrigger value="own" className="gap-2">
                  <Home className="h-4 w-4" />
                  Posts Próprios ({ownPostComments.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="outbound" className="space-y-3">
                {groupedOutbound.length > 0 ? (
                  <ScrollArea className="h-64">
                    <div className="space-y-3">
                      {groupedOutbound.slice(0, 10).map(([owner, ownerComments]) => (
                        <div key={owner} className="border rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <a
                                href={`https://instagram.com/${owner}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors"
                              >
                                @{owner}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <Badge variant="secondary" className="text-xs">
                                {ownerComments.length} comentário{ownerComments.length > 1 ? 's' : ''}
                              </Badge>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => createContact(owner)}
                              className="h-7 gap-1"
                            >
                              <UserPlus className="h-3 w-3" />
                              Criar Contato
                            </Button>
                          </div>
                          <div className="space-y-1">
                            {ownerComments.slice(0, 3).map((comment, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm">
                                {comment.is_reply ? (
                                  <Reply className="h-3 w-3 mt-1 text-orange-500 flex-shrink-0" />
                                ) : (
                                  <MessageCircle className="h-3 w-3 mt-1 text-muted-foreground flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-muted-foreground line-clamp-1">{comment.comment_text}</p>
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(comment.created_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {ownerComments.length > 3 && (
                              <p className="text-xs text-muted-foreground">
                                +{ownerComments.length - 3} mais...
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                      {groupedOutbound.length > 10 && (
                        <p className="text-xs text-muted-foreground text-center">
                          +{groupedOutbound.length - 10} perfis adicionais
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Nenhum comentário em posts de terceiros</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="own" className="space-y-3">
                {ownPostComments.length > 0 ? (
                  <ScrollArea className="h-64">
                    <div className="space-y-2">
                      {ownPostComments.slice(0, 10).map((comment, idx) => (
                        <div key={idx} className="p-2 rounded border bg-muted/30 text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">
                              @{comment.media_owner}
                            </Badge>
                            {comment.is_reply && comment.mentioned_username && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Reply className="h-3 w-3" />
                                @{comment.mentioned_username}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {format(new Date(comment.created_at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                          <p className="text-muted-foreground line-clamp-2">{comment.comment_text}</p>
                        </div>
                      ))}
                      {ownPostComments.length > 10 && (
                        <p className="text-xs text-muted-foreground text-center">
                          +{ownPostComments.length - 10} comentários adicionais
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Home className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Nenhum comentário em posts próprios</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Import buttons */}
        {parsedComments.length > 0 && stats && stats.imported === 0 && (
          <div className="flex flex-wrap gap-2">
            {outboundComments.length > 0 && (
              <Button 
                onClick={() => handleImport('outbound')} 
                disabled={isProcessing}
                className="flex-1 min-w-[200px]"
              >
                <Globe className="h-4 w-4 mr-2" />
                Importar {outboundComments.length} Outbound
              </Button>
            )}
            {ownPostComments.length > 0 && (
              <Button 
                onClick={() => handleImport('own')} 
                disabled={isProcessing}
                variant="outline"
                className="flex-1 min-w-[200px]"
              >
                <Home className="h-4 w-4 mr-2" />
                Importar {ownPostComments.length} Próprios
              </Button>
            )}
            {outboundComments.length > 0 && ownPostComments.length > 0 && (
              <Button 
                onClick={() => handleImport('all')} 
                disabled={isProcessing}
                variant="secondary"
                className="w-full"
              >
                <ArrowUpFromLine className="h-4 w-4 mr-2" />
                Importar Todos ({parsedComments.length})
              </Button>
            )}
          </div>
        )}

        {/* Success state */}
        {stats && stats.imported > 0 && (
          <div className="text-center py-4">
            <Check className="h-12 w-12 mx-auto text-green-500 mb-2" />
            <p className="text-lg font-medium">Importação concluída!</p>
            <p className="text-sm text-muted-foreground">
              {stats.imported} comentários foram adicionados ao sistema
            </p>
          </div>
        )}

        {/* Instructions */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Como exportar do Instagram
          </h4>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Acesse Central de Contas da Meta</li>
            <li>Vá em "Suas informações e permissões"</li>
            <li>Clique em "Baixar suas informações"</li>
            <li>Selecione a conta do Instagram</li>
            <li>Escolha "Comentários" nos dados a incluir</li>
            <li>Faça o download e extraia os arquivos JSON</li>
          </ol>
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            <strong>Nota:</strong> O link da postagem nem sempre está disponível nos arquivos de exportação.
            Comentários com @ no início são identificados como respostas.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
