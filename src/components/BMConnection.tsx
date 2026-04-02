import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wifi, WifiOff, AlertCircle, RefreshCw, Save, Trash2, Plus, Clock, CheckCircle2, XCircle, Key, ExternalLink, HelpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetaAPIConfig } from "@/services/metaAPI";
import TokenConfigGuide from "./TokenConfigGuide";
import { useMetaAdAccounts } from "@/hooks/useMetaAdAccounts";

interface TokenInfo {
  isValid: boolean;
  expiresAt: Date | null;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  scopes: string[];
  appId: string | null;
  userId: string | null;
  type: 'short-lived' | 'long-lived' | 'unknown';
}

interface BMConnectionProps {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  onConnect: (config: MetaAPIConfig) => Promise<boolean>;
  onDisconnect: () => void;
  onRefresh: () => Promise<void>;
}

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
  const { accounts: savedAccounts, loading: accountsLoading, addAccount, deleteAccount: removeAccount } = useMetaAdAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [connectedAccountName, setConnectedAccountName] = useState("");
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isValidatingToken, setIsValidatingToken] = useState(false);
  const [connectedTokenInfo, setConnectedTokenInfo] = useState<TokenInfo | null>(null);
  const [showConfigGuide, setShowConfigGuide] = useState(false);
  const { toast } = useToast();

  // Selecionar primeira conta quando carregam do DB
  useEffect(() => {
    if (savedAccounts.length > 0 && !selectedAccountId && !showNewForm) {
      const firstAccount = savedAccounts[0];
      setSelectedAccountId(firstAccount.id);
      setAccessToken(firstAccount.accessToken);
      setAccountId(firstAccount.accountId);
      setAccountName(firstAccount.name);
    }
  }, [savedAccounts]);

  // Validar token quando o token mudar
  const validateToken = async (token: string) => {
    if (!token || token.length < 50) {
      setTokenInfo(null);
      return null;
    }

    setIsValidatingToken(true);
    try {
      // Debug token para verificar validade e informações
      const response = await fetch(
        `https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`
      );
      const data = await response.json();

      if (data.error) {
        const info: TokenInfo = {
          isValid: false,
          expiresAt: null,
          isExpired: true,
          daysUntilExpiry: null,
          scopes: [],
          appId: null,
          userId: null,
          type: 'unknown'
        };
        setTokenInfo(info);
        return info;
      }

      const tokenData = data.data;
      const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null;
      const now = new Date();
      const isExpired = tokenData.is_valid === false || (expiresAt && expiresAt < now);
      
      let daysUntilExpiry: number | null = null;
      if (expiresAt && !isExpired) {
        daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Determinar tipo de token (short-lived = ~1-2h, long-lived = ~60 days)
      let tokenType: 'short-lived' | 'long-lived' | 'unknown' = 'unknown';
      if (daysUntilExpiry !== null) {
        if (daysUntilExpiry <= 1) {
          tokenType = 'short-lived';
        } else if (daysUntilExpiry > 1) {
          tokenType = 'long-lived';
        }
      }

      const info: TokenInfo = {
        isValid: tokenData.is_valid && !isExpired,
        expiresAt,
        isExpired: isExpired || false,
        daysUntilExpiry,
        scopes: tokenData.scopes || [],
        appId: tokenData.app_id || null,
        userId: tokenData.user_id || null,
        type: tokenType
      };

      setTokenInfo(info);
      return info;
    } catch (error) {
      console.error("Error validating token:", error);
      const info: TokenInfo = {
        isValid: false,
        expiresAt: null,
        isExpired: true,
        daysUntilExpiry: null,
        scopes: [],
        appId: null,
        userId: null,
        type: 'unknown'
      };
      setTokenInfo(info);
      return info;
    } finally {
      setIsValidatingToken(false);
    }
  };

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
      setTokenInfo(null);
    } else {
      setShowNewForm(false);
      setSelectedAccountId(id);
      const account = savedAccounts.find(a => a.id === id);
      if (account) {
        setAccessToken(account.accessToken);
        setAccountId(account.accountId);
        setAccountName(account.name);
        // Validar token da conta selecionada
        validateToken(account.accessToken);
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
        setTokenInfo(null);
      } else {
        const firstAccount = updated[0];
        setAccessToken(firstAccount.accessToken);
        setAccountId(firstAccount.accountId);
        setAccountName(firstAccount.name);
        validateToken(firstAccount.accessToken);
      }
    }
    
    toast({
      title: "Conta removida",
      description: `"${account?.name}" foi removida`,
    });
  };

  const handleValidateToken = async () => {
    if (!accessToken.trim()) {
      toast({
        title: "Token vazio",
        description: "Digite um Access Token para validar",
        variant: "destructive",
      });
      return;
    }

    const info = await validateToken(accessToken.trim());
    
    if (info?.isValid) {
      toast({
        title: "✅ Token válido",
        description: info.daysUntilExpiry 
          ? `Token expira em ${info.daysUntilExpiry} dias`
          : "Token válido sem data de expiração definida",
      });
    } else if (info?.isExpired) {
      toast({
        title: "❌ Token expirado",
        description: "Este token já expirou. Gere um novo token.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "❌ Token inválido",
        description: "Não foi possível validar o token. Verifique se está correto.",
        variant: "destructive",
      });
    }
  };

  const handleConnect = async () => {
    const trimmedToken = accessToken.trim();
    const trimmedAccountId = accountId.trim();

    if (!trimmedToken || !trimmedAccountId) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o Access Token e Account ID",
        variant: "destructive",
      });
      return;
    }

    // Validar formato do token
    if (!trimmedToken.startsWith('EAA')) {
      toast({
        title: "Token inválido",
        description: "O Access Token deve começar com 'EAA'. Verifique se você copiou o token corretamente do Facebook.",
        variant: "destructive",
      });
      return;
    }

    if (trimmedToken.length < 50) {
      toast({
        title: "Token muito curto",
        description: "O Access Token parece estar incompleto. Tokens Meta geralmente têm mais de 150 caracteres.",
        variant: "destructive",
      });
      return;
    }

    // Validar token antes de conectar
    const validationInfo = await validateToken(trimmedToken);
    
    if (validationInfo?.isExpired) {
      toast({
        title: "❌ Token expirado",
        description: "Este token já expirou. Por favor, gere um novo token no Meta Business Suite.",
        variant: "destructive",
      });
      return;
    }

    if (!validationInfo?.isValid) {
      toast({
        title: "⚠️ Token possivelmente inválido",
        description: "Não foi possível confirmar a validade do token. Tentando conectar mesmo assim...",
      });
    }

    const success = await onConnect({
      accessToken: trimmedToken,
      accountId: trimmedAccountId
    });

    if (success) {
      const name = accountName || savedAccounts.find(a => a.id === selectedAccountId)?.name || accountId;
      setConnectedAccountName(name);
      setConnectedTokenInfo(validationInfo);
      
      // Mostrar alerta se token estiver próximo de expirar
      if (validationInfo?.daysUntilExpiry !== null && validationInfo.daysUntilExpiry <= 7) {
        toast({
          title: "⚠️ Token próximo de expirar",
          description: `Seu token expira em ${validationInfo.daysUntilExpiry} dias. Considere gerar um novo token de longa duração.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "✅ Conectado com sucesso!",
          description: "Dados reais do Meta Business Manager sendo coletados",
        });
      }
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
    setConnectedTokenInfo(null);
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

  const openTokenGenerator = () => {
    window.open('https://developers.facebook.com/tools/explorer/', '_blank');
  };

  const openLongLivedTokenGuide = () => {
    window.open('https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived', '_blank');
  };

  const getTokenStatusBadge = (info: TokenInfo | null) => {
    if (!info) return null;

    if (info.isExpired) {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Expirado
        </Badge>
      );
    }

    if (!info.isValid) {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Inválido
        </Badge>
      );
    }

    if (info.daysUntilExpiry !== null && info.daysUntilExpiry <= 3) {
      return (
        <Badge variant="destructive" className="gap-1">
          <Clock className="h-3 w-3" />
          Expira em {info.daysUntilExpiry}d
        </Badge>
      );
    }

    if (info.daysUntilExpiry !== null && info.daysUntilExpiry <= 7) {
      return (
        <Badge className="bg-warning text-warning-foreground gap-1">
          <Clock className="h-3 w-3" />
          Expira em {info.daysUntilExpiry}d
        </Badge>
      );
    }

    return (
      <Badge className="bg-success text-success-foreground gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Válido {info.daysUntilExpiry ? `(${info.daysUntilExpiry}d)` : ''}
      </Badge>
    );
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
              {connectedTokenInfo && getTokenStatusBadge(connectedTokenInfo)}
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

            {/* Botões de ajuda para tokens */}
            <div className="flex gap-2 flex-wrap">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={openTokenGenerator}
                className="gap-2"
              >
                <Key className="h-4 w-4" />
                Gerar Token
                <ExternalLink className="h-3 w-3" />
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={openLongLivedTokenGuide}
                className="gap-2"
              >
                <Clock className="h-4 w-4" />
                Token Longa Duração
                <ExternalLink className="h-3 w-3" />
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => setShowConfigGuide(!showConfigGuide)}
                className="gap-2"
              >
                <HelpCircle className="h-4 w-4" />
                {showConfigGuide ? "Fechar Guia" : "Guia Completo"}
              </Button>
            </div>

            {/* Guia de Configuração */}
            {showConfigGuide && (
              <TokenConfigGuide onClose={() => setShowConfigGuide(false)} />
            )}

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

            {/* Status do token da conta selecionada */}
            {tokenInfo && !showNewForm && selectedAccountId && (
              <div className={`p-3 rounded-lg border ${
                tokenInfo.isExpired || !tokenInfo.isValid 
                  ? 'bg-destructive/10 border-destructive/20' 
                  : tokenInfo.daysUntilExpiry && tokenInfo.daysUntilExpiry <= 7
                    ? 'bg-warning/10 border-warning/20'
                    : 'bg-success/10 border-success/20'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {tokenInfo.isExpired || !tokenInfo.isValid ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : tokenInfo.daysUntilExpiry && tokenInfo.daysUntilExpiry <= 7 ? (
                      <Clock className="h-4 w-4 text-warning" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    )}
                    <span className="text-sm font-medium">
                      {tokenInfo.isExpired 
                        ? 'Token expirado' 
                        : !tokenInfo.isValid 
                          ? 'Token inválido'
                          : `Token válido`}
                    </span>
                  </div>
                  {getTokenStatusBadge(tokenInfo)}
                </div>
                
                {tokenInfo.expiresAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {tokenInfo.isExpired 
                      ? `Expirou em ${tokenInfo.expiresAt.toLocaleDateString('pt-BR')}`
                      : `Expira em ${tokenInfo.expiresAt.toLocaleDateString('pt-BR')} às ${tokenInfo.expiresAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    }
                  </p>
                )}
                
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">
                    {tokenInfo.type === 'long-lived' ? 'Longa duração' : tokenInfo.type === 'short-lived' ? 'Curta duração' : 'Tipo desconhecido'}
                  </Badge>
                  {tokenInfo.scopes.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {tokenInfo.scopes.length} permissões
                    </span>
                  )}
                </div>

                {(tokenInfo.isExpired || !tokenInfo.isValid) && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={openTokenGenerator}
                    className="mt-2 gap-2 w-full"
                  >
                    <Key className="h-4 w-4" />
                    Gerar Novo Token
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
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
                    <div className="flex gap-2">
                      <Input
                        id="token"
                        type="password"
                        placeholder="EAAG..."
                        value={accessToken}
                        onChange={(e) => {
                          setAccessToken(e.target.value);
                          setTokenInfo(null);
                        }}
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleValidateToken}
                        disabled={isValidatingToken || !accessToken.trim()}
                        title="Validar token"
                      >
                        {isValidatingToken ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {tokenInfo && (
                      <div className="flex items-center gap-2 mt-1">
                        {getTokenStatusBadge(tokenInfo)}
                      </div>
                    )}
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
              disabled={isLoading || (!accessToken.trim() || !accountId.trim()) || (tokenInfo?.isExpired)}
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

            {/* Info do token conectado */}
            {connectedTokenInfo && (
              <div className={`p-3 rounded-lg border ${
                connectedTokenInfo.daysUntilExpiry && connectedTokenInfo.daysUntilExpiry <= 7
                  ? 'bg-warning/10 border-warning/20'
                  : 'bg-muted/50 border-border'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Status do Token</span>
                  </div>
                  {getTokenStatusBadge(connectedTokenInfo)}
                </div>
                {connectedTokenInfo.expiresAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Expira em {connectedTokenInfo.expiresAt.toLocaleDateString('pt-BR')}
                  </p>
                )}
                
                {/* Botões para renovar/gerar token permanente */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {connectedTokenInfo.daysUntilExpiry && connectedTokenInfo.daysUntilExpiry <= 7 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={openTokenGenerator}
                      className="gap-2"
                    >
                      <Key className="h-4 w-4" />
                      Renovar Token
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => window.open('https://developers.facebook.com/tools/explorer/', '_blank')}
                    className="gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Gerar Token Permanente
                  </Button>
                </div>
              </div>
            )}
            
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
