import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, ExternalLink, Instagram } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LinkedComment {
  id: string;
  comment_text: string | null;
  author_username: string | null;
  post_url: string | null;
  post_id: string | null;
  created_at: string;
  comment_type: string;
  platform: string;
  funnel_stage: string | null;
}

interface LeadLinkedCommentsProps {
  leadId: string;
  instagramUsername?: string | null;
}

export function LeadLinkedComments({ leadId, instagramUsername }: LeadLinkedCommentsProps) {
  const [comments, setComments] = useState<LinkedComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLinkedComments();
  }, [leadId, instagramUsername]);

  const fetchLinkedComments = async () => {
    setLoading(true);
    try {
      // 1. Comments linked via instagram_comment_id on leads table
      const { data: leadData } = await supabase
        .from('leads')
        .select('instagram_comment_id, instagram_username')
        .eq('id', leadId)
        .maybeSingle();

      const commentIds: string[] = [];
      if (leadData?.instagram_comment_id) {
        commentIds.push(leadData.instagram_comment_id);
      }

      // 2. Also find comments by instagram_username match
      const username = instagramUsername || leadData?.instagram_username;
      
      let allComments: LinkedComment[] = [];

      if (commentIds.length > 0) {
        const { data } = await supabase
          .from('instagram_comments')
          .select('id, comment_text, author_username, post_url, post_id, created_at, comment_type, platform, funnel_stage')
          .in('id', commentIds);
        if (data) allComments = [...allComments, ...data];
      }

      if (username) {
        const cleanUsername = username.replace('@', '');
        const { data } = await supabase
          .from('instagram_comments')
          .select('id, comment_text, author_username, post_url, post_id, created_at, comment_type, platform, funnel_stage')
          .ilike('author_username', cleanUsername)
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) {
          // Merge without duplicates
          const existingIds = new Set(allComments.map(c => c.id));
          allComments = [...allComments, ...data.filter(c => !existingIds.has(c.id))];
        }
      }

      // Sort by date desc
      allComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setComments(allComments);
    } catch (error) {
      console.error('Error fetching linked comments:', error);
    } finally {
      setLoading(false);
    }
  };

  // Group comments by post_url
  const groupedByPost = comments.reduce<Record<string, LinkedComment[]>>((acc, comment) => {
    const key = comment.post_url || 'sem-postagem';
    if (!acc[key]) acc[key] = [];
    acc[key].push(comment);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        Carregando comentários vinculados...
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
        <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
        Nenhum comentário vinculado a este lead
      </div>
    );
  }

  const extractShortcode = (url: string) => {
    try {
      const match = url.match(/\/(p|reel)\/([^/?]+)/);
      return match ? match[2].substring(0, 8) : url.substring(0, 30);
    } catch {
      return url.substring(0, 30);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2 text-sm">
          <MessageCircle className="h-4 w-4" />
          Comentários Vinculados
        </h4>
        <Badge variant="secondary" className="text-xs">
          {comments.length} comentário{comments.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="space-y-3">
        {Object.entries(groupedByPost).map(([postUrl, postComments]) => (
          <div key={postUrl} className="border rounded-lg overflow-hidden">
            {/* Post header */}
            <div className="bg-muted/50 px-3 py-2 flex items-center justify-between border-b">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Instagram className="h-3.5 w-3.5" />
                {postUrl !== 'sem-postagem' ? (
                  <span>Post: {extractShortcode(postUrl)}</span>
                ) : (
                  <span className="text-muted-foreground">Sem postagem</span>
                )}
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {postComments.length}
                </Badge>
              </div>
              {postUrl !== 'sem-postagem' && (
                <a
                  href={postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Abrir
                </a>
              )}
            </div>

            {/* Comments list */}
            <div className="divide-y">
              {postComments.map((comment) => (
                <div key={comment.id} className="px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-primary">
                      @{comment.author_username || 'desconhecido'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(comment.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/80 line-clamp-3">
                    {comment.comment_text || '(sem texto)'}
                  </p>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {comment.comment_type === 'inbound' ? 'Recebido' : comment.comment_type === 'outbound' ? 'Enviado' : comment.comment_type}
                    </Badge>
                    {comment.funnel_stage && comment.funnel_stage !== 'comment' && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {comment.funnel_stage}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
