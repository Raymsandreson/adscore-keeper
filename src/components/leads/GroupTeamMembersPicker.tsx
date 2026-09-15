/**
 * Quem da equipe entra no grupo do WhatsApp do lead.
 *
 * O edge `create-whatsapp-group` monta a lista de participantes a partir das
 * INSTÂNCIAS (board_group_instances, instância do acolhedor, instâncias
 * obrigatórias). Quem não tem instância — a maioria da equipe, como o Renan —
 * não entra em grupo nenhum por esse caminho, mesmo tendo telefone no cadastro.
 * Este seletor cobre exatamente esse buraco: lista os membros da equipe que têm
 * `profiles.phone` preenchido e devolve os números escolhidos, que entram no
 * grupo logo depois que ele é criado.
 *
 * Quem não tem telefone no cadastro aparece desabilitado, com o motivo — some
 * da lista seria pior: o usuário procuraria a pessoa e não acharia explicação.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronDown, Loader2, Search, UserPlus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

export interface TeamPhoneOption {
  userId: string;
  name: string;
  /** Só dígitos (ex.: 5586998480810). Vazio = sem telefone no cadastro. */
  phone: string;
}

/** "5586998480810" → "+55 86 99848-0810"; o que não couber no padrão volta cru. */
export function formatTeamPhone(digits: string): string {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return d;
}

/**
 * Membros da equipe (user_roles do Cloud) com o telefone do perfil. Mesma fonte
 * da tela Gestão de Equipe — é lá que o número é cadastrado.
 */
export async function fetchTeamPhoneOptions(): Promise<TeamPhoneOption[]> {
  // `user_roles` define quem é da equipe, mas é tabela de permissão e pode não
  // ser legível por todo perfil. Sem ela a lista não pode sumir: o fallback é
  // quem tem telefone no cadastro — que é exatamente quem serve aqui.
  let ids: string[] = [];
  try {
    const { data: roles } = await supabase.from('user_roles').select('user_id');
    ids = [...new Set((roles || []).map((r: any) => r.user_id).filter(Boolean))];
  } catch { /* cai no fallback abaixo */ }

  const base = supabase.from('profiles').select('user_id, full_name, email, phone');
  const { data: profiles, error } = ids.length > 0
    ? await base.in('user_id', ids)
    : await base.not('phone', 'is', null).limit(200);
  if (error) throw error;

  return (profiles || [])
    .map((p: any) => ({
      userId: String(p.user_id),
      name: String(p.full_name || p.email || 'Sem nome'),
      phone: String(p.phone || '').replace(/\D/g, ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

interface Props {
  /** Telefones (só dígitos) escolhidos. */
  value: string[];
  onChange: (phones: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function GroupTeamMembersPicker({ value, onChange, disabled, className }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<TeamPhoneOption[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTeamPhoneOptions()
      .then((rows) => { if (!cancelled) { setOptions(rows); setError(null); } })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Falha ao carregar a equipe'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.name.toLowerCase().includes(q) || o.phone.includes(q.replace(/\D/g, '')));
  }, [options, query]);

  const selectedOptions = useMemo(
    () => options.filter(o => o.phone && selected.has(o.phone)),
    [options, selected]
  );

  const toggle = (phone: string) => {
    if (!phone) return;
    onChange(selected.has(phone) ? value.filter(p => p !== phone) : [...value, phone]);
  };

  const semTelefone = options.filter(o => !o.phone).length;

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="flex items-center gap-2 min-w-0">
              <UserPlus className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {loading
                  ? 'Carregando equipe...'
                  : value.length === 0
                    ? 'Ninguém além do padrão do funil'
                    : `${value.length} ${value.length === 1 ? 'pessoa' : 'pessoas'} da equipe`}
              </span>
            </span>
            {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome ou número..."
                className="pl-9 h-9"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {error && <p className="px-2 py-3 text-xs text-destructive">{error}</p>}
            {!error && filtered.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">Ninguém encontrado.</p>
            )}
            {filtered.map((o) => {
              const semNumero = !o.phone;
              return (
                <label
                  key={o.userId}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-2 py-2 text-sm',
                    semNumero ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'
                  )}
                >
                  <Checkbox
                    checked={!semNumero && selected.has(o.phone)}
                    disabled={semNumero}
                    onCheckedChange={() => toggle(o.phone)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.name}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {semNumero ? 'sem telefone no cadastro' : formatTeamPhone(o.phone)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <Badge key={o.userId} variant="secondary" className="gap-1 max-w-full">
              <span className="truncate">{o.name}</span>
              <button
                type="button"
                onClick={() => toggle(o.phone)}
                className="shrink-0 rounded-full hover:bg-muted-foreground/20"
                aria-label={`Tirar ${o.name} do grupo`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {!loading && !error && semTelefone > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {semTelefone} {semTelefone === 1 ? 'membro está' : 'membros estão'} sem telefone no cadastro — para aparecer aqui,
          preencha o número em Equipe → perfil do membro.
        </p>
      )}
    </div>
  );
}
