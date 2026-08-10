import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Crown, KeyRound, Loader2, RefreshCw, Shield, User } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { MODULE_DEFINITIONS, AccessLevel } from '@/hooks/useModulePermissions';
import { generateTempPassword, validateTempPassword } from '@/lib/tempPassword';
import { applyAccessProfile, AccessProfileLike } from '@/lib/applyAccessProfile';
import { TempPasswordDialog } from './TempPasswordDialog';

interface Props {
  accessProfiles: AccessProfileLike[];
  whatsappInstances: Array<{ id: string; instance_name: string }>;
  onCreated: () => void;
}

export function DirectAccessForm({ accessProfiles, whatsappInstances, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState(() => generateTempPassword());
  const [profileId, setProfileId] = useState('');
  const [showPermissions, setShowPermissions] = useState(false);
  const [modules, setModules] = useState<Record<string, AccessLevel>>(() => {
    const init: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach((m) => { init[m.key] = 'none'; });
    return init;
  });
  const [instances, setInstances] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);

  const profile = accessProfiles.find((p) => p.id === profileId);
  const isSystem = !!profile?.is_system;

  const handleProfileSelect = (id: string) => {
    setProfileId(id);
    const p = accessProfiles.find((x) => x.id === id);
    const mods: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach((m) => { mods[m.key] = 'none'; });
    (p?.module_permissions || []).forEach((mp) => {
      mods[mp.module_key] = mp.access_level as AccessLevel;
    });
    setModules(mods);
    setInstances(p?.whatsapp_instance_ids || []);
    setShowPermissions(false);
  };

  const handleCreate = async () => {
    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error('E-mail inválido');
      return;
    }
    if (!profileId || !profile) {
      toast.error('Selecione um perfil de acesso');
      return;
    }
    const pwError = validateTempPassword(password);
    if (pwError) {
      toast.error(pwError);
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await cloudFunctions.invoke('create-cloud-user', {
        body: { email: normalizedEmail, password, full_name: fullName.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const userId = (data as any)?.user_id as string | undefined;
      if (!userId) throw new Error('Não foi possível obter o usuário criado');

      // No fluxo direto não existe convite, então as permissões precisam ser aplicadas aqui.
      await applyAccessProfile(userId, {
        ...profile,
        module_permissions: isSystem
          ? []
          : Object.entries(modules)
              .filter(([, level]) => level !== 'none')
              .map(([module_key, access_level]) => ({ module_key, access_level })),
        whatsapp_instance_ids: isSystem ? [] : instances,
      });

      setResult({ email: normalizedEmail, password });
      toast.success(
        (data as any)?.status === 'password_reset'
          ? 'Conta já existia — senha redefinida e perfil aplicado'
          : 'Acesso criado com perfil aplicado'
      );
      setEmail('');
      setFullName('');
      setPassword(generateTempPassword());
      setProfileId('');
      setShowPermissions(false);
      onCreated();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao criar acesso');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <Label>Nome completo</Label>
          <Input
            placeholder="Nome da pessoa"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <Label>Perfil de Acesso</Label>
          <Select value={profileId} onValueChange={handleProfileSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um perfil..." />
            </SelectTrigger>
            <SelectContent>
              {accessProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    {p.is_system ? <Crown className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Senha provisória</Label>
          <div className="flex gap-2">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Gerar nova senha"
              onClick={() => setPassword(generateTempPassword())}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sem caracteres ambíguos (l, I, 1, O, 0).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {profileId && !isSystem && (
          <Button type="button" variant="outline" onClick={() => setShowPermissions(!showPermissions)}>
            <Shield className="h-4 w-4 mr-2" />
            {showPermissions ? 'Ocultar Acessos' : 'Ver Acessos'}
          </Button>
        )}
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <KeyRound className="h-4 w-4 mr-2" />
          )}
          Criar acesso
        </Button>
      </div>

      {showPermissions && profileId && !isSystem && (
        <div className="border rounded-lg p-4 space-y-5 bg-muted/30">
          <div>
            <Label className="text-sm font-semibold mb-3 block">Módulos</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {MODULE_DEFINITIONS.map((mod) => (
                <div
                  key={mod.key}
                  className="flex items-center justify-between rounded-md border px-3 py-2 bg-background"
                >
                  <span className="text-sm">{mod.label}</span>
                  <Select
                    value={modules[mod.key] || 'none'}
                    onValueChange={(v) => setModules((prev) => ({ ...prev, [mod.key]: v as AccessLevel }))}
                  >
                    <SelectTrigger className="w-24 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem acesso</SelectItem>
                      <SelectItem value="view">Ver</SelectItem>
                      <SelectItem value="edit">Editar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          {whatsappInstances.length > 0 && (
            <div>
              <Label className="text-sm font-semibold mb-3 block">Instâncias WhatsApp</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {whatsappInstances.map((inst) => (
                  <label
                    key={inst.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 bg-background cursor-pointer hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={instances.includes(inst.id)}
                      onCheckedChange={(checked) =>
                        setInstances((prev) =>
                          checked ? [...prev, inst.id] : prev.filter((id) => id !== inst.id)
                        )
                      }
                    />
                    <span className="text-sm">{inst.instance_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <TempPasswordDialog
        open={!!result}
        onOpenChange={(o) => { if (!o) setResult(null); }}
        email={result?.email || ''}
        password={result?.password || ''}
        title="Acesso criado"
      />
    </div>
  );
}
