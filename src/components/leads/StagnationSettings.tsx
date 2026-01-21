import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, RefreshCw, Settings2 } from 'lucide-react';
import { LeadStatus } from '@/hooks/useLeads';
import { StagnationThresholds } from '@/hooks/useStagnationAlerts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface StagnationSettingsProps {
  thresholds: StagnationThresholds;
  enabledStatuses: Record<LeadStatus, boolean>;
  onUpdateThreshold: (status: LeadStatus, days: number) => void;
  onToggleStatus: (status: LeadStatus, enabled: boolean) => void;
  onReset: () => void;
  stagnantCount: number;
}

const statusLabels: Record<LeadStatus, string> = {
  comment: 'Comentários',
  new: 'Em análise',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  not_qualified: 'Desqualificado',
  converted: 'Convertido',
  lost: 'Perdido',
};

const statusColors: Record<LeadStatus, string> = {
  comment: 'bg-pink-100 text-pink-700',
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  qualified: 'bg-green-100 text-green-700',
  not_qualified: 'bg-gray-100 text-gray-700',
  converted: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-red-100 text-red-700',
};

export const StagnationSettings = ({
  thresholds,
  enabledStatuses,
  onUpdateThreshold,
  onToggleStatus,
  onReset,
  stagnantCount,
}: StagnationSettingsProps) => {
  const statuses: LeadStatus[] = ['comment', 'new', 'contacted', 'qualified', 'not_qualified', 'converted', 'lost'];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <AlertTriangle className="h-4 w-4" />
          Alertas de Estagnação
          {stagnantCount > 0 && (
            <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">
              {stagnantCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Configurar Alertas de Estagnação
          </DialogTitle>
          <DialogDescription>
            Defina após quantos dias sem atividade um lead é considerado estagnado em cada estágio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {statuses.map((status) => (
            <Card key={status} className={`${enabledStatuses[status] ? '' : 'opacity-60'}`}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <Switch
                      checked={enabledStatuses[status]}
                      onCheckedChange={(checked) => onToggleStatus(status, checked)}
                    />
                    <div className={`px-2 py-1 rounded text-xs font-medium ${statusColors[status]}`}>
                      {statusLabels[status]}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`threshold-${status}`} className="text-sm text-muted-foreground whitespace-nowrap">
                      Após
                    </Label>
                    <Input
                      id={`threshold-${status}`}
                      type="number"
                      min={1}
                      max={365}
                      value={thresholds[status]}
                      onChange={(e) => onUpdateThreshold(status, parseInt(e.target.value) || 1)}
                      className="w-16 h-8 text-center"
                      disabled={!enabledStatuses[status]}
                    />
                    <span className="text-sm text-muted-foreground">dias</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={onReset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Restaurar Padrões
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
