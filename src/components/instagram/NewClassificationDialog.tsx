import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tag, Eye, EyeOff } from 'lucide-react';
import { classificationColors } from '@/hooks/useContactClassifications';

interface NewClassificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string, color: string, showInWorkflow: boolean) => Promise<any>;
  loading?: boolean;
}

export const NewClassificationDialog: React.FC<NewClassificationDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
}) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('bg-blue-500');
  const [showInWorkflow, setShowInWorkflow] = useState(true);

  const handleConfirm = async () => {
    if (!name.trim()) return;
    const result = await onConfirm(name, color, showInWorkflow);
    if (result) {
      setName('');
      setColor('bg-blue-500');
      setShowInWorkflow(true);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setName('');
    setColor('bg-blue-500');
    setShowInWorkflow(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Nova Classificação
          </DialogTitle>
          <DialogDescription>
            Crie uma nova classificação para seus contatos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="classification-name">Nome da classificação</Label>
            <Input
              id="classification-name"
              placeholder="Ex: Lead Quente, VIP, Interessado..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Cor</Label>
            <Select value={color} onValueChange={setColor}>
              <SelectTrigger>
                <SelectValue>
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full ${color}`} />
                    {classificationColors.find(c => c.value === color)?.label || 'Selecione'}
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {classificationColors.map((colorOption) => (
                  <SelectItem key={colorOption.value} value={colorOption.value}>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full ${colorOption.value}`} />
                      {colorOption.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
            <div className="flex items-center gap-3">
              {showInWorkflow ? (
                <Eye className="h-5 w-5 text-green-500" />
              ) : (
                <EyeOff className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium text-sm">Exibir para responder</p>
                <p className="text-xs text-muted-foreground">
                  {showInWorkflow 
                    ? 'Comentários com esta classificação aparecerão no workflow' 
                    : 'Comentários com esta classificação serão ocultos no workflow'}
                </p>
              </div>
            </div>
            <Switch
              checked={showInWorkflow}
              onCheckedChange={setShowInWorkflow}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim() || loading}>
            {loading ? 'Criando...' : 'Criar Classificação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
