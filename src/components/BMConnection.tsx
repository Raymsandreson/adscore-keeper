import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Settings, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BMConnectionProps {
  isConnected: boolean;
  onConnectionChange: (connected: boolean) => void;
}

const BMConnection = ({ isConnected, onConnectionChange }: BMConnectionProps) => {
  const [accessToken, setAccessToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  const handleConnect = async () => {
    if (!accessToken.trim() || !accountId.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o Access Token e Account ID",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    
    // Simular conexão com delay
    setTimeout(() => {
      onConnectionChange(true);
      setIsConnecting(false);
      toast({
        title: "✅ Conectado com sucesso!",
        description: "Dados do Meta Business Manager sendo coletados em tempo real",
      });
    }, 2000);
  };

  const handleDisconnect = () => {
    onConnectionChange(false);
    setAccessToken("");
    setAccountId("");
    toast({
      title: "Desconectado",
      description: "Conexão com Meta Business Manager encerrada",
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
              disabled={isConnecting}
              className="w-full"
            >
              {isConnecting ? "Conectando..." : "Conectar ao Meta BM"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-success/10 border border-success/20 rounded-lg">
              <div>
                <p className="text-sm font-medium">Status: Coletando dados em tempo real</p>
                <p className="text-xs text-muted-foreground">Última atualização: agora</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Configurar
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