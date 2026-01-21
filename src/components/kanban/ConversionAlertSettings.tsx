import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Bell, BellOff, Settings2, Save, ChevronDown, AlertTriangle } from 'lucide-react';
import { KanbanBoard } from '@/hooks/useKanbanBoards';
import { BoardConversionSettings, ConversionThreshold } from '@/hooks/useConversionAlerts';

interface ConversionAlertSettingsProps {
  board: KanbanBoard;
  settings: BoardConversionSettings | null;
  onSave: (settings: BoardConversionSettings) => void;
  currentAlerts: Array<{
    fromStage: string;
    toStage: string;
    currentRate: number;
    threshold: number;
    severity: 'warning' | 'critical';
  }>;
}

export function ConversionAlertSettings({
  board,
  settings,
  onSave,
  currentAlerts,
}: ConversionAlertSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<BoardConversionSettings>({
    boardId: board.id,
    enabled: true,
    globalMinRate: 30,
    stageThresholds: [],
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const handleSave = () => {
    onSave(localSettings);
  };

  const getStageThreshold = (fromId: string, toId: string): number => {
    const found = localSettings.stageThresholds.find(
      t => t.stageFromId === fromId && t.stageToId === toId
    );
    return found?.minRate ?? localSettings.globalMinRate;
  };

  const setStageThreshold = (fromId: string, toId: string, value: number | null) => {
    const newThresholds = localSettings.stageThresholds.filter(
      t => !(t.stageFromId === fromId && t.stageToId === toId)
    );
    
    if (value !== null) {
      newThresholds.push({
        stageFromId: fromId,
        stageToId: toId,
        minRate: value,
      });
    }
    
    setLocalSettings(prev => ({
      ...prev,
      stageThresholds: newThresholds,
    }));
  };

  const stages = board.stages || [];
  const hasAlerts = currentAlerts.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${localSettings.enabled ? 'bg-primary/10' : 'bg-muted'}`}>
                  {localSettings.enabled ? (
                    <Bell className="h-4 w-4 text-primary" />
                  ) : (
                    <BellOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium">Alertas de Conversão</CardTitle>
                    {hasAlerts && (
                      <Badge variant="destructive" className="text-[10px] px-1.5">
                        {currentAlerts.length} {currentAlerts.length === 1 ? 'alerta' : 'alertas'}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    Configure limites mínimos de conversão entre estágios
                  </CardDescription>
                </div>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Alertas Ativos</span>
                <span className="text-xs text-muted-foreground">
                  {localSettings.enabled ? 'Monitorando taxas de conversão' : 'Alertas desativados'}
                </span>
              </div>
              <Switch
                checked={localSettings.enabled}
                onCheckedChange={(checked) => 
                  setLocalSettings(prev => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {/* Current Alerts Panel */}
            {hasAlerts && (
              <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">Alertas Ativos</span>
                </div>
                <div className="space-y-1">
                  {currentAlerts.map((alert, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {alert.fromStage} → {alert.toStage}
                      </span>
                      <span className={alert.severity === 'critical' ? 'text-destructive font-medium' : 'text-orange-500'}>
                        {alert.currentRate}% (min: {alert.threshold}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Global Threshold */}
            <div className="space-y-2">
              <Label className="text-sm">Taxa Mínima Global (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={localSettings.globalMinRate}
                onChange={(e) => 
                  setLocalSettings(prev => ({
                    ...prev,
                    globalMinRate: parseInt(e.target.value) || 0
                  }))
                }
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">
                Valor padrão aplicado a todas as transições entre estágios
              </p>
            </div>

            {/* Per-Stage Thresholds */}
            {stages.length > 1 && (
              <div className="space-y-3">
                <Label className="text-sm">Limites por Transição</Label>
                <div className="space-y-2">
                  {stages.slice(0, -1).map((fromStage, idx) => {
                    const toStage = stages[idx + 1];
                    const currentThreshold = getStageThreshold(fromStage.id, toStage.id);
                    const isCustom = localSettings.stageThresholds.some(
                      t => t.stageFromId === fromStage.id && t.stageToId === toStage.id
                    );
                    const alert = currentAlerts.find(
                      a => a.fromStage === fromStage.name && a.toStage === toStage.name
                    );

                    return (
                      <div 
                        key={`${fromStage.id}_${toStage.id}`}
                        className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                          alert ? 'bg-destructive/10 border border-destructive/20' : 'bg-muted/30'
                        }`}
                      >
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <div 
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: fromStage.color }}
                          />
                          <span className="text-xs truncate">{fromStage.name}</span>
                          <span className="text-xs text-muted-foreground">→</span>
                          <div 
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: toStage.color }}
                          />
                          <span className="text-xs truncate">{toStage.name}</span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={currentThreshold}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              if (!isNaN(value)) {
                                setStageThreshold(fromStage.id, toStage.id, value);
                              }
                            }}
                            className="w-16 h-7 text-xs text-center"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                          {isCustom && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => setStageThreshold(fromStage.id, toStage.id, null)}
                            >
                              Reset
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Button onClick={handleSave} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Salvar Configurações
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
