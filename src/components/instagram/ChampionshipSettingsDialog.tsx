import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Settings, AtSign, MessageCircle, Medal, Trophy, Crown, Bell, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ChampionshipSettings {
  id?: string;
  points_per_mention: number;
  points_per_comment: number;
  bronze_threshold: number;
  silver_threshold: number;
  gold_threshold: number;
  diamond_threshold: number;
  notify_on_rank_change: boolean;
  notify_on_new_champion: boolean;
}

interface ChampionshipSettingsDialogProps {
  settings: ChampionshipSettings;
  onSettingsUpdate: (settings: ChampionshipSettings) => void;
}

export const ChampionshipSettingsDialog: React.FC<ChampionshipSettingsDialogProps> = ({
  settings,
  onSettingsUpdate,
}) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<ChampionshipSettings>(settings);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const handleSave = async () => {
    // Validate thresholds
    if (formData.silver_threshold <= formData.bronze_threshold) {
      toast.error('Limite Prata deve ser maior que Bronze');
      return;
    }
    if (formData.gold_threshold <= formData.silver_threshold) {
      toast.error('Limite Ouro deve ser maior que Prata');
      return;
    }
    if (formData.diamond_threshold <= formData.gold_threshold) {
      toast.error('Limite Diamante deve ser maior que Ouro');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('engagement_championship_settings')
        .update({
          points_per_mention: formData.points_per_mention,
          points_per_comment: formData.points_per_comment,
          bronze_threshold: formData.bronze_threshold,
          silver_threshold: formData.silver_threshold,
          gold_threshold: formData.gold_threshold,
          diamond_threshold: formData.diamond_threshold,
          notify_on_rank_change: formData.notify_on_rank_change,
          notify_on_new_champion: formData.notify_on_new_champion,
        })
        .eq('id', settings.id)
        .select()
        .single();

      if (error) throw error;

      onSettingsUpdate(data as unknown as ChampionshipSettings);
      toast.success('Configurações salvas com sucesso!');
      setOpen(false);
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="w-4 h-4 mr-2" />
          Configurar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configurações do Campeonato
          </DialogTitle>
          <DialogDescription>
            Personalize os pontos e níveis do campeonato de engajamento
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Points Section */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-500" />
              Sistema de Pontos
            </h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="points_mention" className="flex items-center gap-2">
                  <AtSign className="w-4 h-4 text-primary" />
                  Pontos por Menção
                </Label>
                <Input
                  id="points_mention"
                  type="number"
                  min={1}
                  value={formData.points_per_mention}
                  onChange={(e) => setFormData({ ...formData, points_per_mention: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="points_comment" className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-blue-500" />
                  Pontos por Comentário
                </Label>
                <Input
                  id="points_comment"
                  type="number"
                  min={1}
                  value={formData.points_per_comment}
                  onChange={(e) => setFormData({ ...formData, points_per_comment: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Badge Thresholds */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Medal className="w-4 h-4" />
              Níveis de Badge (pontos mínimos)
            </h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bronze" className="flex items-center gap-2">
                  <Medal className="w-4 h-4 text-amber-700" />
                  Bronze
                </Label>
                <Input
                  id="bronze"
                  type="number"
                  min={0}
                  value={formData.bronze_threshold}
                  onChange={(e) => setFormData({ ...formData, bronze_threshold: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="silver" className="flex items-center gap-2">
                  <Medal className="w-4 h-4 text-slate-400" />
                  Prata
                </Label>
                <Input
                  id="silver"
                  type="number"
                  min={1}
                  value={formData.silver_threshold}
                  onChange={(e) => setFormData({ ...formData, silver_threshold: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="gold" className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  Ouro
                </Label>
                <Input
                  id="gold"
                  type="number"
                  min={1}
                  value={formData.gold_threshold}
                  onChange={(e) => setFormData({ ...formData, gold_threshold: parseInt(e.target.value) || 0 })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="diamond" className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-cyan-400" />
                  Diamante
                </Label>
                <Input
                  id="diamond"
                  type="number"
                  min={1}
                  value={formData.diamond_threshold}
                  onChange={(e) => setFormData({ ...formData, diamond_threshold: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Notifications */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-500" />
              Notificações
            </h4>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="notify_rank" className="flex-1">
                  Notificar mudança de posição no ranking
                </Label>
                <Switch
                  id="notify_rank"
                  checked={formData.notify_on_rank_change}
                  onCheckedChange={(checked) => setFormData({ ...formData, notify_on_rank_change: checked })}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="notify_champion" className="flex-1">
                  Notificar novo campeão semanal
                </Label>
                <Switch
                  id="notify_champion"
                  checked={formData.notify_on_new_champion}
                  onCheckedChange={(checked) => setFormData({ ...formData, notify_on_new_champion: checked })}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
