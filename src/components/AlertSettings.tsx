import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Bell, BellOff, Settings2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { AlertThresholds } from '@/hooks/useMetricAlerts';

interface AlertSettingsProps {
  getThresholds: () => AlertThresholds;
  saveThresholds: (thresholds: AlertThresholds) => void;
  requestNotificationPermission: () => Promise<boolean>;
  hasNotificationPermission: boolean;
}

const AlertSettings = ({
  getThresholds,
  saveThresholds,
  requestNotificationPermission,
  hasNotificationPermission,
}: AlertSettingsProps) => {
  const [thresholds, setThresholds] = useState<AlertThresholds>(getThresholds());
  const [isExpanded, setIsExpanded] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(hasNotificationPermission);

  useEffect(() => {
    setPushEnabled(hasNotificationPermission);
  }, [hasNotificationPermission]);

  const handleSave = () => {
    saveThresholds(thresholds);
    toast.success('Configurações salvas', { description: 'Limites de alerta atualizados com sucesso' });
  };

  const handleEnablePush = async () => {
    const granted = await requestNotificationPermission();
    setPushEnabled(granted);
    if (granted) {
      toast.success('Push habilitado', { description: 'Você receberá notificações do navegador' });
    } else {
      toast.error('Permissão negada', { description: 'Habilite notificações nas configurações do navegador' });
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader 
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Alertas de Métricas</CardTitle>
              <CardDescription>Configure notificações para limites críticos</CardDescription>
            </div>
          </div>
          <Settings2 className={`h-5 w-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {/* Push Notification Toggle */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              {pushEnabled ? (
                <Bell className="h-5 w-5 text-primary" />
              ) : (
                <BellOff className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium">Push do Navegador</p>
                <p className="text-sm text-muted-foreground">
                  Receba alertas mesmo com o app minimizado
                </p>
              </div>
            </div>
            {pushEnabled ? (
              <span className="text-sm text-primary font-medium">Ativo</span>
            ) : (
              <Button variant="outline" size="sm" onClick={handleEnablePush}>
                Habilitar
              </Button>
            )}
          </div>

          {/* Threshold Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cpcMax">CPC Máximo (R$)</Label>
              <Input
                id="cpcMax"
                type="number"
                step="0.1"
                min="0"
                value={thresholds.cpcMax}
                onChange={(e) => setThresholds(prev => ({ ...prev, cpcMax: parseFloat(e.target.value) || 0 }))}
                placeholder="3.00"
              />
              <p className="text-xs text-muted-foreground">Alertar quando CPC ultrapassar</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ctrMin">CTR Mínimo (%)</Label>
              <Input
                id="ctrMin"
                type="number"
                step="0.1"
                min="0"
                value={thresholds.ctrMin}
                onChange={(e) => setThresholds(prev => ({ ...prev, ctrMin: parseFloat(e.target.value) || 0 }))}
                placeholder="1.0"
              />
              <p className="text-xs text-muted-foreground">Alertar quando CTR cair abaixo</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="spendMax">Gasto Máximo (R$)</Label>
              <Input
                id="spendMax"
                type="number"
                step="100"
                min="0"
                value={thresholds.spendMax}
                onChange={(e) => setThresholds(prev => ({ ...prev, spendMax: parseFloat(e.target.value) || 0 }))}
                placeholder="10000"
              />
              <p className="text-xs text-muted-foreground">Alertar quando gasto total ultrapassar</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="conversionRateMin">Conversão Mínima (%)</Label>
              <Input
                id="conversionRateMin"
                type="number"
                step="0.1"
                min="0"
                value={thresholds.conversionRateMin}
                onChange={(e) => setThresholds(prev => ({ ...prev, conversionRateMin: parseFloat(e.target.value) || 0 }))}
                placeholder="1.0"
              />
              <p className="text-xs text-muted-foreground">Alertar quando conversão cair abaixo</p>
            </div>
          </div>

          <Button onClick={handleSave} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            Salvar Configurações
          </Button>
        </CardContent>
      )}
    </Card>
  );
};

export default AlertSettings;
