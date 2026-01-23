import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Settings, Eye, EyeOff } from 'lucide-react';
import { useContactClassifications, ContactClassificationRecord } from '@/hooks/useContactClassifications';

interface ClassificationWorkflowSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ClassificationWorkflowSettings: React.FC<ClassificationWorkflowSettingsProps> = ({
  open,
  onOpenChange,
}) => {
  const { classifications, updateClassification, loading } = useContactClassifications();

  const handleToggleWorkflow = async (classification: ContactClassificationRecord) => {
    await updateClassification(classification.id, {
      show_in_workflow: !classification.show_in_workflow
    });
  };

  const visibleCount = classifications.filter(c => c.show_in_workflow).length;
  const hiddenCount = classifications.filter(c => !c.show_in_workflow).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configurar Visibilidade no Workflow
          </DialogTitle>
          <DialogDescription>
            Configure quais classificações de contatos devem aparecer para ser respondidos no workflow de respostas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4 py-2 border-b">
          <Badge variant="outline" className="gap-1">
            <Eye className="h-3 w-3" />
            {visibleCount} visíveis
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <EyeOff className="h-3 w-3" />
            {hiddenCount} ocultos
          </Badge>
        </div>

        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {classifications.map((classification) => {
              const label = classification.name === 'client' ? 'Cliente' :
                classification.name === 'non_client' ? 'Não-Cliente' :
                classification.name === 'prospect' ? 'Prospect' :
                classification.name === 'partner' ? 'Parceiro' :
                classification.name === 'supplier' ? 'Fornecedor' :
                classification.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

              return (
                <div
                  key={classification.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${classification.color}`} />
                    <span className="font-medium">{label}</span>
                    {classification.is_system && (
                      <Badge variant="outline" className="text-xs">Sistema</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {classification.show_in_workflow ? (
                      <Eye className="h-4 w-4 text-green-500" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Switch
                      checked={classification.show_in_workflow}
                      onCheckedChange={() => handleToggleWorkflow(classification)}
                      disabled={loading}
                    />
                  </div>
                </div>
              );
            })}

            {classifications.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma classificação encontrada
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="text-xs text-muted-foreground pt-2 border-t">
          Comentários de contatos com classificações ocultas não aparecerão para resposta no modo workflow.
        </div>
      </DialogContent>
    </Dialog>
  );
};
