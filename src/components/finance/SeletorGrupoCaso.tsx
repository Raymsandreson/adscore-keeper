/**
 * Escolher O CASO — o grupo de WhatsApp — na hora de vincular uma despesa.
 *
 * Por que grupo, e não só lead: o grupo É o caso. Um lead com dois processos
 * tem dois grupos, e a despesa pertence a UM deles. Vinculando só ao lead, o
 * limite `per_whatsapp_group` não consegue decidir de qual caso é o gasto e a
 * linha vira pendência (ver `src/lib/limitesPorVinculo.ts`).
 *
 * Por que combobox com busca no servidor, e não um Select: são 2.429 jids
 * distintos em `lead_whatsapp_groups` (11/09/2026). Carregar tudo para escolher
 * um é o N+1 do lado oposto — uma consulta só, mas de 2 mil linhas em toda
 * abertura de tela. Aqui a busca vai com `ilike` e teto de 30, e a lista inicial
 * são os 30 vínculos mais recentes.
 *
 * Escolher um grupo também entrega o LEAD dele: quem vincula ao caso está
 * vinculando ao cliente por consequência, e deixar `lead_id` vazio quebraria
 * todo relatório que soma por lead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { db } from '@/integrations/supabase';

/**
 * `whatsapp_groups_index` não está nos tipos gerados do Externo (o gerador só
 * cobre o Cloud), então o PostgREST tipa a consulta como erro de relação. Mesmo
 * caminho já usado em `useVinculoDespesas`. O cast é sobre a TABELA, não sobre
 * o resultado: o formato das linhas continua declarado abaixo.
 */
const extSemTipos = db as unknown as {
  from: (tabela: string) => {
    select: (colunas: string) => {
      in: (coluna: string, valores: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
      eq: (coluna: string, valor: string) => {
        limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Loader2, Users, X } from 'lucide-react';

export interface GrupoCaso {
  group_jid: string;
  group_name: string | null;
  lead_id: string | null;
}

interface Props {
  /** jid escolhido, ou null. */
  value: string | null;
  /** Recebe o grupo inteiro (jid + nome + lead) ou null quando limpa. */
  onChange: (grupo: GrupoCaso | null) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

const TETO = 30;
const ESPERA_MS = 300;

/** `or()` do PostgREST separa condições por vírgula: termo com vírgula quebra a query. */
function limpar(termo: string): string {
  return termo.replace(/[,()%]/g, ' ').trim();
}

function rotuloDoGrupo(grupo: Pick<GrupoCaso, 'group_jid' | 'group_name'>): string {
  if (grupo.group_name) return grupo.group_name;
  // Sem nome, o jid é a única identidade honesta. Cortado porque o final é
  // sempre "@g.us" e o começo é o que distingue.
  return 'Grupo sem nome · ' + grupo.group_jid.replace(/@g\.us$/, '').slice(0, 18);
}

/**
 * Busca os grupos. Nome vazio em `lead_whatsapp_groups` (555 das 2.769 linhas)
 * é completado pelo `whatsapp_groups_index`, o índice oficial de nome — só para
 * as linhas que vão aparecer, nunca para a tabela toda.
 */
async function buscarGrupos(termo: string): Promise<GrupoCaso[]> {
  const t = limpar(termo);
  let query = db
    .from('lead_whatsapp_groups')
    .select('group_jid, group_name, lead_id')
    .limit(TETO);

  query = t
    ? query.or(`group_name.ilike.%${t}%,group_jid.ilike.%${t}%`)
    : query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  const linhas = ((data as GrupoCaso[]) || []).filter(g => !!g.group_jid);
  const semNome = linhas.filter(g => !g.group_name).map(g => g.group_jid);
  if (semNome.length === 0) return linhas;

  const { data: indice } = await extSemTipos
    .from('whatsapp_groups_index')
    .select('group_jid, contact_name')
    .in('group_jid', semNome);
  const nomePorJid = new Map(
    ((indice as { group_jid: string | null; contact_name: string | null }[] | null) || [])
      .filter(l => l.group_jid && l.contact_name)
      .map(l => [l.group_jid as string, l.contact_name as string]),
  );
  return linhas.map(g => (g.group_name ? g : { ...g, group_name: nomePorJid.get(g.group_jid) ?? null }));
}

/** Um jid já gravado precisa virar nome na tela, mesmo fora da busca atual. */
async function buscarUm(jid: string): Promise<GrupoCaso | null> {
  const { data } = await db
    .from('lead_whatsapp_groups')
    .select('group_jid, group_name, lead_id')
    .eq('group_jid', jid)
    .limit(1);
  const linha = ((data as GrupoCaso[]) || [])[0];
  if (linha) {
    if (linha.group_name) return linha;
    const { data: idx } = await extSemTipos
      .from('whatsapp_groups_index')
      .select('contact_name')
      .eq('group_jid', jid)
      .limit(1);
    const nome = ((idx as { contact_name: string | null }[] | null) || [])[0]?.contact_name ?? null;
    return { ...linha, group_name: nome };
  }
  // Jid gravado que não está em `lead_whatsapp_groups` continua sendo o vínculo
  // de verdade da despesa: some da lista, não do registro.
  return { group_jid: jid, group_name: null, lead_id: null };
}

export function SeletorGrupoCaso({ value, onChange, className, disabled, placeholder }: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [opcoes, setOpcoes] = useState<GrupoCaso[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<GrupoCaso | null>(null);
  const pedido = useRef(0);

  // Resposta velha não pode sobrescrever resposta nova: digitar rápido dispara
  // várias buscas e elas não voltam em ordem.
  const procurar = useCallback(async (t: string) => {
    const meu = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const lista = await buscarGrupos(t);
      if (pedido.current === meu) setOpcoes(lista);
    } catch (err) {
      console.error('[SeletorGrupoCaso] erro ao buscar grupos:', err);
      if (pedido.current === meu) {
        setErro(err instanceof Error ? err.message : String(err));
        setOpcoes([]);
      }
    } finally {
      if (pedido.current === meu) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const id = setTimeout(() => void procurar(termo), termo ? ESPERA_MS : 0);
    return () => clearTimeout(id);
  }, [aberto, termo, procurar]);

  useEffect(() => {
    let vivo = true;
    if (!value) { setEscolhido(null); return () => { vivo = false; }; }
    if (escolhido?.group_jid === value) return () => { vivo = false; };
    void buscarUm(value).then(g => { if (vivo) setEscolhido(g); });
    return () => { vivo = false; };
  }, [value, escolhido?.group_jid]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn('h-8 w-full justify-between px-2 text-xs font-normal', className)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className={cn('truncate', !escolhido && 'text-muted-foreground')}>
              {escolhido ? rotuloDoGrupo(escolhido) : (placeholder || 'Buscar o grupo do caso...')}
            </span>
          </span>
          <span className="flex shrink-0 items-center">
            {escolhido && !disabled && (
              <X
                className="mr-1 h-3 w-3 text-muted-foreground hover:text-foreground"
                onClick={e => { e.stopPropagation(); onChange(null); }}
              />
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        {/* shouldFilter=false: quem filtra é o servidor. O filtro do Command
            esconderia resultado legítimo que não bate por substring exata. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Nome do grupo, nome do cliente, nº do lead..."
            value={termo}
            onValueChange={setTermo}
          />
          <CommandList>
            {carregando && (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> procurando...
              </div>
            )}
            {!carregando && erro && (
              <div className="px-3 py-4 text-xs text-red-600">
                Não deu para buscar os grupos: {erro}
              </div>
            )}
            {!carregando && !erro && opcoes.length === 0 && (
              <CommandEmpty className="px-3 py-4 text-xs">
                {termo ? 'Nenhum grupo com esse texto.' : 'Nenhum grupo vinculado ainda.'}
              </CommandEmpty>
            )}
            {!carregando && !erro && opcoes.length > 0 && (
              <CommandGroup
                heading={termo ? `até ${TETO} resultados` : `${TETO} grupos mais recentes — busque pelo nome`}
              >
                {opcoes.map(g => (
                  <CommandItem
                    key={g.group_jid}
                    value={g.group_jid}
                    onSelect={() => { onChange(g); setEscolhido(g); setAberto(false); }}
                    className="text-xs"
                  >
                    <Check
                      className={cn('mr-2 h-3 w-3', value === g.group_jid ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{rotuloDoGrupo(g)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
