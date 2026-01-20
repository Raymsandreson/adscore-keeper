import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  MessageCircle, 
  Send, 
  Inbox, 
  Plus,
  RefreshCw,
  ExternalLink,
  Clock,
  User,
  Reply,
  UserPlus,
  CheckCircle2,
  Search,
  CalendarIcon,
  X,
  Timer,
  CheckCheck,
  Image,
  Tag
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { CommentsEvolutionChart } from "./CommentsEvolutionChart";
import { InstagramAccountSelector, InstagramAccount } from "./InstagramAccountSelector";
import { InstagramProfileHoverCard } from "./InstagramProfileHoverCard";

type ProspectClassification = 'prospect' | 'client' | 'closer' | 'sdr' | 'team' | 'other' | null;

const CLASSIFICATIONS: { key: ProspectClassification; label: string; color: string; bgColor: string }[] = [
  { key: null, label: 'Sem classificação', color: 'text-muted-foreground', bgColor: 'bg-muted' },
  { key: 'prospect', label: 'Prospecto', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  { key: 'client', label: 'Cliente', color: 'text-emerald-600', bgColor: 'bg-emerald-100' },
  { key: 'closer', label: 'Acolhedor', color: 'text-purple-600', bgColor: 'bg-purple-100' },
  { key: 'sdr', label: 'SDR', color: 'text-orange-600', bgColor: 'bg-orange-100' },
  { key: 'team', label: 'Equipe', color: 'text-amber-600', bgColor: 'bg-amber-100' },
  { key: 'other', label: 'Outro', color: 'text-slate-600', bgColor: 'bg-slate-100' },
];

interface Comment {
  id: string;
  platform: string;
  comment_type: string;
  post_id: string | null;
  post_url: string | null;
  comment_text: string | null;
  author_username: string | null;
  author_id: string | null;
  created_at: string;
  converted_to_lead?: boolean;
  prospect_classification?: string[] | null;
  ad_account_id?: string | null;
}

interface CommentsTrackerProps {
  pageId?: string;
  accessToken?: string;
  isConnected: boolean;
}

export const CommentsTracker = ({ pageId, accessToken, isConnected }: CommentsTrackerProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('received');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [stats, setStats] = useState({ received: 0, sent: 0 });
  const [convertedUsers, setConvertedUsers] = useState<Set<string>>(new Set());
  const [convertingId, setConvertingId] = useState<string | null>(null);
  
  // Instagram account selection
  const [selectedAccounts, setSelectedAccounts] = useState<InstagramAccount[]>([]);
  
  // Classification + Lead conversion dialog states
  const [classifyingComment, setClassifyingComment] = useState<Comment | null>(null);
  const [pendingClassifications, setPendingClassifications] = useState<string[]>([]);
  const [showLeadConfirmDialog, setShowLeadConfirmDialog] = useState(false);
  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  const [selectedClassifications, setSelectedClassifications] = useState<string[]>([]);
  
  // Filter states
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  
  // Auto-refresh states
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(5); // minutes
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Form state for manual comment logging
  const [newComment, setNewComment] = useState({
    post_url: '',
    comment_text: '',
    author_username: '',
    platform: 'instagram'
  });

  // Load last sync time from localStorage
  useEffect(() => {
    const savedSyncTime = localStorage.getItem('comments_last_sync');
    if (savedSyncTime) {
      setLastSyncTime(new Date(savedSyncTime));
    }
  }, []);

  useEffect(() => {
    fetchComments();
    fetchStats();
    checkExistingLeads();
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefreshEnabled && isConnected) {
      autoRefreshTimerRef.current = setInterval(() => {
        syncFromInstagram();
      }, autoRefreshInterval * 60 * 1000);
      
      return () => {
        if (autoRefreshTimerRef.current) {
          clearInterval(autoRefreshTimerRef.current);
        }
      };
    } else {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    }
  }, [autoRefreshEnabled, autoRefreshInterval, isConnected]);

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from('instagram_comments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Count received today
      const { count: receivedCount } = await supabase
        .from('instagram_comments')
        .select('*', { count: 'exact', head: true })
        .eq('comment_type', 'received')
        .gte('created_at', today);

      // Count sent today
      const { count: sentCount } = await supabase
        .from('instagram_comments')
        .select('*', { count: 'exact', head: true })
        .eq('comment_type', 'sent')
        .gte('created_at', today);

      setStats({
        received: receivedCount || 0,
        sent: sentCount || 0
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // Check which usernames are already leads
  const checkExistingLeads = async () => {
    try {
      const { data: leads } = await supabase
        .from('leads')
        .select('lead_name, notes')
        .not('lead_name', 'is', null);

      if (leads) {
        const converted = new Set<string>();
        leads.forEach(lead => {
          // Check if the lead notes contain instagram username reference
          if (lead.notes?.includes('@')) {
            const match = lead.notes.match(/@(\w+)/);
            if (match) converted.add(match[1].toLowerCase());
          }
          // Also check lead_name for direct match
          if (lead.lead_name?.startsWith('@')) {
            converted.add(lead.lead_name.slice(1).toLowerCase());
          }
        });
        setConvertedUsers(converted);
      }
    } catch (error) {
      console.error('Error checking existing leads:', error);
    }
  };

  // Sync comments from Instagram API for all selected accounts
  const syncFromInstagram = useCallback(async () => {
    if (isSyncing) return;
    
    // Check if we have accounts to sync
    if (selectedAccounts.length === 0) {
      toast.error('Selecione pelo menos uma conta para sincronizar');
      return;
    }
    
    setIsSyncing(true);
    let totalSaved = 0;
    let accountsWithErrors = 0;
    
    try {
      for (const account of selectedAccounts) {
        try {
          // Get the access token for this account
          const tokenToUse = account.access_token === 'USE_GLOBAL_TOKEN' 
            ? accessToken 
            : account.access_token;
          
          const { data, error } = await supabase.functions.invoke('fetch-instagram-comments', {
            body: { 
              accessToken: tokenToUse, 
              instagramAccountId: account.instagram_id 
            }
          });

          if (error) {
            console.error(`Error syncing ${account.account_name}:`, error);
            accountsWithErrors++;
            continue;
          }

          if (!data.success) {
            console.error(`Failed to sync ${account.account_name}:`, data.error);
            accountsWithErrors++;
            continue;
          }

          // Save comments to database
          if (data.comments && data.comments.length > 0) {
            // First check existing comment_ids to avoid duplicates
            const { data: existingComments } = await supabase
              .from('instagram_comments')
              .select('comment_id')
              .not('comment_id', 'is', null);
            
            const existingIds = new Set((existingComments || []).map(c => c.comment_id));
            
            // Filter new comments
            const newComments = data.comments.filter((c: any) => !existingIds.has(c.comment_id));
            
            if (newComments.length > 0) {
              // Insert new comments with account reference
              const commentsToInsert = newComments.map((comment: any) => ({
                comment_id: comment.comment_id,
                comment_text: comment.comment_text,
                author_username: comment.author_username,
                created_at: comment.created_at,
                post_id: comment.post_id,
                post_url: comment.post_url,
                comment_type: comment.comment_type,
                parent_comment_id: comment.parent_comment_id || null,
                platform: 'instagram',
                ad_account_id: account.instagram_id, // Track which account this came from
                metadata: { account_name: account.account_name }
              }));
              
              const { error: insertError, data: inserted } = await supabase
                .from('instagram_comments')
                .insert(commentsToInsert)
                .select();

              if (!insertError && inserted) {
                totalSaved += inserted.length;
              }
            }
          }
        } catch (accountError) {
          console.error(`Error syncing account ${account.account_name}:`, accountError);
          accountsWithErrors++;
        }
      }

      // Update last sync time
      const now = new Date();
      setLastSyncTime(now);
      localStorage.setItem('comments_last_sync', now.toISOString());

      if (totalSaved > 0) {
        toast.success(`${totalSaved} comentários sincronizados de ${selectedAccounts.length - accountsWithErrors} conta(s)!`);
        await fetchComments();
        await fetchStats();
        await checkExistingLeads();
      } else if (accountsWithErrors === selectedAccounts.length) {
        toast.error('Erro ao sincronizar todas as contas');
      } else {
        toast.info('Todos os comentários já estão sincronizados');
      }
    } catch (error: any) {
      console.error('Erro ao sincronizar:', error);
      toast.error('Erro ao sincronizar comentários do Instagram');
    } finally {
      setIsSyncing(false);
    }
  }, [accessToken, selectedAccounts, isSyncing]);

  // Format time ago for last sync
  const formatLastSync = (date: Date | null): string => {
    if (!date) return 'Nunca sincronizado';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `Há ${diffMins} min`;
    if (diffHours < 24) return `Há ${diffHours}h`;
    return `Há ${diffDays} dia${diffDays > 1 ? 's' : ''}`;
  };

  // Open classification dialog for a comment
  const openClassificationDialog = (comment: Comment) => {
    setClassifyingComment(comment);
    setSelectedClassifications(comment.prospect_classification || []);
    setShowClassificationDialog(true);
  };

  // Toggle a classification in the selection
  const toggleClassification = (key: string) => {
    setSelectedClassifications(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  };

  // Apply classifications to comment and all comments from the same author
  const handleApplyClassifications = async () => {
    if (!classifyingComment) return;

    const classifications = selectedClassifications.length > 0 ? selectedClassifications : null;
    const username = classifyingComment.author_username?.replace('@', '').toLowerCase();

    try {
      // Update all comments from the same author
      if (username) {
        const { error } = await supabase
          .from('instagram_comments')
          .update({ prospect_classification: classifications })
          .ilike('author_username', username);

        if (error) throw error;

        // Update local state for all comments from this author
        setComments(prev => 
          prev.map(c => {
            const commentUsername = c.author_username?.replace('@', '').toLowerCase();
            if (commentUsername === username) {
              return { ...c, prospect_classification: classifications };
            }
            return c;
          })
        );

        const classLabels = selectedClassifications
          .map(k => CLASSIFICATIONS.find(c => c.key === k)?.label)
          .filter(Boolean)
          .join(', ');
        
        toast.success(
          classLabels 
            ? `Todos os comentários de @${username} classificados como: ${classLabels}`
            : `Classificação removida de @${username}`
        );
      } else {
        // Single comment update (no username)
        const { error } = await supabase
          .from('instagram_comments')
          .update({ prospect_classification: classifications })
          .eq('id', classifyingComment.id);

        if (error) throw error;

        setComments(prev => 
          prev.map(c => c.id === classifyingComment.id ? { ...c, prospect_classification: classifications } : c)
        );
        toast.success('Comentário classificado!');
      }

      setShowClassificationDialog(false);

      // After classification, ask if user wants to convert to lead
      if (username && selectedClassifications.length > 0) {
        const isAlreadyLead = convertedUsers.has(username);
        
        if (!isAlreadyLead) {
          setPendingClassifications(selectedClassifications);
          setShowLeadConfirmDialog(true);
          return; // Keep classifyingComment for the lead dialog
        }
      }

      setClassifyingComment(null);
      setSelectedClassifications([]);
    } catch (error) {
      console.error('Error classifying comments:', error);
      toast.error('Erro ao classificar comentários');
    }
  };

  // Convert a commenter to a lead (internal function)
  const convertToLead = async (comment: Comment) => {
    if (!comment.author_username) {
      toast.error('Este comentário não tem usuário identificado');
      return;
    }

    setConvertingId(comment.id);

    try {
      // Check if already exists
      const username = comment.author_username.replace('@', '').toLowerCase();
      
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .or(`lead_name.ilike.@${username},notes.ilike.%@${username}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        toast.info('Este usuário já está na sua lista de leads');
        setConvertedUsers(prev => new Set([...prev, username]));
        setConvertingId(null);
        return;
      }

      // Create lead from comment with reference to the original comment
      const { error } = await supabase
        .from('leads')
        .insert({
          lead_name: `@${username}`,
          source: comment.platform,
          status: 'comment',
          instagram_comment_id: comment.id,
          instagram_username: username,
          notes: `Capturado via ${comment.platform} - Comentou: "${comment.comment_text?.slice(0, 100)}..."${comment.post_url ? ` | Post: ${comment.post_url}` : ''}`,
        });

      if (error) throw error;

      toast.success(`@${username} adicionado como lead!`);
      setConvertedUsers(prev => new Set([...prev, username]));
    } catch (error) {
      console.error('Error converting to lead:', error);
      toast.error('Erro ao converter para lead');
    } finally {
      setConvertingId(null);
    }
  };

  // Handle lead confirm dialog response
  const handleLeadConfirmResponse = async (confirmLead: boolean) => {
    if (confirmLead && classifyingComment) {
      await convertToLead(classifyingComment);
    }
    setShowLeadConfirmDialog(false);
    setClassifyingComment(null);
    setPendingClassifications([]);
    setSelectedClassifications([]);
  };

  // Convert all commenters to leads
  const convertAllToLeads = async () => {
    const uniqueUsers = new Map<string, Comment>();
    
    comments
      .filter(c => c.comment_type === 'received' && c.author_username)
      .forEach(c => {
        const username = c.author_username!.replace('@', '').toLowerCase();
        if (!convertedUsers.has(username) && !uniqueUsers.has(username)) {
          uniqueUsers.set(username, c);
        }
      });

    if (uniqueUsers.size === 0) {
      toast.info('Todos os usuários já foram convertidos em leads');
      return;
    }

    setConvertingId('all');

    try {
      let converted = 0;
      let skipped = 0;

      for (const [username, comment] of uniqueUsers) {
        // Check if already exists
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .or(`lead_name.ilike.@${username},notes.ilike.%@${username}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          setConvertedUsers(prev => new Set([...prev, username]));
          continue;
        }

        // Create lead with reference to original comment
        const { error } = await supabase
          .from('leads')
          .insert({
            lead_name: `@${username}`,
            source: comment.platform,
            status: 'comment',
            instagram_comment_id: comment.id,
            instagram_username: username,
            notes: `Capturado via ${comment.platform} - Comentou: "${comment.comment_text?.slice(0, 100)}..."${comment.post_url ? ` | Post: ${comment.post_url}` : ''}`,
          });

        if (!error) {
          converted++;
          setConvertedUsers(prev => new Set([...prev, username]));
        }
      }

      if (converted > 0) {
        toast.success(`${converted} novos leads adicionados!${skipped > 0 ? ` (${skipped} já existiam)` : ''}`);
      } else {
        toast.info('Nenhum novo lead foi adicionado');
      }
    } catch (error) {
      console.error('Error converting all to leads:', error);
      toast.error('Erro ao converter leads');
    } finally {
      setConvertingId(null);
    }
  };

  const handleLogComment = async (type: 'received' | 'sent') => {
    if (!newComment.comment_text.trim()) {
      toast.error('Digite o texto do comentário');
      return;
    }

    try {
      const { error } = await supabase
        .from('instagram_comments')
        .insert({
          comment_type: type,
          platform: newComment.platform,
          post_url: newComment.post_url || null,
          comment_text: newComment.comment_text,
          author_username: newComment.author_username || null,
        });

      if (error) throw error;

      toast.success(`Comentário ${type === 'sent' ? 'enviado' : 'recebido'} registrado!`);
      setIsDialogOpen(false);
      setNewComment({ post_url: '', comment_text: '', author_username: '', platform: 'instagram' });
      fetchComments();
      fetchStats();

      // Update daily stats
      await updateDailyStats(type);
    } catch (error) {
      console.error('Error logging comment:', error);
      toast.error('Erro ao registrar comentário');
    }
  };

  const updateDailyStats = async (type: 'received' | 'sent') => {
    const today = new Date().toISOString().split('T')[0];
    const column = type === 'sent' ? 'comments_sent' : 'comments_received';

    try {
      // Try to update existing record
      const { data: existing } = await supabase
        .from('engagement_daily_stats')
        .select('*')
        .eq('stat_date', today)
        .eq('platform', newComment.platform)
        .single();

      if (existing) {
        await supabase
          .from('engagement_daily_stats')
          .update({ [column]: (existing[column] || 0) + 1 })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('engagement_daily_stats')
          .insert({
            stat_date: today,
            platform: newComment.platform,
            [column]: 1
          });
      }

      // Also update engagement goals
      const { data: goals } = await supabase
        .from('engagement_goals')
        .select('*')
        .eq('is_active', true)
        .eq('goal_type', type === 'sent' ? 'comments_sent' : 'comments_received');

      if (goals) {
        for (const goal of goals) {
          if (goal.platform === 'all' || goal.platform === newComment.platform) {
            await supabase
              .from('engagement_goals')
              .update({ current_value: goal.current_value + 1 })
              .eq('id', goal.id);
          }
        }
      }
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  };

  // Apply all filters
  const filteredComments = useMemo(() => {
    return comments.filter(c => {
      // Filter by tab (received/sent)
      if (c.comment_type !== activeTab) return false;
      
      // Filter by search text
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const matchesText = c.comment_text?.toLowerCase().includes(searchLower);
        const matchesUser = c.author_username?.toLowerCase().includes(searchLower);
        if (!matchesText && !matchesUser) return false;
      }
      
      // Filter by date range
      if (dateFrom || dateTo) {
        const commentDate = new Date(c.created_at);
        if (dateFrom && commentDate < startOfDay(dateFrom)) return false;
        if (dateTo && commentDate > endOfDay(dateTo)) return false;
      }
      
      return true;
    });
  }, [comments, activeTab, searchText, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearchText('');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasActiveFilters = searchText || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500 rounded-lg">
                <Inbox className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-blue-600 dark:text-blue-400">Recebidos Hoje</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats.received}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-500 rounded-lg">
                <Send className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-green-600 dark:text-green-400">Enviados Hoje</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-300">{stats.sent}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-500 rounded-lg">
                <MessageCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-purple-600 dark:text-purple-400">Total Registrados</p>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{comments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 border-orange-200 dark:border-orange-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-orange-500 rounded-lg">
                <Reply className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-orange-600 dark:text-orange-400">Taxa Resposta</p>
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                  {stats.received > 0 ? Math.round((stats.sent / stats.received) * 100) : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comments List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                Histórico de Comentários
              </CardTitle>
              <CardDescription>
                Acompanhe todos os comentários enviados e recebidos
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Instagram Account Selector */}
              <InstagramAccountSelector
                selectedAccounts={selectedAccounts}
                onSelectionChange={setSelectedAccounts}
              />
              
              {/* Last Sync Indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm">
                <CheckCheck className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {formatLastSync(lastSyncTime)}
                </span>
              </div>
              
              {/* Auto-refresh Toggle */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Auto</span>
                <Switch
                  checked={autoRefreshEnabled}
                  onCheckedChange={setAutoRefreshEnabled}
                  disabled={selectedAccounts.length === 0}
                />
                {autoRefreshEnabled && (
                  <select
                    className="h-6 text-xs bg-background border rounded px-1"
                    value={autoRefreshInterval}
                    onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                  >
                    <option value={1}>1 min</option>
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                  </select>
                )}
              </div>
              
              <Button variant="outline" size="sm" onClick={syncFromInstagram} disabled={isSyncing || selectedAccounts.length === 0}>
                {isSyncing ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sincronizar
              </Button>
              {activeTab === 'received' && filteredComments.filter(c => c.author_username && !convertedUsers.has(c.author_username.replace('@', '').toLowerCase())).length > 0 && (
                <Button 
                  size="sm"
                  variant="secondary"
                  onClick={convertAllToLeads}
                  disabled={convertingId === 'all'}
                >
                  {convertingId === 'all' ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Converter Todos em Leads
                </Button>
              )}
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Registrar
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Registrar Comentário</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Plataforma</label>
                        <select
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={newComment.platform}
                          onChange={(e) => setNewComment({ ...newComment, platform: e.target.value })}
                        >
                          <option value="instagram">Instagram</option>
                          <option value="facebook">Facebook</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Usuário</label>
                        <Input
                          placeholder="@username"
                          value={newComment.author_username}
                          onChange={(e) => setNewComment({ ...newComment, author_username: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Link do Post (opcional)</label>
                      <Input
                        placeholder="https://instagram.com/p/..."
                        value={newComment.post_url}
                        onChange={(e) => setNewComment({ ...newComment, post_url: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Texto do Comentário</label>
                      <Textarea
                        placeholder="Digite o comentário..."
                        value={newComment.comment_text}
                        onChange={(e) => setNewComment({ ...newComment, comment_text: e.target.value })}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter className="flex gap-2">
                    <Button variant="outline" onClick={() => handleLogComment('received')}>
                      <Inbox className="h-4 w-4 mr-2" />
                      Recebido
                    </Button>
                    <Button onClick={() => handleLogComment('sent')}>
                      <Send className="h-4 w-4 mr-2" />
                      Enviado
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Evolution Chart */}
          <CommentsEvolutionChart comments={comments} />

          {/* Filters Section */}
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por texto ou usuário..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-2", dateFrom && "border-primary")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateFrom ? format(dateFrom, "dd/MM/yy", { locale: ptBR }) : "De"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-2", dateTo && "border-primary")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateTo ? format(dateTo, "dd/MM/yy", { locale: ptBR }) : "Até"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
                <X className="h-4 w-4" />
                Limpar
              </Button>
            )}
            
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-auto">
                {filteredComments.length} resultado{filteredComments.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* Totalization Summary */}
          <div className="flex items-center justify-between mb-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Total: </span>
                <span className="font-semibold">{filteredComments.length}</span>
                {hasActiveFilters && (
                  <span className="text-muted-foreground"> de {comments.filter(c => c.comment_type === activeTab).length}</span>
                )}
                <span className="text-muted-foreground"> comentário{filteredComments.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            {hasActiveFilters && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                Filtros ativos
              </Badge>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'received' | 'sent')}>
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="received" className="gap-2">
                <Inbox className="h-4 w-4" />
                Recebidos
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {comments.filter(c => c.comment_type === 'received').length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="sent" className="gap-2">
                <Send className="h-4 w-4" />
                Enviados
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {comments.filter(c => c.comment_type === 'sent').length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="py-12 text-center">
                  <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
                </div>
              ) : filteredComments.length === 0 ? (
                <div className="py-12 text-center">
                  <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {hasActiveFilters 
                      ? 'Nenhum comentário encontrado com os filtros aplicados'
                      : `Nenhum comentário ${activeTab === 'received' ? 'recebido' : 'enviado'} registrado`
                    }
                  </p>
                  {hasActiveFilters && (
                    <Button variant="link" onClick={clearFilters} className="mt-2">
                      Limpar filtros
                    </Button>
                  )}
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {filteredComments.map((comment) => {
                      const username = comment.author_username?.replace('@', '').toLowerCase() || '';
                      const isConverted = convertedUsers.has(username);
                      const isConverting = convertingId === comment.id;

                      return (
                        <div
                          key={comment.id}
                          className="p-4 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="secondary" className={
                                  comment.platform === 'instagram' 
                                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' 
                                    : 'bg-blue-500 text-white'
                                }>
                                  {comment.platform}
                                </Badge>
                                {comment.author_username && (
                                  <InstagramProfileHoverCard 
                                    username={comment.author_username}
                                    className="text-sm font-medium"
                                  />
                                )}
                                {isConverted && (
                                  <Badge variant="outline" className="text-green-600 border-green-600">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Lead
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm">{comment.comment_text}</p>
                              {comment.post_url && (
                                <HoverCard openDelay={200} closeDelay={100}>
                                  <HoverCardTrigger asChild>
                                    <a
                                      href={comment.post_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary hover:underline flex items-center gap-1 mt-2 group"
                                    >
                                      <Image className="h-3 w-3" />
                                      Ver post
                                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </a>
                                  </HoverCardTrigger>
                                  <HoverCardContent side="top" className="w-80 p-0 overflow-hidden">
                                    <div className="relative">
                                      <div className="aspect-square w-full bg-muted flex items-center justify-center">
                                        <iframe
                                          src={`${comment.post_url}embed/captioned/`}
                                          className="w-full h-[320px] border-0"
                                          scrolling="no"
                                          allowTransparency={true}
                                          loading="lazy"
                                        />
                                      </div>
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                                        <p className="text-xs text-white truncate">
                                          {comment.post_url}
                                        </p>
                                      </div>
                                    </div>
                                  </HoverCardContent>
                                </HoverCard>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
                              </div>
                              
                              {/* Classification badges */}
                              {comment.prospect_classification && comment.prospect_classification.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {comment.prospect_classification.map(cls => {
                                    const config = CLASSIFICATIONS.find(c => c.key === cls);
                                    return config ? (
                                      <Badge 
                                        key={cls}
                                        variant="outline" 
                                        className={cn("text-xs", config.bgColor, config.color)}
                                      >
                                        {config.label}
                                      </Badge>
                                    ) : null;
                                  })}
                                </div>
                              )}
                              
                              {/* Classification button for received comments */}
                              {activeTab === 'received' && comment.author_username && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => openClassificationDialog(comment)}
                                >
                                  <Tag className="h-3 w-3 mr-1" />
                                  Classificar
                                </Button>
                              )}
                              
                              {/* Already converted indicator */}
                              {isConverted && (
                                <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-600">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Lead
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Classification Dialog */}
      <Dialog open={showClassificationDialog} onOpenChange={setShowClassificationDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              Classificar Usuário
            </DialogTitle>
            <DialogDescription>
              Selecione uma ou mais classificações para <strong className="text-foreground">@{classifyingComment?.author_username?.replace('@', '')}</strong>.
              Será aplicado a todos os comentários deste usuário.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="grid grid-cols-2 gap-2">
              {CLASSIFICATIONS.filter(c => c.key !== null).map((cls) => (
                <Button
                  key={cls.key}
                  variant={selectedClassifications.includes(cls.key!) ? "default" : "outline"}
                  className={cn(
                    "justify-start",
                    selectedClassifications.includes(cls.key!) && cls.bgColor,
                    selectedClassifications.includes(cls.key!) && cls.color
                  )}
                  onClick={() => toggleClassification(cls.key!)}
                >
                  <CheckCircle2 className={cn(
                    "h-4 w-4 mr-2",
                    selectedClassifications.includes(cls.key!) ? "opacity-100" : "opacity-0"
                  )} />
                  {cls.label}
                </Button>
              ))}
            </div>
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setShowClassificationDialog(false);
                setClassifyingComment(null);
                setSelectedClassifications([]);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleApplyClassifications}>
              <Tag className="h-4 w-4 mr-2" />
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lead Confirmation Dialog */}
      <Dialog open={showLeadConfirmDialog} onOpenChange={setShowLeadConfirmDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Converter em Lead?
            </DialogTitle>
            <DialogDescription>
              Você classificou <strong className="text-foreground">@{classifyingComment?.author_username?.replace('@', '')}</strong> como{' '}
              <strong className="text-foreground">
                {pendingClassifications.map(k => CLASSIFICATIONS.find(c => c.key === k)?.label).filter(Boolean).join(', ')}
              </strong>.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Deseja também adicionar este usuário à sua Central de Leads para acompanhamento?
            </p>
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => handleLeadConfirmResponse(false)}
            >
              Não, apenas classificar
            </Button>
            <Button
              onClick={() => handleLeadConfirmResponse(true)}
              disabled={convertingId === classifyingComment?.id}
            >
              {convertingId === classifyingComment?.id ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
              Sim, criar lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
