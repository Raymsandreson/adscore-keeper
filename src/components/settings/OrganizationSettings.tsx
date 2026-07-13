import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { db } from '@/integrations/supabase';
import { toast } from 'sonner';
import { Save, Upload, Building2, Loader2 } from 'lucide-react';
import { useOrganization, type Organization } from '@/hooks/useOrganization';

type Form = Partial<Organization>;

const FIELDS: Array<{ key: keyof Organization; label: string; type?: 'textarea' }> = [
  { key: 'name', label: 'Nome do escritório' },
  { key: 'lawyer_name', label: 'Advogado responsável' },
  { key: 'oab_number', label: 'OAB' },
  { key: 'phone', label: 'Telefone' },
  { key: 'email', label: 'E-mail' },
  { key: 'website', label: 'Website' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'city', label: 'Cidade' },
  { key: 'state', label: 'Estado (UF)' },
  { key: 'address', label: 'Endereço', type: 'textarea' },
  { key: 'signature', label: 'Assinatura (rodapé de mensagens)', type: 'textarea' },
];

export function OrganizationSettings() {
  const { organization, loading, reload } = useOrganization();
  const [form, setForm] = useState<Form>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (organization) setForm(organization);
  }, [organization]);

  const set = <K extends keyof Organization>(k: K, v: Organization[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !organization) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${organization.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await (db as any).storage
        .from('org-logos')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data: pub } = (db as any).storage.from('org-logos').getPublicUrl(path);
      set('logo_url', pub.publicUrl);
      toast.success('Logo enviada. Clique em Salvar para confirmar.');
    } catch (err: any) {
      toast.error('Falha no upload: ' + (err.message || err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!organization) return;
    setSaving(true);
    const payload = { ...form };
    delete (payload as any).id;
    const { error } = await (db as any)
      .from('organizations')
      .update(payload)
      .eq('id', organization.id);
    setSaving(false);
    if (error) {
      toast.error('Erro ao salvar: ' + error.message);
      return;
    }
    toast.success('Configurações do escritório salvas.');
    reload();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!organization) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Nenhum escritório cadastrado.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Identidade
          </CardTitle>
          <CardDescription>Logo e status do escritório.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden">
              {form.logo_url ? (
                <img src={form.logo_url} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Enviar logo
              </Button>
              {form.logo_url && (
                <p className="text-xs text-muted-foreground break-all max-w-md">{form.logo_url}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Ativo</Label>
              <p className="text-xs text-muted-foreground">Escritório em operação.</p>
            </div>
            <Switch
              checked={!!form.is_active}
              onCheckedChange={(v) => set('is_active', v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados do escritório</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
              <Label htmlFor={f.key}>{f.label}</Label>
              {f.type === 'textarea' ? (
                <Textarea
                  id={f.key}
                  value={(form[f.key] as string) || ''}
                  onChange={(e) => set(f.key, e.target.value as any)}
                  rows={3}
                />
              ) : (
                <Input
                  id={f.key}
                  value={(form[f.key] as string) || ''}
                  onChange={(e) => set(f.key, e.target.value as any)}
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}
