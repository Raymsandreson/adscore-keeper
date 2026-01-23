import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { RotateCcw, Eye, Tag, Users, Link2, UserCheck } from 'lucide-react';
import type { CommentCardFieldsConfig } from '@/hooks/useCommentCardSettings';

interface CommentCardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: CommentCardFieldsConfig;
  onUpdateField: (field: keyof CommentCardFieldsConfig, value: boolean) => void;
  onReset: () => void;
}

export const CommentCardSettingsDialog: React.FC<CommentCardSettingsDialogProps> = ({
  open,
  onOpenChange,
  config,
  onUpdateField,
  onReset
}) => {
  const fields: { key: keyof CommentCardFieldsConfig; label: string; description: string; icon: React.ReactNode }[] = [
    {
      key: 'followerStatus',
      label: 'Status de Seguidor',
      description: 'Exibir se o usuário te segue, você segue ou mútuo',
      icon: <UserCheck className="h-4 w-4" />
    },
    {
      key: 'classification',
      label: 'Classificação',
      description: 'Exibir as classificações do contato',
      icon: <Tag className="h-4 w-4" />
    },
    {
      key: 'linkedLeads',
      label: 'Leads Vinculados',
      description: 'Exibir leads associados ou "Não vinculado"',
      icon: <Link2 className="h-4 w-4" />
    },
    {
      key: 'connections',
      label: 'Conexões',
      description: 'Exibir relacionamentos com outros contatos',
      icon: <Users className="h-4 w-4" />
    }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Configurar Cards de Comentários
          </DialogTitle>
          <DialogDescription>
            Escolha quais informações exibir nos cards de comentários
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {fields.map(field => (
            <div
              key={field.key}
              className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-background text-muted-foreground">
                  {field.icon}
                </div>
                <div>
                  <Label htmlFor={field.key} className="font-medium cursor-pointer">
                    {field.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                </div>
              </div>
              <Switch
                id={field.key}
                checked={config[field.key]}
                onCheckedChange={(checked) => onUpdateField(field.key, checked)}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Restaurar Padrões
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
