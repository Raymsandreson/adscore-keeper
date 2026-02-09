import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Upload,
  FileJson,
  Check,
  AlertCircle,
  MessageCircle,
  ChevronDown,
  Info,
  Download,
  ExternalLink,
} from 'lucide-react';

interface ApifyComment {
  id: string;
  text: string;
  ownerUsername: string;
  owner?: { id?: string };
  ownerId?: string;
  timestamp: string;
  likesCount?: number;
  repliesCount?: number;
  replies?: ApifyComment[];
  postUrl?: string;
}

interface ImportApifyJsonProps {
  onImportComplete?: () => void;
}

export function ImportApifyJson({ onImportComplete }: ImportApifyJsonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [saved, setSaved] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [errors, setErrors] = useState(0);
  const [showInstructions, setShowInstructions] = useState(false);
  const [myUsername, setMyUsername] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    setTotal(0);
    setSaved(0);
    setDuplicates(0);
    setErrors(0);

    try {
      const text = await file.text();
      const json: ApifyComment[] = JSON.parse(text);

      if (!Array.isArray(json)) {
        throw new Error('O arquivo deve conter um array JSON');
      }

      // Build all comments (main + replies)
      const allComments: any[] = [];
      const myUser = myUsername.trim().toLowerCase();

      for (const comment of json) {
        if (!comment.id || !comment.text) continue;

        const isOwn = myUser && comment.ownerUsername?.toLowerCase() === myUser;

        allComments.push({
          comment_id: comment.id,
          comment_text: comment.text,
          author_username: comment.ownerUsername || 'unknown',
          author_id: comment.owner?.id || comment.ownerId || null,
          created_at: comment.timestamp || new Date().toISOString(),
          post_url: comment.postUrl || null,
          comment_type: isOwn ? 'sent' : 'received',
          platform: 'instagram',
          metadata: {
            source: 'apify_json_import',
            likes_count: comment.likesCount || 0,
            replies_count: comment.repliesCount || 0,
            is_outbound: true,
          },
        });

        // Nested replies
        if (comment.replies && Array.isArray(comment.replies)) {
          for (const reply of comment.replies) {
            if (!reply.id || !reply.text) continue;
            const isOwnReply = myUser && reply.ownerUsername?.toLowerCase() === myUser;
            allComments.push({
              comment_id: reply.id,
              comment_text: reply.text,
              author_username: reply.ownerUsername || 'unknown',
              author_id: reply.owner?.id || reply.ownerId || null,
              created_at: reply.timestamp || new Date().toISOString(),
              post_url: comment.postUrl || null,
              comment_type: isOwnReply ? 'sent' : 'received',
              parent_comment_id: comment.id,
              platform: 'instagram',
              metadata: {
                source: 'apify_json_import',
                likes_count: reply.likesCount || 0,
                is_outbound: true,
              },
            });
          }
        }
      }

      setTotal(allComments.length);

      // Get existing comment_ids to skip duplicates
      const commentIds = allComments.map(c => c.comment_id);
      const { data: existing } = await supabase
        .from('instagram_comments')
        .select('comment_id')
        .in('comment_id', commentIds);
      
      const existingIds = new Set((existing || []).map(e => e.comment_id));
      const newComments = allComments.filter(c => !existingIds.has(c.comment_id));
      const duplicateCount = allComments.length - newComments.length;

      // Batch insert in chunks of 100
      const BATCH_SIZE = 100;
      let savedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < newComments.length; i += BATCH_SIZE) {
        const batch = newComments.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from('instagram_comments')
          .insert(batch);

        if (error) {
          console.error('Batch error:', error.message);
          errorCount += batch.length;
        } else {
          savedCount += batch.length;
        }

        setProgress(((i + BATCH_SIZE) / newComments.length) * 100);
      }

      setSaved(savedCount);
      setDuplicates(duplicateCount);
      setErrors(errorCount);
      toast.success(`${savedCount} importados, ${duplicateCount} duplicados ignorados`);
      onImportComplete?.();
    } catch (error) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao importar JSON');
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.json'));
    if (!file) {
      toast.error('Arraste apenas arquivos .json');
      return;
    }
    processFile(file);
  }, [myUsername]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5" />
          Importar JSON do Apify
        </CardTitle>
        <CardDescription>
          Importe comentários diretamente do arquivo JSON exportado do Apify
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Instructions */}
        <Collapsible open={showInstructions} onOpenChange={setShowInstructions}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                Como baixar o JSON do Apify
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showInstructions && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="rounded-lg border p-4 space-y-3 text-sm bg-muted/30">
              <ol className="list-decimal list-inside space-y-2">
                <li>
                  Acesse o <a href="https://console.apify.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Console do Apify <ExternalLink className="h-3 w-3" /></a>
                </li>
                <li>Vá em <strong>Actors → Runs</strong> e encontre a execução do Instagram Comment Scraper</li>
                <li>Clique na execução desejada para abrir os detalhes</li>
                <li>Vá na aba <strong>Storage</strong> → <strong>Dataset</strong></li>
                <li>Em <strong>Export dataset</strong>, selecione o formato <strong>JSON</strong></li>
                <li>Clique no botão <strong className="text-primary">Download</strong></li>
                <li>O arquivo será salvo como <code className="bg-muted px-1.5 py-0.5 rounded text-xs">dataset_instagram-comment-scraper_*.json</code></li>
              </ol>
              <div className="flex items-center gap-2 text-muted-foreground mt-2 pt-2 border-t">
                <Download className="h-4 w-4" />
                <span>O arquivo baixado pode ser arrastado diretamente para a área abaixo</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* My username (optional) */}
        <div className="space-y-1.5">
          <Label className="text-xs">Seu username (opcional - para marcar seus comentários como "enviados")</Label>
          <Input
            placeholder="seu_username"
            value={myUsername}
            onChange={(e) => setMyUsername(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Drop zone */}
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
          <Upload className={cn("h-10 w-10 mx-auto mb-3", isDragging ? "text-primary" : "text-muted-foreground")} />
          <p className="text-sm font-medium">
            {isDragging ? "Solte o arquivo aqui" : "Arraste o JSON do Apify ou clique para selecionar"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            dataset_instagram-comment-scraper_*.json
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Progress */}
        {isProcessing && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground text-center">
              Importando... {Math.round(progress)}%
            </p>
          </div>
        )}

        {/* Results */}
        {total > 0 && !isProcessing && (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <MessageCircle className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-500/10">
              <Check className="h-5 w-5 mx-auto mb-1 text-green-500" />
              <div className="text-2xl font-bold text-green-500">{saved}</div>
              <div className="text-xs text-muted-foreground">Importados</div>
            </div>
            {errors > 0 && (
              <div className="text-center p-3 rounded-lg bg-red-500/10">
                <AlertCircle className="h-5 w-5 mx-auto mb-1 text-red-500" />
                <div className="text-2xl font-bold text-red-500">{errors}</div>
                <div className="text-xs text-muted-foreground">Erros</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
