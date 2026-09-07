/**
 * Erro do Postgres chega em três camadas, e a tela vinha jogando duas fora.
 *
 * Quando o banco recusa um cadastro ele responde:
 *   message  o quê      "CNJ inválido: 1505819-97.2025.8.26.03788"
 *   details  por quê    "Está escrito no formato de CNJ mas tem 21 dígitos, e CNJ tem 20."
 *   hint     e agora    "Confira o número na fonte — quase sempre é um dígito a mais…"
 *
 * O PostgREST repassa as três, e o supabase-js entrega em `message`, `details`
 * e `hint` — é a mesma leitura que useLeads.ts e CreateLeadFromSearchDialog.tsx
 * já fazem hoje. Se algum dia vierem vazios, cai só no título, sem quebrar.
 *
 * Os toasts do app mostravam só a primeira camada: quem digitava um número
 * torto lia "CNJ inválido" e ficava sem saber o que estava errado nem o que
 * fazer. Pior em useLeadProcesses, que descartava tudo e dizia apenas
 * "Erro ao adicionar processo".
 *
 * Aqui o título fica com o "o quê" e a descrição junta o "por quê" com o
 * "e agora" — que é onde mora a instrução de conserto.
 */
import { toast } from 'sonner';

interface ErroDoPostgrest {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

export interface ErroLegivel {
  titulo: string;
  /** Ausente quando o banco não mandou detail nem hint. */
  descricao?: string;
}

const limpa = (v?: string | null): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
};

export function erroLegivel(erro: unknown, tituloPadrao: string): ErroLegivel {
  const e = (erro && typeof erro === 'object' ? erro : {}) as ErroDoPostgrest;

  const descricao = [limpa(e.details), limpa(e.hint)].filter(Boolean).join(' ') || undefined;
  const mensagem = limpa(e.message);
  if (mensagem) return { titulo: mensagem, descricao };

  // Sem mensagem: o código ao menos diz ao suporte o que procurar.
  const codigo = limpa(e.code);
  return { titulo: codigo ? `${tituloPadrao} (${codigo})` : tituloPadrao, descricao };
}

/**
 * Mostra o erro inteiro. Com descrição o toast fica 10s no ar — o texto do
 * hint é uma instrução, não um aviso de passagem, e 4s não dá para ler.
 */
export function avisarErro(erro: unknown, tituloPadrao: string): void {
  const { titulo, descricao } = erroLegivel(erro, tituloPadrao);
  if (descricao) toast.error(titulo, { description: descricao, duration: 10000 });
  else toast.error(titulo);
}
