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
  const [manualUsername, setManualUsername] = useState("");
  const [manualInstagramId, setManualInstagramId] = useState("");
  const [manualAccessToken, setManualAccessToken] = useState("");
  const [addingManual, setAddingManual] = useState(false);

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
      const response = await supabase.functions.invoke('list-instagram-accounts');
      
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

  const addManualAccount = async () => {
    if (!manualUsername.trim()) {
      toast.error('Digite o username da conta');
      return;
    }
    if (!manualInstagramId.trim()) {
      toast.error('Digite o ID numérico do Instagram Business');
      return;
    }
    if (!/^\d+$/.test(manualInstagramId.trim())) {
      toast.error('O ID deve ser numérico (ex: 17841400000000000)');
      return;
    }
    if (!manualAccessToken.trim()) {
      toast.error('Digite o Access Token');
      return;
    }

    setAddingManual(true);

    try {
      const username = manualUsername.trim().replace('@', '');
      
      const { data, error } = await supabase
        .from('instagram_accounts' as any)
        .insert({
          account_name: `@${username}`,
          instagram_id: manualInstagramId.trim(),
          access_token: manualAccessToken.trim(),
          is_active: true,
          followers_count: 0,
          following_count: 0,
          media_count: 0,
        })
        .select()
        .single();

      if (error) {
        toast.error('Erro ao adicionar conta', { description: error.message });
      } else {
        const newAccountData = data as unknown as InstagramAccount;
        toast.success(`@${username} adicionado com sucesso!`);
        setAccounts([newAccountData, ...accounts]);
        setManualUsername("");
        setManualInstagramId("");
        setManualAccessToken("");
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

  const syncAccount = async (id: string) => {
    setSyncing(id);
    
    try {
      const response = await supabase.functions.invoke('sync-instagram-metrics', {
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
      
      fetchAccounts();
    } catch (error: any) {
      console.log('Sync error:', error);
      toast.error('Erro na sincronização');
    }

    setSyncing(null);
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
                    <p className="font-medium">Como obter os dados:</p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                      <li>Acesse o <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-primary underline">Graph API Explorer</a></li>
                      <li>Gere um token com as permissões: <code className="bg-muted px-1 rounded">instagram_basic</code>, <code className="bg-muted px-1 rounded">instagram_manage_insights</code></li>
                      <li>O ID numérico pode ser encontrado fazendo uma chamada GET para <code className="bg-muted px-1 rounded">/me/accounts</code></li>
                    </ol>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="manual-username">Username do Instagram</Label>
                      <Input
                        id="manual-username"
                        placeholder="@seuusuario"
                        value={manualUsername}
                        onChange={(e) => setManualUsername(e.target.value)}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="manual-id">ID Numérico do Instagram Business</Label>
                      <Input
                        id="manual-id"
                        placeholder="17841400000000000"
                        value={manualInstagramId}
                        onChange={(e) => setManualInstagramId(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        ID numérico da conta (não é o username)
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="manual-token">Access Token</Label>
                      <Input
                        id="manual-token"
                        type="password"
                        placeholder="EAAxxxxxx..."
                        value={manualAccessToken}
                        onChange={(e) => setManualAccessToken(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Token de acesso com permissões de Instagram Business
                      </p>
                    </div>
                  </div>
                  
                  <Button 
                    className="w-full" 
                    onClick={addManualAccount}
                    disabled={addingManual}
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
