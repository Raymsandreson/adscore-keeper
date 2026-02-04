import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { WorkflowFullscreen } from "@/components/instagram/WorkflowFullscreen";
import { toast } from "sonner";

interface Comment {
  id: string;
  comment_id?: string;
  comment_text: string | null;
  author_username: string | null;
  author_id?: string | null;
  post_url: string | null;
  post_id?: string | null;
  parent_comment_id?: string | null;
  platform: string;
  created_at: string;
  replied_at?: string | null;
  comment_type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}

const WorkflowPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | undefined>();
  
  const filterType = searchParams.get('filter') || 'pending';

  const fetchComments = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch unreplied comments that can be replied to (have comment_id)
      let query = supabase
        .from('instagram_comments')
        .select('*')
        .eq('comment_type', 'received')
        .not('comment_id', 'is', null)
        .is('replied_at', null)
        .order('created_at', { ascending: false });
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      setComments(data || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
      toast.error('Erro ao carregar comentários');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAccessToken = useCallback(async () => {
    const { data } = await supabase
      .from('instagram_accounts')
      .select('access_token')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    
    if (data?.access_token) {
      setAccessToken(data.access_token);
    }
  }, []);

  useEffect(() => {
    fetchComments();
    fetchAccessToken();
  }, [fetchComments, fetchAccessToken]);

  const handleClose = () => {
    navigate(-1);
  };

  const handleRefresh = () => {
    fetchComments();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          <span className="text-lg">Carregando comentários...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <WorkflowFullscreen
        comments={comments}
        accessToken={accessToken}
        onClose={handleClose}
        onRefresh={handleRefresh}
      />
    </div>
  );
};

export default WorkflowPage;
