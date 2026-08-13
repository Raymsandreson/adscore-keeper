// =============================================================================
// Seletor de responsável usado nos três níveis do POP: fase, objetivo e passo.
//
// A herança é o ponto: o valor efetivo cai de cima para baixo (fase → objetivo →
// passo), e quem não define nada exibe de quem herdou, em cinza. Sem isso, a
// pessoa abriria um passo, veria um nome e acharia que foi escolhido ali — e ao
// trocar, mudaria só aquele passo achando que mudou a fase inteira.
//
// Desde 13/08/2026 o jeito principal de designar é por CARGO do time vinculado
// ao POP (a pessoa é resolvida na hora — trocar quem ocupa o cargo no time
// atualiza todos os POPs de uma vez). Pessoa específica continua possível como
// exceção, e valores antigos (pessoa) seguem funcionando. Quando o chamador não
// passa `cargos`, o seletor se comporta como antes (só pessoas) — é o caso do
// responsável de notificações do POP, que é sempre pessoa.
// =============================================================================
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProfilesList } from '@/hooks/useProfilesList';
import { User, Briefcase } from 'lucide-react';

const HERDA = '__herda__';
const CARGO_PREFIX = 'cargo::';
const USER_PREFIX = 'user::';

interface Props {
  value?: string | null;
  onChange: (assigneeId: string | null) => void;
  /** Nome de quem seria o responsável se este nível ficar vazio. */
  herdadoDe?: { nome: string; nivel: string } | null;
  className?: string;
  /** Compacto para caber na linha do passo. */
  compact?: boolean;
  /** Cargos do time vinculado ao POP. Presente = modo cargo (cargo em 1º plano). */
  cargos?: string[];
  /** Cargo escolhido neste nível (exclusivo com value: escolher um limpa o outro). */
  cargoValue?: string | null;
  onChangeCargo?: (cargo: string | null) => void;
  /** Quantos membros do time ocupam o cargo — 0 ou 2+ não resolve (avisa no item). */
  ocupantes?: (cargo: string) => number;
}

export function ResponsavelSelect({ value, onChange, herdadoDe, className, compact, cargos, cargoValue, onChangeCargo, ocupantes }: Props) {
  const profiles = useProfilesList();
  const modoCargo = Array.isArray(cargos);

  const placeholder = herdadoDe
    ? `${herdadoDe.nome} (${herdadoDe.nivel})`
    : 'Sem responsável';

  // Valor interno único: cargo::<nome> | user::<id> | __herda__.
  // No modo antigo (sem cargos) o valor é o id puro, como sempre foi.
  const selectValue = modoCargo
    ? (cargoValue ? `${CARGO_PREFIX}${cargoValue}` : value ? `${USER_PREFIX}${value}` : HERDA)
    : (value || HERDA);

  const handleChange = (v: string) => {
    if (!modoCargo) {
      onChange(v === HERDA ? null : v);
      return;
    }
    if (v === HERDA) {
      onChange(null);
      onChangeCargo?.(null);
    } else if (v.startsWith(CARGO_PREFIX)) {
      onChange(null);
      onChangeCargo?.(v.slice(CARGO_PREFIX.length));
    } else if (v.startsWith(USER_PREFIX)) {
      onChangeCargo?.(null);
      onChange(v.slice(USER_PREFIX.length));
    }
  };

  // Cargo gravado que não existe mais no time (renomeado/removido) ainda precisa
  // aparecer no seletor — sumir com ele esconderia o valor gravado.
  const cargoOptions = modoCargo && cargoValue && !cargos!.some(c => c.toLowerCase() === cargoValue.toLowerCase())
    ? [...cargos!, cargoValue]
    : cargos || [];

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <SelectTrigger
        className={`${compact ? 'h-7 text-xs' : 'h-9 text-xs'} ${className || ''}`}
        title={herdadoDe
          ? `Vazio aqui significa herdar: ${herdadoDe.nome}, ${herdadoDe.nivel}`
          : 'Responsável por este item'}
      >
        {modoCargo && cargoValue
          ? <Briefcase className="mr-1 h-3 w-3 shrink-0 opacity-60" />
          : <User className="mr-1 h-3 w-3 shrink-0 opacity-60" />}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={HERDA}>
          {herdadoDe ? `Herdar — ${herdadoDe.nome}` : 'Sem responsável'}
        </SelectItem>
        {modoCargo && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide">Cargos do time</SelectLabel>
            {cargoOptions.length === 0 && (
              <SelectItem value={`${CARGO_PREFIX}__nenhum__`} disabled>
                Time sem cargos cadastrados
              </SelectItem>
            )}
            {cargoOptions.map((c) => {
              const n = ocupantes ? ocupantes(c) : 1;
              return (
                <SelectItem key={`${CARGO_PREFIX}${c}`} value={`${CARGO_PREFIX}${c}`}>
                  {c}
                  {n === 0 ? ' — ninguém no time' : n > 1 ? ` — ${n} membros (empate não resolve)` : ''}
                </SelectItem>
              );
            })}
          </SelectGroup>
        )}
        <SelectGroup>
          {modoCargo && <SelectLabel className="text-[10px] uppercase tracking-wide">Pessoa específica (exceção)</SelectLabel>}
          {profiles.map((p) => {
            const id = p.user_id || p.id;
            return (
              <SelectItem key={id} value={modoCargo ? `${USER_PREFIX}${id}` : id}>
                {p.full_name || p.email || 'Sem nome'}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
