import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Settings, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMetaAPI } from "@/hooks/useMetaAPI";

interface BMConnectionProps {
  onConnectionChange: (connected: boolean) => void;
}

const BMConnection = ({ onConnectionChange }: BMConnectionProps) => {
  const [accessToken, setAccessToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const { toast } = useToast();
  const { isConnected, isLoading, error, connectToMeta, disconnect, refreshMetrics } = useMetaAPI();

  const handleConnect = async () => {
    if (!accessToken.trim() || !accountId.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o Access Token e Account ID",
        variant: "destructive",
      });
      return;
    }

    const success = await connectToMeta({
      accessToken: accessToken.trim(),
      accountId: accountId.trim()
    });

    if (success) {
      onConnectionChange(true);
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
    disconnect();
    onConnectionChange(false);
    setAccessToken("");
    setAccountId("");
    toast({
      title: "Desconectado",
      description: "Conexão com Meta Business Manager encerrada",
    });
  };

  const handleRefresh = async () => {
    await refreshMetrics();
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
              <Wifi className="h-6 w-6 text-success animate-pulse" />
              <span>Meta Business Manager</span>
              <Badge variant="default" className="bg-success text-success-foreground">
                Conectado
              </Badge>
            </>
          ) : (
            <>
              <WifiOff className="h-6 w-6 text-muted-foreground" />
              <span>Meta Business Manager</span>
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
                <strong>Como obter seus dados:</strong>
                <ol className="mt-1 ml-4 list-decimal text-xs text-muted-foreground">
                  <li>Acesse o Meta Business Manager</li>
                  <li>Vá em Configurações → Usuários do sistema</li>
                  <li>Gere um Access Token com permissões de leitura</li>
                  <li>Copie o ID da sua conta de anúncios</li>
                </ol>
              </div>
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
              onClick={handleConnect}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? "Conectando..." : "Conectar ao Meta BM"}
            </Button>
            
            {error && (
              <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg p-3">
                <strong>Erro:</strong> {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-success/10 border border-success/20 rounded-lg">
              <div>
                <p className="text-sm font-medium">Status: Coletando dados reais da Meta API</p>
                <p className="text-xs text-muted-foreground">Atualização automática a cada 30 segundos</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleRefresh}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Atualizar
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                  Desconectar
                </Button>
              </div>
            </div>
            
            <div className="text-xs text-muted-foreground">
              <strong>Conta conectada:</strong> {accountId} | <strong>Intervalo de atualização:</strong> 3 segundos
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BMConnection;