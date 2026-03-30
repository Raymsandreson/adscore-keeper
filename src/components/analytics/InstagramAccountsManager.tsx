import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Instagram, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Users, 
  Eye, 
  Heart,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Loader2,
  KeyRound,
  Link2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface InstagramAccount {
  id: string;
  account_name: string;
  instagram_id: string;
  access_token: string;
  followers_count: number;
  following_count: number;
  media_count: number;
  profile_picture_url: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
}

interface AvailableAccount {
  page_id: string;
  page_name: string;
  instagram_id: string;
  username: string;
  profile_picture_url: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
}

interface AccountMetrics {
  followers: number;
  reach: number;
  impressions: number;
  engagement_rate: number;
  profile_views: number;
}

export const InstagramAccountsManager = () => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [availableAccounts, setAvailableAccounts] = useState<AvailableAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addingAccount, setAddingAccount] = useState<string | null>(null);
  
  // Manual account form state
  const [manualInput, setManualInput] = useState(""); // URL or username
  const [manualAccessToken, setManualAccessToken] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [validatingToken, setValidatingToken] = useState(false);
  const [tokenValidation, setTokenValidation] = useState<{
    valid: boolean;
    instagramId?: string;
    username?: string;
    profilePicture?: string;
    followersCount?: number;
    mediaCount?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('instagram_accounts' as any)
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching accounts:', error);
        setAccounts([]);
      } else {
        setAccounts((data as unknown as InstagramAccount[]) || []);
      }
    } catch (err) {
      console.error('Error:', err);
      setAccounts([]);
    }
    setLoading(false);
  };

  const fetchAvailableAccounts = async () => {
    setLoadingAvailable(true);
    try {
      const response = await cloudFunctions.invoke('list-instagram-accounts');
      
      if (response.error) {
        console.error('Error fetching available accounts:', response.error);
        toast.error('Erro ao buscar contas', { 
          description: 'Verifique se o META_ACCESS_TOKEN está configurado corretamente.' 
        });
      } else if (response.data?.accounts) {
        // Filter out accounts that are already connected
        const connectedIds = accounts.map(a => a.instagram_id);
        const available = response.data.accounts.filter(
          (a: AvailableAccount) => !connectedIds.includes(a.instagram_id)
        );
        setAvailableAccounts(available);
        
        if (available.length === 0 && response.data.accounts.length > 0) {
          toast.info('Todas as contas já estão conectadas');
        } else if (response.data.accounts.length === 0) {
          toast.warning('Nenhuma conta encontrada', {
            description: 'Certifique-se de que o token Meta tem acesso a páginas com Instagram Business.'
          });
        }
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Erro ao buscar contas disponíveis');
    }
    setLoadingAvailable(false);
  };

  const openDialog = () => {
    setDialogOpen(true);
    // Don't auto-fetch, let user choose the tab
  };

  // Extract username from URL or input
  const extractUsername = (input: string): string => {
    const trimmed = input.trim();
    // Handle Instagram URLs
    const urlPatterns = [
      /instagram\.com\/([^/?]+)/i,
      /instagr\.am\/([^/?]+)/i,
    ];
    for (const pattern of urlPatterns) {
      const match = trimmed.match(pattern);
      if (match) return match[1].replace('@', '');
    }
    // Direct username
    return trimmed.replace('@', '');
  };

  // Validate token and discover Instagram Business Account
  const validateTokenAndDiscover = async () => {
    if (!manualAccessToken.trim()) {
      toast.error('Digite o Access Token primeiro');
      return;
    }

    setValidatingToken(true);
    setTokenValidation(null);

    try {
      const token = manualAccessToken.trim();
      
      // First, check what this token has access to
      const meResponse = await fetch(
        `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${token}`
      );
      const meData = await meResponse.json();

      if (!meResponse.ok || meData.error) {
        let errorMessage = meData.error?.message || 'Token inválido';
        
        // Provide specific guidance for common errors
        if (errorMessage.includes('API access blocked') || meData.error?.code === 4) {
          errorMessage = `🚫 Acesso à API bloqueado pela Meta.\n\nIsso geralmente acontece quando:\n\n1. O token expirou - Gere um novo token no Graph API Explorer\n2. O App não está em modo "Live" - Verifique as configurações do seu App no Meta for Developers\n3. A conta ultrapassou limites de uso - Aguarde algumas horas\n4. O App precisa de verificação - Complete a verificação do Business no Meta Business Suite\n\n💡 Solução mais comum: Gere um novo token com as permissões corretas.`;
        } else if (errorMessage.includes('expired') || meData.error?.code === 190) {
          errorMessage = `⏰ Token expirado.\n\nTokens de curta duração expiram em ~1 hora. Gere um novo token no Graph API Explorer.`;
        } else if (errorMessage.includes('Invalid OAuth') || meData.error?.code === 102) {
          errorMessage = `🔑 Sessão inválida.\n\nO token foi invalidado. Gere um novo token no Graph API Explorer.`;
        }
        
        setTokenValidation({ valid: false, error: errorMessage });
        setValidatingToken(false);
        return;
      }

      console.log('Token belongs to:', meData);

      // Try to get pages with Instagram accounts
      const pagesResponse = await fetch(
        `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count,media_count}&access_token=${token}`
      );
      const pagesData = await pagesResponse.json();

      console.log('Pages data:', pagesData);

      // Look for Instagram account in pages
      if (pagesData.data && pagesData.data.length > 0) {
        const pageWithIg = pagesData.data.find((p: any) => p.instagram_business_account);
        if (pageWithIg) {
          const ig = pageWithIg.instagram_business_account;
          setTokenValidation({
            valid: true,
            instagramId: ig.id,
            username: ig.username,
            profilePicture: ig.profile_picture_url,
            followersCount: ig.followers_count,
            mediaCount: ig.media_count,
          });
          setValidatingToken(false);
          return;
        } else {
          // Pages exist but none have Instagram linked
          setTokenValidation({ 
            valid: false, 
            error: `Encontramos ${pagesData.data.length} página(s), mas nenhuma tem Instagram Business vinculado. Vincule sua conta Instagram à página do Facebook primeiro.` 
          });
          setValidatingToken(false);
          return;
        }
      }

      // If pagesData.data is empty, check if it's a Page Token directly
      // Try to get page info to see if this is a page token
      const pageInfoResponse = await fetch(
        `https://graph.facebook.com/v18.0/${meData.id}?fields=id,name,category,instagram_business_account{id,username,profile_picture_url,followers_count,media_count}&access_token=${token}`
      );
      const pageInfoData = await pageInfoResponse.json();

      console.log('Page info data:', pageInfoData);

      // Check if we got the category field (indicates it's a Page, not a User)
      if (pageInfoData.category && pageInfoData.instagram_business_account) {
        const ig = pageInfoData.instagram_business_account;
        setTokenValidation({
          valid: true,
          instagramId: ig.id,
          username: ig.username,
          profilePicture: ig.profile_picture_url,
          followersCount: ig.followers_count,
          mediaCount: ig.media_count,
        });
        setValidatingToken(false);
        return;
      }

      // If we got here with a category but no Instagram, it's a page without IG
      if (pageInfoData.category && !pageInfoData.instagram_business_account) {
        setTokenValidation({ 
          valid: false, 
          error: `A página "${pageInfoData.name}" não tem Instagram Business vinculado. Vincule sua conta Instagram à página no Facebook Business Suite.` 
        });
        setValidatingToken(false);
        return;
      }

      // If no pages returned and no category, this is a User Token without page access
      // The token needs pages_show_list permission
      setTokenValidation({ 
        valid: false, 
        error: 'O token não tem acesso a nenhuma Página do Facebook. Verifique se você:\n\n1. Selecionou uma Página no Graph API Explorer (não apenas o App)\n2. Adicionou a permissão "pages_show_list"\n3. A conta Instagram está vinculada à Página do Facebook como Business/Creator' 
      });
    } catch (err: any) {
      console.error('Token validation error:', err);
      setTokenValidation({ valid: false, error: err.message || 'Erro ao validar token' });
    }

    setValidatingToken(false);
  };

  const addManualAccount = async () => {
    if (!tokenValidation?.valid || !tokenValidation.instagramId) {
      toast.error('Valide o token primeiro para descobrir a conta');
      return;
    }

    setAddingManual(true);

    try {
      const { data, error } = await supabase
        .from('instagram_accounts' as any)
        .insert({
          account_name: `@${tokenValidation.username}`,
          instagram_id: tokenValidation.instagramId,
          access_token: manualAccessToken.trim(),
          is_active: true,
          followers_count: tokenValidation.followersCount || 0,
          following_count: 0,
          media_count: tokenValidation.mediaCount || 0,
          profile_picture_url: tokenValidation.profilePicture,
        })
        .select()
        .single();

      if (error) {
        toast.error('Erro ao adicionar conta', { description: error.message });
      } else {
        const newAccountData = data as unknown as InstagramAccount;
        toast.success(`@${tokenValidation.username} adicionado com sucesso!`);
        setAccounts([newAccountData, ...accounts]);
        setManualInput("");
        setManualAccessToken("");
        setTokenValidation(null);
        setDialogOpen(false);
        
        // Sync the account immediately
        syncAccount(newAccountData.id);
      }
    } catch (err: any) {
      toast.error('Erro ao adicionar conta', { description: err.message });
    }

    setAddingManual(false);
  };

  const addAccount = async (availableAccount: AvailableAccount) => {
    setAddingAccount(availableAccount.instagram_id);

    try {
      const { data, error } = await supabase
        .from('instagram_accounts' as any)
        .insert({
          account_name: `@${availableAccount.username}`,
          instagram_id: availableAccount.instagram_id,
          access_token: 'USE_GLOBAL_TOKEN',
          is_active: true,
          followers_count: availableAccount.followers_count,
          following_count: availableAccount.follows_count,
          media_count: availableAccount.media_count,
          profile_picture_url: availableAccount.profile_picture_url,
        })
        .select()
        .single();

      if (error) {
        toast.error('Erro ao adicionar conta', { description: error.message });
      } else {
        const newAccountData = data as unknown as InstagramAccount;
        toast.success(`@${availableAccount.username} conectado com sucesso!`);
        setAccounts([newAccountData, ...accounts]);
        setAvailableAccounts(availableAccounts.filter(a => a.instagram_id !== availableAccount.instagram_id));
        
        // Sync the account immediately
        syncAccount(newAccountData.id);
      }
    } catch (err: any) {
      toast.error('Erro ao adicionar conta', { description: err.message });
    }

    setAddingAccount(null);
  };

  const deleteAccount = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instagram_accounts' as any)
        .delete()
        .eq('id', id);

      if (error) {
        toast.error('Erro ao remover conta', { description: error.message });
      } else {
        toast.success('Conta removida');
        setAccounts(accounts.filter(a => a.id !== id));
      }
    } catch (err: any) {
      toast.error('Erro ao remover conta', { description: err.message });
    }
  };

  const syncAccount = async (id: string, fetchCommentsAfter = true) => {
    setSyncing(id);
    
    try {
      // First sync metrics
      const response = await cloudFunctions.invoke('sync-instagram-metrics', {
        body: { account_id: id }
      });

      if (response.error) {
        console.log('Sync error:', response.error);
        toast.error('Erro na sincronização', { 
          description: response.error.message || 'Verifique o token de acesso.' 
        });
      } else if (response.data?.error) {
        toast.error('Erro na sincronização', { 
          description: response.data.error 
        });
      } else {
        toast.success('Métricas sincronizadas!');
      }
      
      // Then fetch comments if requested
      if (fetchCommentsAfter) {
        await fetchAndSaveComments(id);
      }
      
      fetchAccounts();
    } catch (error: any) {
      console.log('Sync error:', error);
      toast.error('Erro na sincronização');
    }

    setSyncing(null);
  };

  // Fetch and save comments from Instagram
  const fetchAndSaveComments = async (accountId: string) => {
    try {
      // Get account details
      const { data: account } = await supabase
        .from('instagram_accounts')
        .select('access_token, instagram_id, account_name')
        .eq('id', accountId)
        .single();

      if (!account) {
        console.error('Account not found');
        return;
      }

      toast.info('Buscando comentários...', { id: 'fetching-comments' });

      const response = await cloudFunctions.invoke('fetch-instagram-comments', {
        body: { 
          accessToken: account.access_token,
          instagramAccountId: account.instagram_id
        }
      });

      if (response.error) {
        console.error('Error fetching comments:', response.error);
        toast.error('Erro ao buscar comentários', { 
          id: 'fetching-comments',
          description: response.error.message 
        });
        return;
      }

      if (!response.data?.success) {
        toast.error('Erro ao buscar comentários', { 
          id: 'fetching-comments',
          description: response.data?.error || 'Erro desconhecido' 
        });
        return;
      }

      const comments = response.data.comments || [];
      const manualReplies = response.data.manualReplies || [];

      if (comments.length === 0) {
        toast.info('Nenhum comentário encontrado', { id: 'fetching-comments' });
        return;
      }

      // Save comments to database
      let savedCount = 0;
      let updatedCount = 0;

      for (const comment of comments) {
        // Check if comment already exists
        const { data: existing } = await supabase
          .from('instagram_comments')
          .select('id, replied_at')
          .eq('comment_id', comment.comment_id)
          .maybeSingle();

        if (existing) {
          // Update if manual reply was detected and not already marked
          if (comment.was_manually_replied && !existing.replied_at) {
            await supabase
              .from('instagram_comments')
              .update({
                replied_at: comment.manual_reply_at,
                metadata: {
                  manual_reply: true,
                  manual_reply_text: manualReplies.find((r: any) => r.comment_id === comment.comment_id)?.reply_text
                }
              })
              .eq('id', existing.id);
            updatedCount++;
          }
          continue;
        }

        // Insert new comment
        const { error: insertError } = await supabase
          .from('instagram_comments')
          .insert({
            comment_id: comment.comment_id,
            comment_text: comment.comment_text,
            author_username: comment.author_username,
            author_id: comment.author_id,
            post_id: comment.post_id,
            post_url: comment.post_url,
            parent_comment_id: comment.parent_comment_id || null,
            comment_type: comment.comment_type,
            platform: 'instagram',
            created_at: comment.created_at,
            ad_account_id: account.instagram_id,
            replied_at: comment.was_manually_replied ? comment.manual_reply_at : null,
            metadata: {
              account_name: account.account_name,
              ...(comment.metadata || {}),
              ...(comment.was_manually_replied ? {
                manual_reply: true,
                manual_reply_text: manualReplies.find((r: any) => r.comment_id === comment.comment_id)?.reply_text
              } : {})
            }
          });

        if (!insertError) {
          savedCount++;
        }
      }

      toast.success(`${savedCount} comentários importados${updatedCount > 0 ? `, ${updatedCount} atualizados` : ''}`, { 
        id: 'fetching-comments' 
      });

    } catch (err: any) {
      console.error('Error fetching comments:', err);
      toast.error('Erro ao buscar comentários', { 
        id: 'fetching-comments',
        description: err.message 
      });
    }
  };

  const syncAllAccounts = async () => {
    for (const account of accounts) {
      await syncAccount(account.id);
    }
  };

  const getMetrics = (account: InstagramAccount): AccountMetrics => ({
    followers: account.followers_count || 0,
    reach: 0, // Will be populated from instagram_metrics table
    impressions: 0,
    engagement_rate: 0,
    profile_views: 0,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <Instagram className="h-5 w-5 text-pink-500" />
            Contas do Instagram
          </h3>
          <p className="text-sm text-muted-foreground">
            Conecte suas contas do Instagram Business para acompanhar métricas
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <Button variant="outline" size="sm" onClick={syncAllAccounts}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sincronizar Todas
            </Button>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={openDialog}>
                <Plus className="h-4 w-4" />
                Conectar Conta
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Conectar Conta do Instagram</DialogTitle>
                <DialogDescription>
                  Conecte via Meta Business ou adicione manualmente
                </DialogDescription>
              </DialogHeader>
              
              <Tabs defaultValue="manual" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="manual" className="gap-2">
                    <KeyRound className="h-4 w-4" />
                    Adicionar Manual
                  </TabsTrigger>
                  <TabsTrigger value="meta" className="gap-2" onClick={fetchAvailableAccounts}>
                    <Link2 className="h-4 w-4" />
                    Via Meta Business
                  </TabsTrigger>
                </TabsList>
                
                {/* Manual Tab */}
                <TabsContent value="manual" className="space-y-4 mt-4">
                  <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2">
                    <p className="font-medium">Como funciona:</p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                      <li>Acesse o <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-primary underline">Graph API Explorer</a></li>
                      <li>Gere um token com as permissões: <code className="bg-muted px-1 rounded">instagram_basic</code>, <code className="bg-muted px-1 rounded">instagram_manage_insights</code>, <code className="bg-muted px-1 rounded">pages_read_engagement</code></li>
                      <li>Cole o token abaixo e clique em "Validar" - detectaremos a conta automaticamente</li>
                    </ol>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="manual-token">Access Token</Label>
                      <div className="flex gap-2">
                        <Input
                          id="manual-token"
                          type="password"
                          placeholder="EAAxxxxxx..."
                          value={manualAccessToken}
                          onChange={(e) => {
                            setManualAccessToken(e.target.value);
                            setTokenValidation(null);
                          }}
                          className="flex-1"
                        />
                        <Button 
                          variant="outline" 
                          onClick={validateTokenAndDiscover}
                          disabled={validatingToken || !manualAccessToken.trim()}
                        >
                          {validatingToken ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Validar"
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Token de acesso com permissões de Instagram Business
                      </p>
                    </div>

                    {/* Validation Result */}
                    {tokenValidation && (
                      <div className={`p-4 rounded-lg border ${tokenValidation.valid ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                        {tokenValidation.valid ? (
                          <div className="flex items-center gap-4">
                            {tokenValidation.profilePicture ? (
                              <img 
                                src={tokenValidation.profilePicture} 
                                alt={tokenValidation.username}
                                className="w-14 h-14 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center text-white font-bold">
                                {tokenValidation.username?.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                <span className="font-medium">@{tokenValidation.username}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                ID: {tokenValidation.instagramId}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {tokenValidation.followersCount?.toLocaleString('pt-BR')} seguidores • {tokenValidation.mediaCount?.toLocaleString('pt-BR')} posts
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium text-red-500">Token inválido</p>
                              <p className="text-sm text-muted-foreground">{tokenValidation.error}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <Button 
                    className="w-full" 
                    onClick={addManualAccount}
                    disabled={addingManual || !tokenValidation?.valid}
                  >
                    {addingManual ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Adicionar Conta
                  </Button>
                </TabsContent>
                
                {/* Meta Business Tab */}
                <TabsContent value="meta" className="mt-4">
                  {loadingAvailable ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Buscando contas...</span>
                    </div>
                  ) : availableAccounts.length === 0 ? (
                    <div className="text-center py-8">
                      <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">
                        Nenhuma conta disponível para conectar.
                      </p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Certifique-se de que o META_ACCESS_TOKEN está configurado e tem acesso a páginas com Instagram Business.
                      </p>
                      <Button variant="outline" size="sm" className="mt-4" onClick={fetchAvailableAccounts}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Tentar Novamente
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {availableAccounts.map((account) => (
                        <div 
                          key={account.instagram_id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <img 
                              src={account.profile_picture_url} 
                              alt={account.username}
                              className="w-12 h-12 rounded-full object-cover"
                            />
                            <div>
                              <p className="font-medium">@{account.username}</p>
                              <p className="text-sm text-muted-foreground">
                                {account.followers_count.toLocaleString('pt-BR')} seguidores • 
                                {account.media_count.toLocaleString('pt-BR')} posts
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Página: {account.page_name}
                              </p>
                            </div>
                          </div>
                          <Button 
                            size="sm" 
                            onClick={() => addAccount(account)}
                            disabled={addingAccount === account.instagram_id}
                          >
                            {addingAccount === account.instagram_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Conectar
                              </>
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Fechar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty State */}
      {!loading && accounts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Instagram className="h-12 w-12 text-muted-foreground mb-4" />
            <h4 className="text-lg font-medium mb-2">Nenhuma conta conectada</h4>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              Conecte suas contas do Instagram Business para começar a acompanhar as métricas de engajamento, alcance e crescimento.
            </p>
            <Button onClick={openDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Conectar Primeira Conta
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Accounts Grid */}
      {!loading && accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const metrics = getMetrics(account);
            return (
              <Card key={account.id} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {account.profile_picture_url ? (
                        <img 
                          src={account.profile_picture_url} 
                          alt={account.account_name}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center text-white font-bold">
                          {account.account_name.slice(1, 3).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-base">{account.account_name}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {account.media_count} posts
                        </p>
                      </div>
                    </div>
                    <Badge variant={account.is_active ? "default" : "secondary"} className="gap-1">
                      {account.is_active ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertCircle className="h-3 w-3" />
                      )}
                      {account.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                        <Users className="h-3 w-3" />
                        Seguidores
                      </div>
                      <p className="text-lg font-bold">{metrics.followers.toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                        <Users className="h-3 w-3" />
                        Seguindo
                      </div>
                      <p className="text-lg font-bold">{account.following_count.toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                        <Heart className="h-3 w-3" />
                        Posts
                      </div>
                      <p className="text-lg font-bold">{account.media_count.toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                        <TrendingUp className="h-3 w-3" />
                        Taxa Eng.
                      </div>
                      <p className="text-lg font-bold">{metrics.engagement_rate}%</p>
                    </div>
                  </div>

                  {/* Last Sync */}
                  {account.last_sync_at && (
                    <p className="text-xs text-muted-foreground text-center">
                      Última sincronização: {new Date(account.last_sync_at).toLocaleString('pt-BR')}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => syncAccount(account.id)}
                      disabled={syncing === account.id}
                    >
                      {syncing === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Sincronizar
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => deleteAccount(account.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

    </div>
  );
};
