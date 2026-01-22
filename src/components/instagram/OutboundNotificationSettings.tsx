import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Bell, BellOff, BellRing, MessageCircleReply, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useOutboundNotifications } from '@/hooks/useOutboundNotifications';

export function OutboundNotificationSettings() {
  const { 
    isSupported, 
    permission, 
    isEnabled, 
    toggleNotifications,
    checkForNewReplies
  } = useOutboundNotifications();

  const getPermissionBadge = () => {
    if (!isSupported) {
      return (
        <Badge variant="outline" className="bg-gray-100 text-gray-600">
          <XCircle className="h-3 w-3 mr-1" />
          Não suportado
        </Badge>
      );
    }

    switch (permission) {
      case 'granted':
        return (
          <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Permitido
          </Badge>
        );
      case 'denied':
        return (
          <Badge variant="outline" className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
            <XCircle className="h-3 w-3 mr-1" />
            Bloqueado
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300">
            <AlertCircle className="h-3 w-3 mr-1" />
            Não solicitado
          </Badge>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-5 w-5 text-primary" />
          Notificações de Respostas Outbound
        </CardTitle>
        <CardDescription>
          Receba notificações quando prospects responderem seus comentários
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Status da permissão</Label>
            <p className="text-xs text-muted-foreground">
              {permission === 'denied' 
                ? 'Desbloqueie nas configurações do navegador'
                : 'Permissão do navegador para enviar notificações'}
            </p>
          </div>
          {getPermissionBadge()}
        </div>

        {isSupported && permission !== 'denied' && (
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-3">
              {isEnabled ? (
                <Bell className="h-5 w-5 text-primary" />
              ) : (
                <BellOff className="h-5 w-5 text-muted-foreground" />
              )}
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Notificações ativadas</Label>
                <p className="text-xs text-muted-foreground">
                  Receba alertas push de respostas outbound
                </p>
              </div>
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={toggleNotifications}
            />
          </div>
        )}

        {isEnabled && permission === 'granted' && (
          <div className="pt-2 border-t space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <MessageCircleReply className="h-5 w-5 text-green-500 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Monitoramento ativo</p>
                <p className="text-xs text-muted-foreground">
                  Você receberá uma notificação sempre que alguém responder a um comentário 
                  que você fez em posts de terceiros (prospecção outbound).
                </p>
              </div>
            </div>
            
            <Button 
              variant="outline" 
              size="sm" 
              onClick={checkForNewReplies}
              className="w-full"
            >
              <Bell className="h-4 w-4 mr-2" />
              Verificar novas respostas agora
            </Button>
          </div>
        )}

        {permission === 'denied' && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">
              As notificações foram bloqueadas. Para reativar, vá nas configurações do seu navegador 
              e permita notificações para este site.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
