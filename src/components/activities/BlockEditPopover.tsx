import { useState } from 'react';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AvailableType = { key: string; label: string; color: string };
export type UserTeam = { id: string; name: string; color?: string };

const COLOR_OPTIONS = [
  'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500',
  'bg-orange-500', 'bg-red-500', 'bg-teal-500', 'bg-indigo-500', 'bg-cyan-500',
  'bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-lime-500', 'bg-sky-500',
  'bg-violet-500', 'bg-fuchsia-500',
];

interface Props {
  open: boolean;
  anchorRect: DOMRect | null;
  currentTypeKey: string;
  availableTypes: AvailableType[];
  userTeams: UserTeam[];
  onSelectType: (t: AvailableType) => void;
  onAddType: (label: string, color: string, teamIds: string[]) => Promise<AvailableType | null>;
  onClose: () => void;
}

export function BlockEditPopover({
  open, anchorRect, currentTypeKey, availableTypes, userTeams, onSelectType, onAddType, onClose,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('bg-teal-500');
  const [scope, setScope] = useState<'global' | 'teams'>(userTeams.length === 0 ? 'global' : 'global');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    const teamIds = scope === 'teams' ? selectedTeams : [];
    const created = await onAddType(newLabel.trim(), newColor, teamIds);
    setSaving(false);
    if (created) {
      onSelectType({ key: created.key, label: created.label, color: created.color });
      setAddOpen(false);
      setNewLabel('');
      setSelectedTeams([]);
      setScope('global');
    }
  };

  return (
    <>
      <Popover open={open && !addOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
        <PopoverAnchor asChild>
          <div
            style={{
              position: 'fixed',
              left: anchorRect?.left ?? 0,
              top: anchorRect?.top ?? 0,
              width: anchorRect?.width ?? 0,
              height: anchorRect?.height ?? 0,
              pointerEvents: 'none',
            }}
          />
        </PopoverAnchor>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="text-xs font-semibold text-muted-foreground px-1 pb-1">Mudar tipo</div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {availableTypes.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => { onSelectType(t); onClose(); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-left text-sm"
              >
                <span className={cn('h-3 w-3 rounded-full', t.color)} />
                <span className="flex-1 truncate">{t.label}</span>
                {t.key === currentTypeKey && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full mt-2 gap-1.5 h-8"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar novo tipo
          </Button>
        </PopoverContent>
      </Popover>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo tipo de atividade</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Ex: Reunião com cliente"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Cor</Label>
              <div className="grid grid-cols-9 gap-1.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={cn(
                      'h-7 w-7 rounded-full transition-all',
                      c,
                      newColor === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : 'opacity-70 hover:opacity-100'
                    )}
                  />
                ))}
              </div>
            </div>

            {userTeams.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Vínculo</Label>
                <RadioGroup value={scope} onValueChange={(v) => setScope(v as any)}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="global" id="scope-global" />
                    <Label htmlFor="scope-global" className="font-normal cursor-pointer text-sm">
                      Global (todos os times)
                    </Label>
                  </div>
                  {userTeams.length === 1 ? (
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="teams" id="scope-team" />
                      <Label htmlFor="scope-team" className="font-normal cursor-pointer text-sm">
                        Apenas o time <strong>{userTeams[0].name}</strong>
                      </Label>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="teams" id="scope-teams" />
                      <Label htmlFor="scope-teams" className="font-normal cursor-pointer text-sm">
                        Times específicos
                      </Label>
                    </div>
                  )}
                </RadioGroup>

                {scope === 'teams' && userTeams.length > 1 && (
                  <div className="ml-6 space-y-1.5 pt-1">
                    {userTeams.map(team => (
                      <div key={team.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`team-${team.id}`}
                          checked={selectedTeams.includes(team.id)}
                          onCheckedChange={(checked) => {
                            setSelectedTeams(prev =>
                              checked ? [...prev, team.id] : prev.filter(id => id !== team.id)
                            );
                          }}
                        />
                        <Label htmlFor={`team-${team.id}`} className="font-normal cursor-pointer text-sm">
                          {team.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
                {scope === 'teams' && userTeams.length === 1 && (
                  <input type="hidden" value={userTeams[0].id} ref={() => {
                    if (selectedTeams.length === 0) setSelectedTeams([userTeams[0].id]);
                  }} />
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                !newLabel.trim() ||
                saving ||
                (scope === 'teams' && userTeams.length > 1 && selectedTeams.length === 0)
              }
            >
              {saving ? 'Criando...' : 'Criar e usar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
