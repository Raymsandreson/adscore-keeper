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
  CalendarDays,
  X,
  Timer,
  CheckCheck,
  Image,
  Tag,
  Bot,
  Sparkles,
  TrendingUp,
  Target,
  Settings,
  Filter,
  ArrowUpDown,
  Database
} from "lucide-react";
import { AIReplyDialog } from "./AIReplyDialog";
import { CommentClassificationDialog } from "./CommentClassificationDialog";
import { CommentContactBadges } from "./CommentContactBadges";
import { CommentCardBadges } from "./CommentCardBadges";
import { CommentCardSettingsDialog } from "./CommentCardSettingsDialog";
import { QuickLinkLeadPopover } from "./QuickLinkLeadPopover";
import { CommentResponseWorkflow } from "./CommentResponseWorkflow";
import { ClassificationWorkflowSettings } from "./ClassificationWorkflowSettings";
import { NewClassificationDialog } from "./NewClassificationDialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, isWithinInterval, startOfDay, endOfDay, subDays, startOfWeek, startOfMonth, endOfMonth, subMonths, isSameDay, differenceInMinutes, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { CommentsEvolutionChart } from "./CommentsEvolutionChart";
import { InstagramAccountSelector, InstagramAccount } from "./InstagramAccountSelector";
import { InstagramProfileHoverCard } from "./InstagramProfileHoverCard";
import { ReplyStatusBadge } from "./ReplyStatusBadge";

import { useContactClassifications } from "@/hooks/useContactClassifications";
import { useCommentContactInfo } from "@/hooks/useCommentContactInfo";
import { useCommentCardSettings } from "@/hooks/useCommentCardSettings";
import { ProfessionFilter } from "./ProfessionFilter";
import { OutboundCommentDialog } from "./OutboundCommentDialog";
import { ImportCommentsFromExport } from "./ImportCommentsFromExport";
import { ImportApifyJson } from "./ImportApifyJson";
import { CommentTextWithMentions } from "./CommentTextWithMentions";
import { ApifyCommentsFetcher } from "./ApifyCommentsFetcher";
import { MessageSquarePlus, Upload, FileJson } from "lucide-react";
import { PostStatsFilter } from "./PostStatsFilter";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
interface Comment {
  id: string;
  platform: string;
  comment_type: string;
  comment_id: string | null;
  post_id: string | null;
  post_url: string | null;
  comment_text: string | null;
  author_username: string | null;
  author_id: string | null;
  parent_comment_id: string | null;
  replied_at: string | null;
  created_at: string;
  converted_to_lead?: boolean;
  prospect_classification?: string[] | null;
  ad_account_id?: string | null;
  metadata?: Record<string, unknown> | null;
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
  
  // Classification hook
  const { classifications, classificationConfig, addClassification, loading: classificationsLoading } = useContactClassifications();
  
  // Comment contact info hook - get usernames from filtered comments
  const commentUsernames = useMemo(() => {
    return comments
      .filter(c => c.author_username)
      .map(c => c.author_username!)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, [comments]);
  
  const { getContactData, refetch: refetchContactData, refetchUsername } = useCommentContactInfo(commentUsernames);
  
  // Card display settings
  const { config: cardConfig, updateField: updateCardField, resetToDefaults: resetCardSettings } = useCommentCardSettings();
  const [showCardSettings, setShowCardSettings] = useState(false);
  
  // Classification + Lead conversion dialog states
  const [classifyingComment, setClassifyingComment] = useState<Comment | null>(null);
  const [showClassificationDialog, setShowClassificationDialog] = useState(false);
  
  // AI Reply dialog state
  const [showAIReplyDialog, setShowAIReplyDialog] = useState(false);
  const [replyingToComment, setReplyingToComment] = useState<Comment | null>(null);
  
  // External posts URLs for third-party detection
  const [externalPostUrls, setExternalPostUrls] = useState<Set<string>>(new Set());
  
  // Workflow mode state - default to flow mode
  const [showWorkflowMode, setShowWorkflowMode] = useState(true);
  
  // Migration state
  const [isMigratingAuthorIds, setIsMigratingAuthorIds] = useState(false);
  
  // Filter states
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [showOnlyLinked, setShowOnlyLinked] = useState<'all' | 'leads' | 'connections' | 'any'>('all');
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [replyStatusFilter, setReplyStatusFilter] = useState<'all' | 'not_replied' | 'replied_system' | 'replied_manual' | 'replied_any'>('all');
  const [filterByClassifications, setFilterByClassifications] = useState<string[]>([]);
  const [filterByProfessions, setFilterByProfessions] = useState<string[]>([]);
  const [filterByPostUrl, setFilterByPostUrl] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'created_at' | 'classification_updated'>('created_at');
  
  // Classification settings dialogs
  const [showClassificationSettings, setShowClassificationSettings] = useState(false);
  const [showNewClassificationDialog, setShowNewClassificationDialog] = useState(false);
  
  // Auto-refresh states
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(5); // minutes
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
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
    // Load external post URLs for third-party detection
    supabase.from('external_posts').select('url').then(({ data }) => {
      if (data) {
        setExternalPostUrls(new Set(data.map(p => p.url.replace(/\/$/, '').toLowerCase())));
      }
    });
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
      // Cast the data to handle Json type from Supabase
      setComments((data || []).map(c => ({
        ...c,
        metadata: c.metadata as Record<string, unknown> | null
      })) as Comment[]);
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
    let totalMarkedAsReplied = 0;
    let accountsWithErrors = 0;
    
    try {
      for (const account of selectedAccounts) {
        try {
          // Get the access token for this account
          const tokenToUse = account.access_token === 'USE_GLOBAL_TOKEN' 
            ? accessToken 
            : account.access_token;
          
          const { data, error } = await cloudFunctions.invoke('fetch-instagram-comments', {
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
              .select('comment_id, replied_at')
              .not('comment_id', 'is', null);
            
            const existingIds = new Set((existingComments || []).map(c => c.comment_id));
            const existingNotReplied = new Map((existingComments || [])
              .filter(c => !c.replied_at)
              .map(c => [c.comment_id, true]));
            
            // Filter new comments
            const newComments = data.comments.filter((c: any) => !existingIds.has(c.comment_id));
            
            if (newComments.length > 0) {
              // Insert new comments with account reference
              // Also check if they were manually replied (has was_manually_replied flag)
              const commentsToInsert = newComments.map((comment: any) => ({
                comment_id: comment.comment_id,
                comment_text: comment.comment_text,
                author_username: comment.author_username,
                author_id: comment.author_id || null,
                created_at: comment.created_at,
                post_id: comment.post_id,
                post_url: comment.post_url,
                comment_type: comment.comment_type,
                parent_comment_id: comment.parent_comment_id || null,
                platform: 'instagram',
                ad_account_id: account.instagram_id, // Track which account this came from
                metadata: { account_name: account.account_name, ...comment.metadata },
                // If it was manually replied on Instagram, mark as replied
                replied_at: comment.was_manually_replied ? comment.manual_reply_at : null
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

          // Process manual replies - update existing comments that were replied manually on Instagram
          if (data.manualReplies && data.manualReplies.length > 0) {
            console.log(`🔄 Processando ${data.manualReplies.length} respostas manuais detectadas...`);
            
            for (const manualReply of data.manualReplies) {
              // Find the comment in database that matches and is not yet marked as replied
              const { data: existingComment } = await supabase
                .from('instagram_comments')
                .select('id, replied_at')
                .eq('comment_id', manualReply.comment_id)
                .is('replied_at', null)
                .maybeSingle();
              
              if (existingComment) {
                // Mark as replied with the manual reply timestamp
                const { error: updateError } = await supabase
                  .from('instagram_comments')
                  .update({ 
                    replied_at: manualReply.replied_at,
                    metadata: {
                      manual_reply: true,
                      manual_reply_text: manualReply.reply_text?.slice(0, 200)
                    }
                  })
                  .eq('id', existingComment.id);
                
                if (!updateError) {
                  totalMarkedAsReplied++;
                }
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

      if (totalSaved > 0 || totalMarkedAsReplied > 0) {
        let message = '';
        if (totalSaved > 0) {
          message += `${totalSaved} comentários sincronizados`;
        }
        if (totalMarkedAsReplied > 0) {
          message += message ? `, ${totalMarkedAsReplied} marcados como respondidos` : `${totalMarkedAsReplied} comentários marcados como respondidos`;
        }
        toast.success(message);
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

  // Migrate author_ids for existing comments that don't have them
  const migrateAuthorIds = useCallback(async () => {
    if (isMigratingAuthorIds || selectedAccounts.length === 0) return;
    
    setIsMigratingAuthorIds(true);
    let totalUpdated = 0;
    
    try {
      // Get comments without author_id
      const { data: commentsWithoutId, error: fetchError } = await supabase
        .from('instagram_comments')
        .select('id, comment_id, author_username')
        .is('author_id', null)
        .not('comment_id', 'is', null);
      
      if (fetchError) throw fetchError;
      
      if (!commentsWithoutId || commentsWithoutId.length === 0) {
        toast.info('Todos os comentários já possuem author_id');
        setIsMigratingAuthorIds(false);
        return;
      }
      
      toast.info(`Atualizando ${commentsWithoutId.length} comentários...`);
      
      // Fetch fresh data from Instagram for each account
      for (const account of selectedAccounts) {
        try {
          const tokenToUse = account.access_token === 'USE_GLOBAL_TOKEN' 
            ? accessToken 
            : account.access_token;
          
          const { data, error } = await cloudFunctions.invoke('fetch-instagram-comments', {
            body: { 
              accessToken: tokenToUse, 
              instagramAccountId: account.instagram_id 
            }
          });

          if (error || !data.success) continue;
          
          // Create a map of comment_id to author_id from fresh data
          const authorIdMap = new Map<string, string>();
          for (const comment of (data.comments || [])) {
            if (comment.comment_id && comment.author_id) {
              authorIdMap.set(comment.comment_id, comment.author_id);
            }
          }
          
          // Update comments in database
          for (const dbComment of commentsWithoutId) {
            if (dbComment.comment_id && authorIdMap.has(dbComment.comment_id)) {
              const { error: updateError } = await supabase
                .from('instagram_comments')
                .update({ author_id: authorIdMap.get(dbComment.comment_id) })
                .eq('id', dbComment.id);
              
              if (!updateError) {
                totalUpdated++;
              }
            }
          }
        } catch (accountError) {
          console.error(`Error migrating for account:`, accountError);
        }
      }
      
      if (totalUpdated > 0) {
        toast.success(`${totalUpdated} comentários atualizados com author_id!`);
        await fetchComments();
      } else {
        toast.info('Nenhum author_id encontrado na API para os comentários existentes');
      }
    } catch (error) {
      console.error('Error migrating author_ids:', error);
      toast.error('Erro ao migrar author_ids');
    } finally {
      setIsMigratingAuthorIds(false);
    }
  }, [accessToken, selectedAccounts, isMigratingAuthorIds]);

  // Detect which quick period is currently active
  const activePeriod = useMemo(() => {
    if (!dateFrom || !dateTo) return null;
    
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    
    // Today
    if (isSameDay(dateFrom, todayStart) && isSameDay(dateTo, todayEnd)) {
      return 'today';
    }
    
    // Last 7 days
    if (isSameDay(dateFrom, startOfDay(subDays(today, 6))) && isSameDay(dateTo, todayEnd)) {
      return 'last7';
    }
    
    // Last 15 days
    if (isSameDay(dateFrom, startOfDay(subDays(today, 14))) && isSameDay(dateTo, todayEnd)) {
      return 'last15';
    }
    
    // This month
    if (isSameDay(dateFrom, startOfMonth(today)) && isSameDay(dateTo, todayEnd)) {
      return 'thisMonth';
    }
    
    // Last month
    const lastMonth = subMonths(today, 1);
    if (isSameDay(dateFrom, startOfMonth(lastMonth)) && isSameDay(dateTo, endOfMonth(lastMonth))) {
      return 'lastMonth';
    }
    
    // Last 30 days
    if (isSameDay(dateFrom, startOfDay(subDays(today, 29))) && isSameDay(dateTo, todayEnd)) {
      return 'last30';
    }
    
    return 'custom';
  }, [dateFrom, dateTo]);

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
    setShowClassificationDialog(true);
  };

  // Handle classification applied from dialog
  const handleClassificationsApplied = (newClassifications: string[] | null) => {
    if (classifyingComment) {
      const username = classifyingComment.author_username?.replace('@', '').toLowerCase();
      
      // Update local state for all comments from this author
      if (username) {
        setComments(prev => 
          prev.map(c => {
            const commentUsername = c.author_username?.replace('@', '').toLowerCase();
            if (commentUsername === username) {
              return { ...c, prospect_classification: newClassifications };
            }
            return c;
          })
        );
      } else {
        setComments(prev => 
          prev.map(c => c.id === classifyingComment.id ? { ...c, prospect_classification: newClassifications } : c)
        );
      }
    }
    setClassifyingComment(null);
  };

  // Handle lead linked from dialog
  const handleLeadLinked = () => {
    checkExistingLeads();
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

  // Apply all filters and sorting
  const filteredComments = useMemo(() => {
    // Get the instagram_ids from selected accounts for filtering
    const selectedAccountIds = new Set(selectedAccounts.map(a => a.instagram_id));
    
    const filtered = comments.filter(c => {
      // Filter by tab (received/sent/outbound)
      if (activeTab === 'outbound_manual') {
        // Show all outbound types
        if (!['outbound_manual', 'outbound_export', 'outbound_n8n'].includes(c.comment_type)) return false;
      } else if (c.comment_type !== activeTab) return false;
      
      // Filter by selected accounts - only show comments from selected accounts
      // If ad_account_id is set, it must match one of the selected account's instagram_id
      // Comments without ad_account_id (imported from third-party posts) should NOT appear
      // when a specific account is selected - they only appear when no filter is applied
      if (selectedAccountIds.size > 0) {
        // Strictly filter: comment must have ad_account_id AND it must match selected accounts
        if (!c.ad_account_id || !selectedAccountIds.has(c.ad_account_id)) return false;
      }
      
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
      
      // Filter by linked leads/connections
      if (showOnlyLinked !== 'all') {
        const contactData = c.author_username ? getContactData(c.author_username) : null;
        if (!contactData) return false;
        
        const hasLeads = contactData.linkedLeads.length > 0;
        const hasConnections = contactData.relationships.length > 0;
        
        if (showOnlyLinked === 'leads' && !hasLeads) return false;
        if (showOnlyLinked === 'connections' && !hasConnections) return false;
        if (showOnlyLinked === 'any' && !hasLeads && !hasConnections) return false;
      }
      
      // Filter by reply status
      if (replyStatusFilter !== 'all') {
        const isReplied = c.replied_at !== null;
        const isManualReply = c.metadata && typeof c.metadata === 'object' && 'manual_reply' in c.metadata && c.metadata.manual_reply === true;
        
        if (replyStatusFilter === 'not_replied' && isReplied) return false;
        if (replyStatusFilter === 'replied_any' && !isReplied) return false;
        if (replyStatusFilter === 'replied_system' && (!isReplied || isManualReply)) return false;
        if (replyStatusFilter === 'replied_manual' && (!isReplied || !isManualReply)) return false;
      }
      
      // Filter by classifications (multi-select)
      if (filterByClassifications.length > 0) {
        const contactData = c.author_username ? getContactData(c.author_username) : null;
        const contactClassifications = contactData?.contact?.classifications || [];
        
        const hasNoClassification = filterByClassifications.includes('__none__');
        const selectedClassifications = filterByClassifications.filter(f => f !== '__none__');
        
        // Check if contact matches any selected classification
        const matchesSelectedClassification = selectedClassifications.some(cls => 
          contactClassifications.includes(cls)
        );
        
        // Check if should show unclassified
        const matchesNoClassification = hasNoClassification && contactClassifications.length === 0;
        
        if (!matchesSelectedClassification && !matchesNoClassification) return false;
      }
      
      // Filter by professions (multi-select)
      if (filterByProfessions.length > 0) {
        const contactData = c.author_username ? getContactData(c.author_username) : null;
        const contactProfession = contactData?.contact?.profession;
        
        if (!contactProfession || !filterByProfessions.includes(contactProfession)) return false;
      }
      
      // Filter by post URL
      if (filterByPostUrl) {
        if (!c.post_url) return false;
        const normalizeUrl = (url: string) => {
          try {
            const parsed = new URL(url);
            let path = parsed.pathname.replace(/\/$/, '');
            path = path.replace(/\/reels\//i, '/reel/');
            return `${parsed.origin}${path}`;
          } catch { return url.replace(/\?.*$/, '').replace(/\/$/, ''); }
        };
        if (normalizeUrl(c.post_url) !== normalizeUrl(filterByPostUrl)) return false;
      }
      
      return true;
    });

    // Apply sorting
    if (sortBy === 'classification_updated') {
      return filtered.sort((a, b) => {
        const contactDataA = a.author_username ? getContactData(a.author_username) : null;
        const contactDataB = b.author_username ? getContactData(b.author_username) : null;
        
        const updatedAtA = contactDataA?.contact?.updated_at ? new Date(contactDataA.contact.updated_at).getTime() : 0;
        const updatedAtB = contactDataB?.contact?.updated_at ? new Date(contactDataB.contact.updated_at).getTime() : 0;
        
        return updatedAtB - updatedAtA;
      });
    }
    
    return filtered;
  }, [comments, activeTab, searchText, dateFrom, dateTo, showOnlyLinked, replyStatusFilter, filterByClassifications, filterByProfessions, filterByPostUrl, getContactData, sortBy, selectedAccounts]);

  const clearFilters = () => {
    setSearchText('');
    setDateFrom(undefined);
    setDateTo(undefined);
    setShowOnlyLinked('all');
    setReplyStatusFilter('all');
    setFilterByClassifications([]);
    setFilterByProfessions([]);
    setFilterByPostUrl(null);
    setSortBy('created_at');
  };

  const hasActiveFilters = searchText || dateFrom || dateTo || showOnlyLinked !== 'all' || replyStatusFilter !== 'all' || filterByClassifications.length > 0 || filterByProfessions.length > 0 || filterByPostUrl || sortBy !== 'created_at';
  
  // Toggle classification in filter
  const toggleClassificationFilter = (classificationName: string) => {
    setFilterByClassifications(prev => {
      if (prev.includes(classificationName)) {
        return prev.filter(c => c !== classificationName);
      } else {
        return [...prev, classificationName];
      }
    });
  };
  
  // Count comments by reply status for stats
  const replyStats = useMemo(() => {
    let notReplied = 0;
    let repliedSystem = 0;
    let repliedManual = 0;
    
    comments.forEach(c => {
      if (c.comment_type !== 'received') return;
      
      // Apply date filters
      if (dateFrom || dateTo) {
        const commentDate = new Date(c.created_at);
        if (dateFrom && commentDate < startOfDay(dateFrom)) return;
        if (dateTo && commentDate > endOfDay(dateTo)) return;
      }
      
      if (!c.replied_at) {
        notReplied++;
      } else {
        const isManual = c.metadata && typeof c.metadata === 'object' && 'manual_reply' in c.metadata && c.metadata.manual_reply === true;
        if (isManual) {
          repliedManual++;
        } else {
          repliedSystem++;
        }
      }
    });
    
    return { notReplied, repliedSystem, repliedManual, repliedTotal: repliedSystem + repliedManual };
  }, [comments, dateFrom, dateTo]);
  
  // Count comments per tab respecting date filters
  const receivedCount = useMemo(() => {
    return comments.filter(c => {
      if (c.comment_type !== 'received') return false;
      
      if (dateFrom || dateTo) {
        const commentDate = new Date(c.created_at);
        if (dateFrom && commentDate < startOfDay(dateFrom)) return false;
        if (dateTo && commentDate > endOfDay(dateTo)) return false;
      }
      
      return true;
    }).length;
  }, [comments, dateFrom, dateTo]);
  
  const sentCount = useMemo(() => {
    return comments.filter(c => {
      if (c.comment_type !== 'sent') return false;
      
      if (dateFrom || dateTo) {
        const commentDate = new Date(c.created_at);
        if (dateFrom && commentDate < startOfDay(dateFrom)) return false;
        if (dateTo && commentDate > endOfDay(dateTo)) return false;
      }
      
      return true;
    }).length;
  }, [comments, dateFrom, dateTo]);

  const outboundCount = useMemo(() => {
    return comments.filter(c => {
      if (!['outbound_manual', 'outbound_export', 'outbound_n8n'].includes(c.comment_type)) return false;
      
      if (dateFrom || dateTo) {
        const commentDate = new Date(c.created_at);
        if (dateFrom && commentDate < startOfDay(dateFrom)) return false;
        if (dateTo && commentDate > endOfDay(dateTo)) return false;
      }
      
      return true;
    }).length;
  }, [comments, dateFrom, dateTo]);

  // Workflow Performance Stats
  const workflowStats = useMemo(() => {
    const receivedComments = comments.filter(c => c.comment_type === 'received');
    const repliedComments = receivedComments.filter(c => (c as any).replied_at);
    
    // Calculate average response time
    let totalResponseTimeMinutes = 0;
    let repliedWithTimeCount = 0;
    
    repliedComments.forEach(comment => {
      const createdAt = new Date(comment.created_at);
      const repliedAt = new Date((comment as any).replied_at);
      const diffMinutes = differenceInMinutes(repliedAt, createdAt);
      if (diffMinutes >= 0) {
        totalResponseTimeMinutes += diffMinutes;
        repliedWithTimeCount++;
      }
    });
    
    const avgResponseTimeMinutes = repliedWithTimeCount > 0 
      ? Math.round(totalResponseTimeMinutes / repliedWithTimeCount) 
      : 0;
    
    // Format average response time
    let avgResponseTimeFormatted = '—';
    if (avgResponseTimeMinutes > 0) {
      if (avgResponseTimeMinutes < 60) {
        avgResponseTimeFormatted = `${avgResponseTimeMinutes} min`;
      } else if (avgResponseTimeMinutes < 1440) {
        const hours = Math.floor(avgResponseTimeMinutes / 60);
        const mins = avgResponseTimeMinutes % 60;
        avgResponseTimeFormatted = mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
      } else {
        const days = Math.floor(avgResponseTimeMinutes / 1440);
        avgResponseTimeFormatted = `${days} dia${days > 1 ? 's' : ''}`;
      }
    }
    
    // Calculate lead conversion rate
    const commentsWithLeadLinked = receivedComments.filter(c => {
      if (!c.author_username) return false;
      const username = c.author_username.replace('@', '').toLowerCase();
      return convertedUsers.has(username);
    });
    
    const leadConversionRate = receivedComments.length > 0 
      ? Math.round((commentsWithLeadLinked.length / receivedComments.length) * 100) 
      : 0;
    
    // Response rate
    const responseRate = receivedComments.length > 0 
      ? Math.round((repliedComments.length / receivedComments.length) * 100) 
      : 0;
    
    return {
      avgResponseTime: avgResponseTimeFormatted,
      avgResponseTimeMinutes,
      leadConversionRate,
      leadsConverted: commentsWithLeadLinked.length,
      totalReceived: receivedComments.length,
      responseRate,
      repliedCount: repliedComments.length
    };
  }, [comments, convertedUsers]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
                  {workflowStats.responseRate}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* New: Average Response Time Card */}
        <Card className="bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950 dark:to-cyan-900 border-cyan-200 dark:border-cyan-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-cyan-500 rounded-lg">
                <Clock className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-cyan-600 dark:text-cyan-400">Tempo Médio</p>
                <p className="text-xl font-bold text-cyan-700 dark:text-cyan-300">
                  {workflowStats.avgResponseTime}
                </p>
                <p className="text-xs text-cyan-500 dark:text-cyan-500">
                  {workflowStats.repliedCount} respondidos
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* New: Lead Conversion Rate Card */}
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900 border-emerald-200 dark:border-emerald-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500 rounded-lg">
                <Target className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-emerald-600 dark:text-emerald-400">Conversão Leads</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                  {workflowStats.leadConversionRate}%
                </p>
                <p className="text-xs text-emerald-500 dark:text-emerald-500">
                  {workflowStats.leadsConverted}/{workflowStats.totalReceived}
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
              
              {/* Card Display Settings Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCardSettings(true)}
                className="gap-2"
              >
                <Settings className="h-4 w-4" />
                Cards
              </Button>
              
              {/* Classification Settings Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowClassificationSettings(true)}
                className="gap-2"
              >
                <Tag className="h-4 w-4" />
                Classificações
              </Button>
              
              {/* Migrate Author IDs Button - only show if there are comments without author_id */}
              {comments.some(c => !c.author_id && c.comment_id) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={migrateAuthorIds}
                  disabled={isMigratingAuthorIds || selectedAccounts.length === 0}
                  className="gap-2"
                  title="Atualizar IDs de autor para comentários antigos (necessário para links de DM direto)"
                >
                  {isMigratingAuthorIds ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4" />
                  )}
                  Atualizar IDs
                </Button>
              )}
              
              {/* Workflow Mode Button */}
              {(() => {
                // Get list of classifications that should NOT appear in workflow
                const hiddenClassifications = classifications
                  .filter(c => !c.show_in_workflow)
                  .map(c => c.name);
                
                const unrepliedCount = comments.filter(c => {
                  if (c.comment_type !== 'received') return false;
                  if (!(c as any).comment_id) return false;
                  if ((c as any).replied_at) return false;
                  
                  // Check if contact has a hidden classification
                  const contactData = c.author_username ? getContactData(c.author_username) : null;
                  const contactClassifications = contactData?.contact?.classifications || [];
                  const hasHiddenClassification = contactClassifications.some(
                    (cls: string) => hiddenClassifications.includes(cls)
                  );
                  
                  return !hasHiddenClassification;
                }).length;
                
                return unrepliedCount > 0 ? (
                  <Button 
                    size="sm"
                    className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white gap-2"
                    onClick={() => setShowWorkflowMode(true)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Modo Fluxo ({unrepliedCount})
                  </Button>
                ) : null;
              })()}
              
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
              
              {/* Import from Export Dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <FileJson className="h-4 w-4 text-primary" />
                    Importar JSON
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <ImportCommentsFromExport 
                    ownAccountUsernames={selectedAccounts.map(a => a.account_name)}
                    onImportComplete={() => {
                      fetchComments();
                      toast.success('Importação concluída!');
                    }}
                  />
                </DialogContent>
              </Dialog>
              
              {/* Import from Apify JSON */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Upload className="h-4 w-4 text-primary" />
                    Importar Apify JSON
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <ImportApifyJson 
                    onImportComplete={() => {
                      fetchComments();
                      toast.success('Importação do Apify concluída!');
                    }}
                  />
                </DialogContent>
              </Dialog>
              
              {/* Outbound Comment Registration Button */}
              <OutboundCommentDialog
                accounts={selectedAccounts}
                onSuccess={() => {
                  fetchComments();
                  fetchStats();
                }}
              />
              
              {/* Apify Fetcher for External Posts */}
              <ApifyCommentsFetcher
                myUsername={selectedAccounts[0]?.account_name}
                onSuccess={() => {
                  fetchComments();
                  fetchStats();
                }}
              />
              
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

          {/* Post Stats Filter */}
          <PostStatsFilter
            selectedPost={filterByPostUrl}
            onSelectPost={setFilterByPostUrl}
          />

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

            {/* Linked filter */}
            <Select value={showOnlyLinked} onValueChange={(val: 'all' | 'leads' | 'connections' | 'any') => setShowOnlyLinked(val)}>
              <SelectTrigger className={cn("w-[160px] h-9", showOnlyLinked !== 'all' && "border-primary")}>
                <SelectValue placeholder="Filtrar vínculos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="any">Com vínculos</SelectItem>
                <SelectItem value="leads">Com leads</SelectItem>
                <SelectItem value="connections">Com conexões</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Classification filter - multi-select */}
            <Popover modal={true}>
              <PopoverTrigger asChild>
                <button type="button" style={{ pointerEvents: "auto" }} className="inline-flex">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className={cn("gap-2 h-9", filterByClassifications.length > 0 && "border-primary")}
                    asChild
                  >
                    <span>
                      <Tag className="h-3.5 w-3.5" />
                      {filterByClassifications.length === 0 ? (
                        "Classificação"
                      ) : filterByClassifications.length === 1 ? (
                        filterByClassifications[0] === '__none__' ? 'Sem classificação' : 
                        classificationConfig[filterByClassifications[0]]?.label || filterByClassifications[0]
                      ) : (
                        `${filterByClassifications.length} selecionadas`
                      )}
                    </span>
                  </Button>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start">
                <div className="space-y-1">
                  <div
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted transition-colors",
                      filterByClassifications.includes('__none__') && "bg-primary/10"
                    )}
                    onClick={() => toggleClassificationFilter('__none__')}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center",
                      filterByClassifications.includes('__none__') ? "bg-primary border-primary" : "border-muted-foreground/30"
                    )}>
                      {filterByClassifications.includes('__none__') && (
                        <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground italic">Sem classificação</span>
                  </div>
                  
                  {classifications.map((classification) => {
                    const label = classificationConfig[classification.name]?.label || classification.name;
                    const isSelected = filterByClassifications.includes(classification.name);
                    return (
                      <div
                        key={classification.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted transition-colors",
                          isSelected && "bg-primary/10"
                        )}
                        onClick={() => toggleClassificationFilter(classification.name)}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center",
                          isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                        )}>
                          {isSelected && (
                            <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                        <div className={`w-2.5 h-2.5 rounded-full ${classification.color}`} />
                        <span className="text-sm">{label}</span>
                      </div>
                    );
                  })}
                  
                  {filterByClassifications.length > 0 && (
                    <div className="pt-2 border-t mt-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="w-full text-xs"
                        onClick={() => setFilterByClassifications([])}
                      >
                        Limpar seleção
                      </Button>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            
            {/* Profession filter */}
            <ProfessionFilter
              selectedProfessions={filterByProfessions}
              onSelectionChange={setFilterByProfessions}
            />
            
            {/* Sort selector */}
            <Select value={sortBy} onValueChange={(val: 'created_at' | 'classification_updated') => setSortBy(val)}>
              <SelectTrigger className={cn("w-[180px] h-9", sortBy !== 'created_at' && "border-primary")}>
                <ArrowUpDown className="h-3.5 w-3.5 mr-2" />
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at">Mais recentes</SelectItem>
                <SelectItem value="classification_updated">Classificação atualizada</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Reply Status filter - enhanced dropdown */}
            {activeTab === 'received' && (
              <Select value={replyStatusFilter} onValueChange={(val: 'all' | 'not_replied' | 'replied_system' | 'replied_manual' | 'replied_any') => setReplyStatusFilter(val)}>
                <SelectTrigger className={cn("w-[180px] h-9", replyStatusFilter !== 'all' && "border-primary")}>
                  <Reply className="h-3.5 w-3.5 mr-2" />
                  <SelectValue placeholder="Status resposta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="not_replied">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      Não respondidos
                    </span>
                  </SelectItem>
                  <SelectItem value="replied_any">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      Respondidos (todos)
                    </span>
                  </SelectItem>
                  <SelectItem value="replied_system">
                    <span className="flex items-center gap-2">
                      <Bot className="h-3 w-3 text-green-500" />
                      Respondidos (Sistema)
                    </span>
                  </SelectItem>
                  <SelectItem value="replied_manual">
                    <span className="flex items-center gap-2">
                      <MessageCircle className="h-3 w-3 text-blue-500" />
                      Respondidos (Instagram)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

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

          {/* Period Shortcuts and Active Period Indicator */}
          <div className="flex flex-col gap-2 mb-4">
            {/* Quick period shortcuts */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Período rápido:</span>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant={activePeriod === 'today' ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    setDateFrom(startOfDay(today));
                    setDateTo(endOfDay(today));
                  }}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    activePeriod === 'today' && "bg-primary text-primary-foreground"
                  )}
                >
                  Hoje
                </Button>
                <Button
                  variant={activePeriod === 'last7' ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    setDateFrom(startOfDay(subDays(today, 6)));
                    setDateTo(endOfDay(today));
                  }}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    activePeriod === 'last7' && "bg-primary text-primary-foreground"
                  )}
                >
                  Últimos 7 dias
                </Button>
                <Button
                  variant={activePeriod === 'last15' ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    setDateFrom(startOfDay(subDays(today, 14)));
                    setDateTo(endOfDay(today));
                  }}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    activePeriod === 'last15' && "bg-primary text-primary-foreground"
                  )}
                >
                  Últimos 15 dias
                </Button>
                <Button
                  variant={activePeriod === 'thisMonth' ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    setDateFrom(startOfMonth(today));
                    setDateTo(endOfDay(today));
                  }}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    activePeriod === 'thisMonth' && "bg-primary text-primary-foreground"
                  )}
                >
                  Este mês
                </Button>
                <Button
                  variant={activePeriod === 'lastMonth' ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    const lastMonth = subMonths(today, 1);
                    setDateFrom(startOfMonth(lastMonth));
                    setDateTo(endOfMonth(lastMonth));
                  }}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    activePeriod === 'lastMonth' && "bg-primary text-primary-foreground"
                  )}
                >
                  Mês passado
                </Button>
                <Button
                  variant={activePeriod === 'last30' ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    setDateFrom(startOfDay(subDays(today, 29)));
                    setDateTo(endOfDay(today));
                  }}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    activePeriod === 'last30' && "bg-primary text-primary-foreground"
                  )}
                >
                  Últimos 30 dias
                </Button>
              </div>
            </div>

            {/* Active date period indicator */}
            {(dateFrom || dateTo) && (
              <div className="flex items-center gap-2 p-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50 border border-blue-200 dark:border-blue-800 rounded-lg">
                <CalendarDays className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Período: {' '}
                  {dateFrom && dateTo ? (
                    <>
                      {format(dateFrom, "dd/MM/yyyy")} até {format(dateTo, "dd/MM/yyyy")}
                    </>
                  ) : dateFrom ? (
                    <>A partir de {format(dateFrom, "dd/MM/yyyy")}</>
                  ) : dateTo ? (
                    <>Até {format(dateTo, "dd/MM/yyyy")}</>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
                  className="ml-auto h-6 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 dark:text-blue-400 dark:hover:text-blue-200 dark:hover:bg-blue-900"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            
            {/* Stats summary with reply status breakdown */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold">{filteredComments.length}</span>
                  {hasActiveFilters && (
                    <span className="text-muted-foreground"> de {comments.filter(c => c.comment_type === activeTab).length}</span>
                  )}
                  <span className="text-muted-foreground"> comentário{filteredComments.length !== 1 ? 's' : ''}</span>
                </div>
                
                {/* Reply status breakdown - only for received tab */}
                {activeTab === 'received' && (
                  <div className="flex items-center gap-2 pl-3 border-l border-border">
                    <Badge 
                      variant="outline" 
                      className="bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 gap-1 cursor-pointer hover:bg-orange-200"
                      onClick={() => setReplyStatusFilter('not_replied')}
                    >
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      {replyStats.notReplied} pendente{replyStats.notReplied !== 1 ? 's' : ''}
                    </Badge>
                    <Badge 
                      variant="outline" 
                      className="bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300 gap-1 cursor-pointer hover:bg-green-200"
                      onClick={() => setReplyStatusFilter('replied_system')}
                    >
                      <Bot className="h-3 w-3" />
                      {replyStats.repliedSystem} sistema
                    </Badge>
                    <Badge 
                      variant="outline" 
                      className="bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300 gap-1 cursor-pointer hover:bg-blue-200"
                      onClick={() => setReplyStatusFilter('replied_manual')}
                    >
                      <MessageCircle className="h-3 w-3" />
                      {replyStats.repliedManual} manual
                    </Badge>
                  </div>
                )}
              </div>
              {hasActiveFilters && (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                  Filtros ativos
                </Badge>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'received' | 'sent' | 'outbound_manual')}>
            <TabsList className="grid w-full grid-cols-3 max-w-md">
              <TabsTrigger value="received" className="gap-2">
                <Inbox className="h-4 w-4" />
                Recebidos
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {receivedCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="sent" className="gap-2">
                <Send className="h-4 w-4" />
                Enviados
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {sentCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="outbound_manual" className="gap-2">
                <MessageSquarePlus className="h-4 w-4" />
                Outbound
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {outboundCount}
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
                      : `Nenhum comentário ${activeTab === 'received' ? 'recebido' : activeTab === 'sent' ? 'enviado' : 'outbound'} registrado`
                    }
                  </p>
                  {hasActiveFilters && (
                    <Button variant="link" onClick={clearFilters} className="mt-2">
                      Limpar filtros
                    </Button>
                  )}
                  {activeTab === 'outbound_manual' && !hasActiveFilters && (
                    <div className="mt-6 max-w-2xl mx-auto text-left">
                      <ImportCommentsFromExport 
                        ownAccountUsernames={selectedAccounts.map(a => a.account_name)}
                        onImportComplete={() => {
                          fetchComments();
                        }}
                      />
                    </div>
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
                              </div>
                              
                              {/* Unified contact context badges with settings - interactive */}
                              <div className="mb-2">
                                <CommentCardBadges 
                                  contactData={getContactData(comment.author_username)}
                                  config={cardConfig}
                                  compact={false}
                                  interactive={true}
                                  authorUsername={comment.author_username}
                                  commentText={comment.comment_text}
                                  onDataChanged={() => refetchUsername(comment.author_username)}
                                />
                              </div>
                              <CommentTextWithMentions text={comment.comment_text} className="text-sm" />
                              {comment.post_url && (
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
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(new Date(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
                              </div>
                              
                              {/* Reply status badge - shows if replied and how */}
                              <ReplyStatusBadge 
                                repliedAt={comment.replied_at}
                                metadata={comment.metadata as { manual_reply?: boolean; manual_reply_text?: string } | null}
                              />
                              
                              {/* Classification badges - read from centralized contacts table */}
                              {(() => {
                                const contactData = getContactData(comment.author_username);
                                const contactClassifications = contactData?.contact?.classifications || [];
                                if (contactClassifications.length === 0) return null;
                                
                                return (
                                  <div className="flex flex-wrap gap-1">
                                    {contactClassifications.map((cls: string) => {
                                      const config = classificationConfig[cls];
                                      
                                      // Check if this classification matches a relationship type
                                      const matchingRelationship = contactData.relationships.find(
                                        rel => rel.relationship_type.toLowerCase() === cls.toLowerCase()
                                      );
                                      
                                      const displayLabel = matchingRelationship 
                                        ? `${cls.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} de ${matchingRelationship.related_contact.full_name.split(' ')[0]}`
                                        : config?.label || cls.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                      
                                      return config ? (
                                        <Badge 
                                          key={cls}
                                          variant="outline" 
                                          className={cn("text-xs", config.color, "text-white")}
                                        >
                                          {displayLabel}
                                        </Badge>
                                      ) : (
                                        <Badge key={cls} variant="outline" className="text-xs bg-purple-500 text-white">
                                          {displayLabel}
                                        </Badge>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              
                              {/* AI Reply button for received comments */}
                              {activeTab === 'received' && (comment as any).comment_id && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-300 hover:border-purple-400"
                                  onClick={() => {
                                    setReplyingToComment(comment);
                                    setShowAIReplyDialog(true);
                                  }}
                                >
                                  <Bot className="h-3 w-3 mr-1 text-purple-500" />
                                  <Sparkles className="h-3 w-3 mr-1 text-pink-500" />
                                  Responder IA
                                </Button>
                              )}
                              
                              {/* Quick link lead button */}
                              {activeTab === 'received' && comment.author_username && (
                                <QuickLinkLeadPopover 
                                  authorUsername={comment.author_username}
                                  onLeadLinked={refetchContactData}
                                />
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
      <CommentClassificationDialog
        open={showClassificationDialog}
        onOpenChange={setShowClassificationDialog}
        comment={classifyingComment}
        onClassificationsApplied={handleClassificationsApplied}
        onLeadLinked={handleLeadLinked}
      />

      {/* AI Reply Dialog */}
      <AIReplyDialog
        open={showAIReplyDialog}
        onOpenChange={setShowAIReplyDialog}
        comment={replyingToComment}
        accessToken={accessToken}
        isThirdPartyPost={
          replyingToComment?.post_url
            ? externalPostUrls.has(replyingToComment.post_url.replace(/\/$/, '').toLowerCase())
            : false
        }
        onReplyPosted={() => {
          syncFromInstagram();
        }}
      />

      {/* Comment Response Workflow */}
      <CommentResponseWorkflow
        open={showWorkflowMode}
        onOpenChange={setShowWorkflowMode}
        comments={(() => {
          // Filter out comments with hidden classifications
          const hiddenClassifications = classifications
            .filter(c => !c.show_in_workflow)
            .map(c => c.name);
          
          return comments.filter(c => {
            if (c.comment_type !== 'received') return false;
            
            const contactData = c.author_username ? getContactData(c.author_username) : null;
            const contactClassifications = contactData?.contact?.classifications || [];
            const hasHiddenClassification = contactClassifications.some(
              (cls: string) => hiddenClassifications.includes(cls)
            );
            
            return !hasHiddenClassification;
          }) as any;
        })()}
        accessToken={accessToken}
        onCommentReplied={(commentId) => {
          // Refresh comments after reply
          fetchComments();
        }}
        onLeadCreated={(username) => {
          setConvertedUsers(prev => new Set([...prev, username]));
          checkExistingLeads();
        }}
        onRefresh={() => {
          fetchComments();
          fetchStats();
          refetchContactData();
        }}
      />

      {/* Classification Workflow Settings */}
      <ClassificationWorkflowSettings
        open={showClassificationSettings}
        onOpenChange={setShowClassificationSettings}
      />

      {/* New Classification Dialog */}
      <NewClassificationDialog
        open={showNewClassificationDialog}
        onOpenChange={setShowNewClassificationDialog}
        onConfirm={addClassification}
        loading={classificationsLoading}
      />

      {/* Card Settings Dialog */}
      <CommentCardSettingsDialog
        open={showCardSettings}
        onOpenChange={setShowCardSettings}
        config={cardConfig}
        onUpdateField={updateCardField}
        onReset={resetCardSettings}
      />
    </div>
  );
};
