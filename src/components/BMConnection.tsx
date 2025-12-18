import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wifi, WifiOff, AlertCircle, RefreshCw, Save, Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetaAPIConfig } from "@/services/metaAPI";

interface SavedAccount {
  id: string;
  name: string;
  accessToken: string;
  accountId: string;
}

interface BMConnectionProps {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  onConnect: (config: MetaAPIConfig) => Promise<boolean>;
  onDisconnect: () => void;
  onRefresh: () => Promise<void>;
}

const STORAGE_KEY = "meta_saved_accounts";

const BMConnection = ({ 
  isConnected, 
  isLoading, 
  error, 
  onConnect, 
  onDisconnect, 
  onRefresh 
}: BMConnectionProps) => {
  const [accessToken, setAccessToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [connectedAccountName, setConnectedAccountName] = useState("");
  const { toast } = useToast();

  // Carregar contas salvas do localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const accounts = JSON.parse(saved);
        setSavedAccounts(accounts);
        if (accounts.length > 0 && !showNewForm) {
          const firstAccount = accounts[0];
          setSelectedAccountId(firstAccount.id);
          // IMPORTANTE: também preencher os campos de credenciais
          setAccessToken(firstAccount.accessToken);
          setAccountId(firstAccount.accountId);
          setAccountName(firstAccount.name);
        }
      } catch (e) {
        console.error("Error loading saved accounts:", e);
      }
    }
  }, []);

  // Salvar no localStorage quando muda
  const saveToStorage = (accounts: SavedAccount[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    setSavedAccounts(accounts);
  };

  const handleSelectAccount = (id: string) => {
    if (id === "new") {
      setShowNewForm(true);
      setSelectedAccountId("");
      setAccessToken("");
      setAccountId("");
      setAccountName("");
    } else {
      setShowNewForm(false);
      setSelectedAccountId(id);
      const account = savedAccounts.find(a => a.id === id);
      if (account) {
        setAccessToken(account.accessToken);
        setAccountId(account.accountId);
        setAccountName(account.name);
      }
    }
  };

  const handleSaveAccount = () => {
    if (!accessToken.trim() || !accountId.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o Access Token e Account ID",
        variant: "destructive",
      });
      return;
    }

    const name = accountName.trim() || `Conta ${accountId.replace('act_', '')}`;
    const newAccount: SavedAccount = {
      id: `account_${Date.now()}`,
      name,
      accessToken: accessToken.trim(),
      accountId: accountId.trim()
    };

    const updated = [...savedAccounts, newAccount];
    saveToStorage(updated);
    setSelectedAccountId(newAccount.id);
    setShowNewForm(false);
    
    toast({
      title: "✅ Conta salva",
      description: `"${name}" foi salva com sucesso`,
    });
  };

  const handleDeleteAccount = (id: string) => {
    const account = savedAccounts.find(a => a.id === id);
    const updated = savedAccounts.filter(a => a.id !== id);
    saveToStorage(updated);
    
    if (selectedAccountId === id) {
      setSelectedAccountId(updated.length > 0 ? updated[0].id : "");
      if (updated.length === 0) {
        setShowNewForm(true);
        setAccessToken("");
        setAccountId("");
        setAccountName("");
      } else {
        const firstAccount = updated[0];
        setAccessToken(firstAccount.accessToken);
        setAccountId(firstAccount.accountId);
        setAccountName(firstAccount.name);
      }
    }
    
    toast({
      title: "Conta removida",
      description: `"${account?.name}" foi removida`,
    });
  };

  const handleConnect = async () => {
    if (!accessToken.trim() || !accountId.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o Access Token e Account ID",
        variant: "destructive",
      });
      return;
    }

    const success = await onConnect({
      accessToken: accessToken.trim(),
      accountId: accountId.trim()
    });

    if (success) {
      const name = accountName || savedAccounts.find(a => a.id === selectedAccountId)?.name || accountId;
      setConnectedAccountName(name);
      toast({
        title: "✅ Conectado com sucesso!",
        description: "Dados reais do Meta Business Manager sendo coletados",
      });
    } else {
      toast({
        title: "❌ Erro na conexão",
        description: error || "Verifique suas credenciais",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = () => {
    onDisconnect();
    setConnectedAccountName("");
    toast({
      title: "Desconectado",
      description: "Conexão com Meta Business Manager encerrada",
    });
  };

  const handleRefresh = async () => {
    await onRefresh();
    toast({
      title: "Dados atualizados",
      description: "Métricas foram atualizadas com sucesso",
    });
  };

  return (
    <Card className="bg-gradient-card border-border shadow-card-custom">
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {isConnected ? (
            <>
              <div className="relative">
                <Wifi className="h-6 w-6 text-success" />
                <div className="absolute -inset-1 bg-success/20 rounded-full"></div>
              </div>
              <span className="text-foreground">Meta Business Manager</span>
              <Badge className="status-success">Conectado</Badge>
            </>
          ) : (
            <>
              <WifiOff className="h-6 w-6 text-muted-foreground" />
              <span className="text-foreground">Meta Business Manager</span>
              <Badge variant="secondary">Desconectado</Badge>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
              <div className="text-sm">
                <strong className="text-foreground">Modo de Demonstração Ativo</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sistema funcionando com dados simulados. Conecte para ver dados reais.
                </p>
              </div>
            </div>

            {/* Seleção de conta salva */}
            {savedAccounts.length > 0 && (
              <div className="space-y-2">
                <Label>Contas Salvas</Label>
                <div className="flex gap-2">
                  <Select value={selectedAccountId || (showNewForm ? "new" : "")} onValueChange={handleSelectAccount}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione uma conta..." />
                    </SelectTrigger>
                    <SelectContent>
                      {savedAccounts.map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          <div className="flex items-center gap-2">
                            <span>{account.name}</span>
                            <span className="text-xs text-muted-foreground">({account.accountId})</span>
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="new">
                        <div className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          <span>Adicionar nova conta...</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedAccountId && !showNewForm && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDeleteAccount(selectedAccountId)}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Formulário de nova conta ou edição */}
            {(showNewForm || savedAccounts.length === 0) && (
              <div className="space-y-4 p-4 border border-dashed border-primary/30 rounded-lg bg-primary/5">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Nova Conta</h4>
                  {savedAccounts.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => {
                        setShowNewForm(false);
                        if (savedAccounts.length > 0) {
                          handleSelectAccount(savedAccounts[0].id);
                        }
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="account-name">Nome da Conta (opcional)</Label>
                  <Input
                    id="account-name"
                    placeholder="Ex: Conta Principal, Cliente X..."
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="token">Access Token</Label>
                    <Input
                      id="token"
                      type="password"
                      placeholder="EAAG..."
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account">Account ID</Label>
                    <Input
                      id="account"
                      placeholder="act_123456789"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    />
                  </div>
                </div>
                
                <Button 
                  variant="outline" 
                  onClick={handleSaveAccount}
                  disabled={!accessToken.trim() || !accountId.trim()}
                  className="w-full"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Salvar Conta
                </Button>
              </div>
            )}

            {/* Campos para conta selecionada */}
            {!showNewForm && savedAccounts.length > 0 && selectedAccountId && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-muted/50 rounded-lg">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Access Token</Label>
                  <div className="text-sm font-mono">••••••{accessToken.slice(-8)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Account ID</Label>
                  <div className="text-sm font-mono">{accountId}</div>
                </div>
              </div>
            )}
            
            <Button 
              onClick={handleConnect}
              disabled={isLoading || (!accessToken.trim() || !accountId.trim())}
              className="w-full bg-gradient-primary hover:shadow-card-hover transition-all duration-200"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin"></div>
                  Conectando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Wifi className="h-4 w-4" />
                  Conectar
                </span>
              )}
            </Button>
            
            {error && (
              <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg p-3">
                <strong>Erro:</strong> {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                    Conectado - Dados reais da Meta API
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Dados atualizados automaticamente a cada 30 segundos
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleRefresh}
                    className="hover:bg-success/10 hover:border-success hover:text-success transition-colors"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Atualizar
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={handleDisconnect}
                    className="bg-gradient-danger hover:shadow-danger transition-all duration-200"
                  >
                    Desconectar
                  </Button>
                </div>
              </div>
            </div>
            
            <div className="text-xs text-muted-foreground space-y-1">
              <div><strong>Conta:</strong> {connectedAccountName || accountName || "Conta conectada"}</div>
              <div><strong>ID:</strong> {accountId}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BMConnection;
