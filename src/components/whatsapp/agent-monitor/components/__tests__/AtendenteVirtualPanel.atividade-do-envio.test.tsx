/**
 * A ATIVIDADE QUE A RESPOSTA PROMETEU.
 *
 * O texto que sai no grupo quase sempre termina em "já estou acionando a
 * equipe pra conferir e te responder aqui". Até 09/09/2026 essa frase não
 * virava tarefa de ninguém: das 7 respostas que já tinham ido para a fila de
 * envio, ZERO geraram atividade no momento do envio. A promessa chegava ao
 * cliente e morria no painel.
 *
 * O que estes testes travam é o formato da correção, que importa tanto quanto
 * ela existir:
 *
 *  1. enviar NÃO cria atividade sozinho — pergunta, com o rascunho à vista;
 *  2. "Agora não" fecha sem gravar nada;
 *  3. "Revisar e criar" abre o FORMULÁRIO COMPLETO em aba lateral, com o
 *     rascunho preenchido — nada de subformulário reduzido paralelo;
 *  4. o responsável sugerido passa pelas duas traduções (`dom_atendentes`
 *     guarda `profiles.id`; o formulário fala UUID do Cloud) — errar aqui foi
 *     o que deixou 102 atividades do robô com dono que a tela não reconhece;
 *  5. grupo sem ficha não oferece o botão: `createActivity` recusa atividade
 *     sem lead, e é melhor dizer isso antes de abrir o formulário.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { dbMock, inserts, dados } = vi.hoisted(() => {
  const inserts: { tabela: string; linha: unknown }[] = [];
  const dados: Record<string, unknown[]> = {};
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'not', 'ilike', 'or', 'order', 'limit', 'gte', 'lte', 'update', 'delete']) {
      q[m] = () => q;
    }
    q.in = () => q;
    q.insert = (linha: unknown) => { inserts.push({ tabela, linha }); return q; };
    q.maybeSingle = () => Promise.resolve({ data: (dados[tabela] || [])[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: dados[tabela] || [], error: null, count: 0 }).then(res);
    return q;
  };
  return {
    dbMock: {
      from,
      rpc: async () => ({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
    inserts,
    dados,
  };
});

/** O rascunho entregue ao formulário completo, para conferir campo a campo. */
const rascunhoRecebido: { atual: Record<string, unknown> | null } = { atual: null };

vi.mock('@/integrations/supabase', () => ({
  db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock,
  ensureExternalSession: () => Promise.resolve(),
  externalFunctionUrl: (n: string) => `https://exemplo/${n}`,
}));
vi.mock('@/lib/whatsappChatSheet', () => ({ openWhatsAppChatSheet: vi.fn() }));
vi.mock('@/components/whatsapp/ContagemAteEnvio', () => ({ ContagemAteEnvio: () => null }));
// O de verdade arrasta a esteira inteira. O que importa aqui é QUE ele abre,
// em modo criar, e COM QUE rascunho.
vi.mock('@/components/activities/ActivityFullSheet', () => ({
  ActivityFullSheet: ({ open, mode, draft }: { open: boolean; mode: string; draft: Record<string, unknown> }) => {
    if (open) rascunhoRecebido.atual = draft;
    return open ? <div data-testid="form-atividade">{`formulario completo: ${mode}`}</div> : null;
  },
}));
// `profiles.user_id` do Externo → UUID do Cloud. O mapa real vive em
// `auth_uuid_mapping`; aqui basta provar que a tradução é aplicada.
vi.mock('@/integrations/supabase/uuid-remap', () => ({
  remapToCloud: async (ext: string) =>
    ({ 'EXT-KELIANE': 'CLOUD-KELIANE', 'EXT-KAROLYNE': 'CLOUD-KAROLYNE' } as Record<string, string>)[ext] ?? ext,
}));

import { AtendenteVirtualPanel } from '../AtendenteVirtualPanel';

const JID = '120363426415223194';
const LEAD = 'bfa75f67-e6a5-4a7f-8b1d-486b604c600f';

const pendente = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', group_jid: JID, instance_name: 'c9', agendamento_id: null,
  audio_url: null, audio_voz: null, audio_erro: null,
  audio_velocidade: null, audio_estabilidade: null, audio_estilo: null, audio_pausa_ms: null,
  group_name: 'PREV 1028 Bianca', pergunta: 'Mas porque cada mes e e um valor ?',
  pergunta_autor: 'Bianca',
  resposta_sugerida: 'A gente entende a sua duvida sobre os valores.',
  resposta_final: null, intencao: 'A2',
  motivo_revisao: 'valor sem lastro no processo (R$ 864,53)',
  status: 'pendente', criado_em: '2026-09-09T11:54:00Z', enviado_em: null,
  atendente_id: 'at-1', lead_id: LEAD,
  contexto_usado: null,
  dom_atendentes: { nome: 'Keliane', user_id: 'PROFILE-ID-KELIANE' },
  ...extra,
});

/** Abre o rascunho e aprova — o caminho que já existia antes desta mudança. */
const aprovarEEnviar = async () => {
  fireEvent.click(await screen.findByText(/Mas porque cada mes/i));
  fireEvent.click(await screen.findByRole('button', { name: /Aprovar e enviar/i }));
};

beforeEach(() => {
  inserts.length = 0;
  rascunhoRecebido.atual = null;
  for (const k of Object.keys(dados)) delete dados[k];
  dados.dom_respostas_pendentes = [pendente()];
  dados.dom_decisoes = [];
  dados.dom_grupos_piloto = [];
  dados.vw_dom_grupo_sem_ficha = [];
  // O agendamento criado pelo envio — é dele que sai o `agendamento_id`.
  dados.whatsapp_mensagens_agendadas = [{ id: 'ag-1' }];
  // `dom_atendentes.user_id` guarda `profiles.id`. A ponte para o id de
  // autenticação é esta linha, e é ela que faltava.
  dados.profiles = [{ user_id: 'EXT-KELIANE', full_name: 'Keliane Sousa Amorim Araújo' }];
  dados.leads = [{ lead_name: 'Bianca' }];
});

describe('Atendente virtual — a atividade que a resposta prometeu', () => {
  it('enviar NAO cria atividade sozinho: pergunta, com o rascunho a vista', async () => {
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();

    expect(await screen.findByText(/Criar a atividade correspondente/i)).toBeInTheDocument();
    // A resposta foi para a fila de envio; a atividade, nenhuma.
    expect(inserts.map(i => i.tabela)).toContain('whatsapp_mensagens_agendadas');
    expect(inserts.map(i => i.tabela)).not.toContain('lead_activities');
    // E o painel do rascunho continua aberto — fechar era a perda.
    expect(screen.getByText(/Enviada — sai no próximo minuto/i)).toBeInTheDocument();
  });

  it('mostra o assunto e o responsavel sugeridos antes de abrir o formulario', async () => {
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();

    expect(await screen.findByText(/Conferir e voltar ao cliente: valor sem lastro/i)).toBeInTheDocument();
    expect(screen.getByText(/Keliane/)).toBeInTheDocument();
    expect(screen.queryByTestId('form-atividade')).toBeNull();
  });

  it('"Agora nao" fecha sem gravar nada', async () => {
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();
    fireEvent.click(await screen.findByRole('button', { name: /Agora não/i }));

    await waitFor(() => expect(screen.queryByText(/Criar a atividade correspondente/i)).toBeNull());
    expect(inserts.map(i => i.tabela)).not.toContain('lead_activities');
  });

  it('"Revisar e criar" abre o FORMULARIO COMPLETO, em modo criar', async () => {
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();
    fireEvent.click(await screen.findByRole('button', { name: /Revisar e criar/i }));

    const form = await screen.findByTestId('form-atividade');
    expect(form).toHaveTextContent('formulario completo: create');
  });

  it('o rascunho leva o caso, o responsavel traduzido e a marca de origem', async () => {
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();
    fireEvent.click(await screen.findByRole('button', { name: /Revisar e criar/i }));
    await screen.findByTestId('form-atividade');

    const d = rascunhoRecebido.atual!;
    expect(d.lead_id).toBe(LEAD);
    expect(d.title).toMatch(/valor sem lastro/);
    // As DUAS traduções: profiles.id → profiles.user_id → UUID do Cloud.
    // Sem elas o dono seria um id que a tela de atividades não reconhece —
    // foi assim que 102 atividades do robô ficaram invisíveis.
    expect(d.assigned_to).toBe('CLOUD-KELIANE');
    expect(String(d.assigned_to_name)).toMatch(/Keliane/);
    // O que o cliente perguntou e o que saiu para ele vão junto: quem pegar a
    // atividade amanhã não precisa abrir o painel do robô para entender.
    expect(String(d.current_status_notes)).toMatch(/Mas porque cada mes/);
    expect(String(d.what_was_done)).toMatch(/A gente entende a sua duvida/);
    expect(d.action_source_detail).toBe('atendente-virtual:r1');
  });

  it('avisa ANTES de enviar que a pergunta vem depois', async () => {
    render(<AtendenteVirtualPanel />);
    fireEvent.click(await screen.findByText(/Mas porque cada mes/i));

    // A pergunta aparece só depois do clique, e quem não a vê chegar conclui
    // que ela não existe — foi o que aconteceu na estreia da tela.
    expect(await screen.findByText(/Depois de enviar, eu pergunto aqui mesmo/i)).toBeInTheDocument();
    expect(screen.queryByText(/Criar a atividade correspondente/i)).toBeNull();
  });

  it('quem cuida do cliente vem antes do rodizio', async () => {
    // A ficha diz quem acolhe — e o nome do grupo diz o mesmo ("- KAROLYNE").
    dados.leads = [{ lead_name: 'Bianca', acolhedor_user_id: 'EXT-KAROLYNE' }];
    dados.profiles = [{ user_id: 'EXT-KAROLYNE', full_name: 'Maria Karolyne de Aguiar Nunes' }];

    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();

    expect(await screen.findByText(/Maria Karolyne/)).toBeInTheDocument();
    expect(screen.getByText(/acolhedora da ficha/i)).toBeInTheDocument();
    // O plantão nem entra: sugerir a fila de reclamação para um cliente que já
    // tem quem o acompanhe joga fora a única informação que faz a atividade
    // chegar em quem sabe do que se trata.
    expect(screen.queryByText(/rodízio/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Revisar e criar/i }));
    await screen.findByTestId('form-atividade');
    expect(rascunhoRecebido.atual!.assigned_to).toBe('CLOUD-KAROLYNE');
  });

  it('sem ninguem na ficha, cai no rodizio — e diz que caiu', async () => {
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();

    expect(await screen.findByText(/Keliane/)).toBeInTheDocument();
    expect(screen.getByText(/rodízio do atendente virtual/i)).toBeInTheDocument();
  });

  it('grupo sem ficha nao oferece criar — e diz por que', async () => {
    dados.dom_respostas_pendentes = [pendente({ lead_id: null })];
    render(<AtendenteVirtualPanel />);
    await aprovarEEnviar();

    expect(await screen.findByText(/não tem ficha/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revisar e criar/i })).toBeNull();
  });
});
