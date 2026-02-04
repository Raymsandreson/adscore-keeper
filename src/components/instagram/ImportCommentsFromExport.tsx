import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Upload, FileJson, Check, AlertCircle, Filter, ArrowUpFromLine } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
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
}

interface ImportStats {
  total: number;
  outbound: number;
  own: number;
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
      // Fix common UTF-8 encoding issues
      return decodeURIComponent(escape(text));
    } catch {
      return text;
    }
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

      return {
        comment_text: decodeText(data.Comment.value),
        media_owner: data['Media Owner'].value,
        timestamp,
        created_at: createdAt,
      };
    } catch {
      return null;
    }
  };

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
          // post_comments format
          items = json;
        } else if (json.comments_reels_comments) {
          // reels_comments format
          items = json.comments_reels_comments;
        } else if (json.comments_media_comments) {
          // Alternative format
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

      // Filter outbound vs own
      const outboundComments = allComments.filter(c => !isOwnAccount(c.media_owner));
      const ownComments = allComments.filter(c => isOwnAccount(c.media_owner));

      setParsedComments(outboundComments);
      setStats({
        total: allComments.length,
        outbound: outboundComments.length,
        own: ownComments.length,
        duplicates: 0,
        imported: 0,
      });

      toast.success(`${outboundComments.length} comentários outbound encontrados!`);
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
  }, [processFiles]);

  // Import comments to database
  const handleImport = async () => {
    if (parsedComments.length === 0) {
      toast.error('Nenhum comentário para importar');
      return;
    }

    setIsProcessing(true);
    let imported = 0;
    let duplicates = 0;

    try {
      for (let i = 0; i < parsedComments.length; i++) {
        const comment = parsedComments[i];

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
          // Insert new comment
          const { error } = await supabase
            .from('instagram_comments')
            .insert({
              comment_text: comment.comment_text,
              comment_type: 'outbound_export',
              created_at: comment.created_at,
              platform: 'instagram',
              prospect_name: comment.media_owner,
              metadata: {
                source: 'instagram_export',
                media_owner: comment.media_owner,
                original_timestamp: comment.timestamp,
              },
            });

          if (!error) {
            imported++;
          }
        }

        setProgress(50 + ((i + 1) / parsedComments.length) * 50);
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
          Importe seus comentários exportados do Instagram para rastrear interações outbound.
          Apenas comentários em posts de terceiros serão importados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Account filter info */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground">Contas próprias (serão ignoradas):</span>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <FileJson className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-500/10">
              <ArrowUpFromLine className="h-5 w-5 mx-auto mb-1 text-blue-500" />
              <div className="text-2xl font-bold text-blue-500">{stats.outbound}</div>
              <div className="text-xs text-muted-foreground">Outbound</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <Filter className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold">{stats.own}</div>
              <div className="text-xs text-muted-foreground">Posts Próprios</div>
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

        {/* Preview */}
        {parsedComments.length > 0 && stats && stats.imported === 0 && (
          <div className="space-y-3">
            <h4 className="font-medium">Preview ({Math.min(5, parsedComments.length)} de {parsedComments.length})</h4>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {parsedComments.slice(0, 5).map((comment, idx) => (
                <div key={idx} className="p-2 rounded border bg-muted/30 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      @{comment.media_owner}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{comment.comment_text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Import button */}
        {parsedComments.length > 0 && stats && stats.imported === 0 && (
          <Button 
            onClick={handleImport} 
            disabled={isProcessing}
            className="w-full"
          >
            <ArrowUpFromLine className="h-4 w-4 mr-2" />
            Importar {parsedComments.length} Comentários Outbound
          </Button>
        )}

        {/* Success state */}
        {stats && stats.imported > 0 && (
          <div className="text-center py-4">
            <Check className="h-12 w-12 mx-auto text-green-500 mb-2" />
            <p className="text-lg font-medium">Importação concluída!</p>
            <p className="text-sm text-muted-foreground">
              {stats.imported} comentários outbound foram adicionados ao sistema
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
        </div>
      </CardContent>
    </Card>
  );
}
