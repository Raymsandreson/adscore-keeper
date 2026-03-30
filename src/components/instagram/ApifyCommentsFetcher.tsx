import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Search, ExternalLink, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface ApifyCommentsFetcherProps {
  myUsername?: string;
  onSuccess?: () => void;
}

export const ApifyCommentsFetcher = ({ myUsername, onSuccess }: ApifyCommentsFetcherProps) => {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [postUrls, setPostUrls] = useState("");
  const [results, setResults] = useState<{
    total: number;
    savedToDatabase: number;
    saveErrors: number;
    postsProcessed: number;
  } | null>(null);

  const handleFetch = async () => {
    const urls = postUrls
      .split("\n")
      .map(url => url.trim())
      .filter(url => url.length > 0 && url.includes("instagram.com"));

    if (urls.length === 0) {
      toast.error("Cole pelo menos uma URL válida do Instagram");
      return;
    }

    setIsLoading(true);
    setResults(null);

    try {
      const { data, error } = await cloudFunctions.invoke("fetch-apify-comments", {
        body: { 
          postUrls: urls,
          myUsername: myUsername?.replace("@", "")
        }
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || "Erro desconhecido");
      }

      setResults({
        total: data.total,
        savedToDatabase: data.savedToDatabase,
        saveErrors: data.saveErrors,
        postsProcessed: data.postsProcessed
      });

      // Auto-save posts to external_posts table
      for (const url of urls) {
        const normalizedUrl = url.replace(/\/reels\//gi, '/reel/').replace(/\/$/, '');
        const { data: existingPost } = await supabase
          .from('external_posts')
          .select('id')
          .eq('url', normalizedUrl)
          .maybeSingle();

        if (existingPost) {
          await supabase.from('external_posts').update({
            comments_count: data.total || 0,
            last_fetched_at: new Date().toISOString(),
          }).eq('id', existingPost.id);
        } else {
          await supabase.from('external_posts').insert({
            url: normalizedUrl,
            platform: 'instagram',
            comments_count: data.total || 0,
            last_fetched_at: new Date().toISOString(),
          });
        }
      }

      if (data.savedToDatabase > 0) {
        toast.success(`${data.savedToDatabase} comentários importados!`);
        onSuccess?.();
      } else {
        toast.info("Nenhum comentário novo encontrado");
      }
    } catch (error: any) {
      console.error("Erro ao buscar comentários:", error);
      toast.error(error.message || "Erro ao buscar comentários via Apify");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Search className="h-4 w-4" />
          Buscar de Posts Externos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Buscar Comentários de Posts Externos
          </DialogTitle>
          <DialogDescription>
            Use a integração Apify para buscar comentários de posts de terceiros automaticamente
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Como funciona:</p>
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  <li>Cole URLs de posts do Instagram (um por linha)</li>
                  <li>O sistema busca todos os comentários e respostas</li>
                  <li>Seus comentários são marcados como "enviados"</li>
                  <li>Respostas de outros são marcadas como "recebidos"</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="postUrls">URLs dos posts (uma por linha)</Label>
            <Textarea
              id="postUrls"
              placeholder={"https://instagram.com/p/ABC123...\nhttps://instagram.com/reel/XYZ789..."}
              value={postUrls}
              onChange={(e) => setPostUrls(e.target.value)}
              rows={5}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Aceita links de posts, reels e vídeos públicos
            </p>
          </div>

          {results && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Posts processados:</span>
                    <Badge variant="outline" className="ml-2">{results.postsProcessed}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total comentários:</span>
                    <Badge variant="outline" className="ml-2">{results.total}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Salvos no banco:</span>
                    <Badge variant="default" className="ml-2">{results.savedToDatabase}</Badge>
                  </div>
                  {results.saveErrors > 0 && (
                    <div>
                      <span className="text-muted-foreground">Erros:</span>
                      <Badge variant="destructive" className="ml-2">{results.saveErrors}</Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Fechar
            </Button>
            <Button onClick={handleFetch} disabled={isLoading || !postUrls.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar Comentários
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
