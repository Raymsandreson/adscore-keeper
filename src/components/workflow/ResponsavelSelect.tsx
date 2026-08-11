// =============================================================================
// Seletor de responsável usado nos três níveis do POP: fase, objetivo e passo.
//
// A herança é o ponto: o valor efetivo cai de cima para baixo (fase → objetivo →
// passo), e quem não define nada exibe de quem herdou, em cinza. Sem isso, a
// pessoa abriria um passo, veria um nome e acharia que foi escolhido ali — e ao
// trocar, mudaria só aquele passo achando que mudou a fase inteira.
// =============================================================================
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProfilesList } from '@/hooks/useProfilesList';
import { User } from 'lucide-react';

const HERDA = '__herda__';

interface Props {
  value?: string | null;
  onChange: (assigneeId: string | null) => void;
  /** Nome de quem seria o responsável se este nível ficar vazio. */
  herdadoDe?: { nome: string; nivel: string } | null;
  className?: string;
  /** Compacto para caber na linha do passo. */
  compact?: boolean;
}

export function ResponsavelSelect({ value, onChange, herdadoDe, className, compact }: Props) {
  const profiles = useProfilesList();

  const placeholder = herdadoDe
    ? `${herdadoDe.nome} (${herdadoDe.nivel})`
    : 'Sem responsável';

  return (
    <Select
      value={value || HERDA}
      onValueChange={(v) => onChange(v === HERDA ? null : v)}
    >
      <SelectTrigger
        className={`${compact ? 'h-7 text-xs' : 'h-9 text-xs'} ${className || ''}`}
        title={herdadoDe
          ? `Vazio aqui significa herdar: ${herdadoDe.nome}, ${herdadoDe.nivel}`
          : 'Responsável por este item'}
      >
        <User className="mr-1 h-3 w-3 shrink-0 opacity-60" />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={HERDA}>
          {herdadoDe ? `Herdar — ${herdadoDe.nome}` : 'Sem responsável'}
        </SelectItem>
        {profiles.map((p) => (
          <SelectItem key={p.user_id || p.id} value={p.user_id || p.id}>
            {p.full_name || p.email || 'Sem nome'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
