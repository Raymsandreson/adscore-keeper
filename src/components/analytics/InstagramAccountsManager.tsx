import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Loader2
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

interface AccountMetrics {
  followers: number;
  reach: number;
  impressions: number;
  engagement_rate: number;
  profile_views: number;
}

export const InstagramAccountsManager = () => {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({
    account_name: '',
    instagram_id: '',
    access_token: '',
  });
  const [addingAccount, setAddingAccount] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('instagram_accounts')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching accounts:', error);
      // If table doesn't exist yet, just set empty array
      setAccounts([]);
    } else {
      setAccounts(data || []);
    }
    setLoading(false);
  };

  const addAccount = async () => {
    if (!newAccount.account_name || !newAccount.instagram_id || !newAccount.access_token) {
      toast.error('Preencha todos os campos');
      return;
    }

    setAddingAccount(true);

    const { data, error } = await supabase
      .from('instagram_accounts')
      .insert({
        account_name: newAccount.account_name,
        instagram_id: newAccount.instagram_id,
        access_token: newAccount.access_token,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      toast.error('Erro ao adicionar conta', { description: error.message });
    } else {
      toast.success('Conta adicionada com sucesso!');
      setAccounts([data, ...accounts]);
      setNewAccount({ account_name: '', instagram_id: '', access_token: '' });
      setDialogOpen(false);
      // Sync the new account
      syncAccount(data.id);
    }

    setAddingAccount(false);
  };

  const deleteAccount = async (id: string) => {
    const { error } = await supabase
      .from('instagram_accounts')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Erro ao remover conta', { description: error.message });
    } else {
      toast.success('Conta removida');
      setAccounts(accounts.filter(a => a.id !== id));
    }
  };

  const syncAccount = async (id: string) => {
    setSyncing(id);
    
    try {
      const response = await supabase.functions.invoke('sync-instagram-metrics', {
        body: { account_id: id }
      });

      if (response.error) {
        throw response.error;
      }

      toast.success('Métricas sincronizadas!');
      fetchAccounts();
    } catch (error: any) {
      toast.error('Erro ao sincronizar', { description: error.message });
    }

    setSyncing(null);
  };

  const syncAllAccounts = async () => {
    for (const account of accounts) {
      await syncAccount(account.id);
    }
  };

  // Mock metrics for display (in production these would come from the database)
  const getMockMetrics = (account: InstagramAccount): AccountMetrics => ({
    followers: account.followers_count || Math.floor(Math.random() * 10000) + 1000,
    reach: Math.floor(Math.random() * 50000) + 5000,
    impressions: Math.floor(Math.random() * 100000) + 10000,
    engagement_rate: parseFloat((Math.random() * 8 + 2).toFixed(2)),
    profile_views: Math.floor(Math.random() * 5000) + 500,
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
            Gerencie e acompanhe as métricas das suas contas do Instagram
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
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar Conta
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Conta do Instagram</DialogTitle>
                <DialogDescription>
                  Adicione uma conta do Instagram para acompanhar suas métricas.
                  Você precisará do ID da conta e um token de acesso da API do Meta.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="account_name">Nome da Conta</Label>
                  <Input
                    id="account_name"
                    placeholder="Ex: @minha_empresa"
                    value={newAccount.account_name}
                    onChange={(e) => setNewAccount({ ...newAccount, account_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="instagram_id">ID do Instagram Business</Label>
                  <Input
                    id="instagram_id"
                    placeholder="Ex: 17841405793187218"
                    value={newAccount.instagram_id}
                    onChange={(e) => setNewAccount({ ...newAccount, instagram_id: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    O ID numérico da sua conta Business do Instagram
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="access_token">Token de Acesso</Label>
                  <Input
                    id="access_token"
                    type="password"
                    placeholder="Token de acesso do Meta Business"
                    value={newAccount.access_token}
                    onChange={(e) => setNewAccount({ ...newAccount, access_token: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Token com permissões de instagram_basic e instagram_manage_insights
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={addAccount} disabled={addingAccount}>
                  {addingAccount ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Adicionar
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
              Adicione suas contas do Instagram para começar a acompanhar as métricas de engajamento, alcance e crescimento.
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Primeira Conta
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Accounts Grid */}
      {!loading && accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const metrics = getMockMetrics(account);
            return (
              <Card key={account.id} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center text-white font-bold">
                        {account.account_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-base">{account.account_name}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          ID: {account.instagram_id.slice(0, 8)}...
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
                        <Eye className="h-3 w-3" />
                        Alcance
                      </div>
                      <p className="text-lg font-bold">{metrics.reach.toLocaleString('pt-BR')}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                        <Heart className="h-3 w-3" />
                        Engajamento
                      </div>
                      <p className="text-lg font-bold">{metrics.engagement_rate}%</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                        <TrendingUp className="h-3 w-3" />
                        Impressões
                      </div>
                      <p className="text-lg font-bold">{(metrics.impressions / 1000).toFixed(1)}K</p>
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

      {/* Info Card */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-medium mb-1">Como obter as credenciais?</h4>
              <p className="text-sm text-muted-foreground">
                Para conectar sua conta do Instagram, você precisa de uma conta Business ou Creator 
                conectada a uma página do Facebook. Acesse o{' '}
                <a 
                  href="https://developers.facebook.com/tools/explorer/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Graph API Explorer
                </a>
                {' '}para gerar seu token de acesso com as permissões necessárias.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
