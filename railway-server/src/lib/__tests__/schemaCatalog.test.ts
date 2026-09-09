// O caso que originou este arquivo: em 09/09/2026 o analista de relatórios
// respondeu à diretoria que "inss_admin_processes não tem campo de resultado".
// A coluna existia com 498 registros preenchidos — só não estava no catálogo
// escrito à mão dentro do prompt. Os testes daqui travam as duas metades do
// conserto: a coluna real aparece no catálogo, e quando o schema NÃO pode ser
// lido a IA é proibida de concluir que o campo não existe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O módulo importa o client do Supabase no topo; sem este mock ele tentaria
// criar conexão real só para as contagens de linha.
vi.mock('../supabase', () => {
  const query: any = {
    select: () => query,
    is: () => query,
    then: (resolve: any) => resolve({ count: 1234, error: null }),
  };
  return {
    supabase: { from: () => query },
    SUPABASE_URL: 'https://exemplo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste',
  };
});

import { colunasDoOpenApi, montarCatalogo, _resetCatalogoParaTeste } from '../schemaCatalog';

/** Recorte do OpenAPI que o PostgREST publica em GET /rest/v1/ (Swagger 2.0). */
const SWAGGER = {
  swagger: '2.0',
  definitions: {
    inss_admin_processes: {
      properties: {
        id: { format: 'uuid', type: 'string' },
        requerimento_number: { format: 'text', type: 'string' },
        current_status: { format: 'text', type: 'string' },
        protocol_date: { format: 'date', type: 'string' },
        benefit_number: { format: 'text', type: 'string' },
        resultado: { format: 'text', type: 'string' },
        despacho: { format: 'text', type: 'string' },
        details: { format: 'jsonb', type: 'string' },
        deleted_at: { format: 'timestamp with time zone', type: 'string' },
      },
    },
    leads: {
      properties: {
        id: { format: 'uuid', type: 'string' },
        lead_name: { format: 'text', type: 'string' },
        lead_status: { format: 'text', type: 'string' },
        deleted_at: { format: 'timestamp with time zone', type: 'string' },
      },
    },
    // Tabela que existe no banco mas não está na curadoria: não pode vazar pro
    // prompt, só contar no diagnóstico.
    whatsapp_messages: {
      properties: { id: { format: 'uuid', type: 'string' }, body: { format: 'text', type: 'string' } },
    },
    // Tabela da curadoria sem colunas (view sem properties) — vira "faltando".
    activity_types: {},
  },
};

function mockarFetch(resposta: any) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => resposta,
  });
}

beforeEach(() => {
  _resetCatalogoParaTeste();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('colunasDoOpenApi', () => {
  it('lê coluna:tipo na ordem em que o PostgREST devolve', () => {
    const mapa = colunasDoOpenApi(SWAGGER);
    expect(mapa.get('leads')).toEqual([
      'id:uuid',
      'lead_name:text',
      'lead_status:text',
      'deleted_at:timestamptz',
    ]);
  });

  it('pega o campo que faltava no catálogo à mão', () => {
    expect(colunasDoOpenApi(SWAGGER).get('inss_admin_processes')).toContain('resultado:text');
  });

  it('entende também o OpenAPI 3, caso o PostgREST vire a versão', () => {
    const doc = { openapi: '3.0.0', components: { schemas: { leads: { properties: { id: { format: 'uuid' } } } } } };
    expect(colunasDoOpenApi(doc).get('leads')).toEqual(['id:uuid']);
  });

  it('deixa credencial de fora — a IA não consulta senha de gov.br', () => {
    const doc = {
      definitions: {
        case_process_tracking: {
          properties: {
            cliente: { format: 'text' },
            senha_gov: { format: 'text' },
            api_key: { format: 'text' },
            zapsign_token: { format: 'text' },
            // Palavra que só CONTÉM "senha" não é credencial — a regex casa
            // por segmento, senão sumiriam colunas de negócio sem ninguém ver.
            resenha: { format: 'text' },
          },
        },
      },
    };
    const cols = colunasDoOpenApi(doc).get('case_process_tracking');
    expect(cols).toEqual(['cliente:text', 'resenha:text']);
  });

  it('não quebra com documento vazio ou inesperado', () => {
    expect(colunasDoOpenApi(null).size).toBe(0);
    expect(colunasDoOpenApi({ definitions: { x: { properties: null } } }).size).toBe(0);
  });
});

describe('montarCatalogo — schema lido do banco', () => {
  it('põe a coluna real no texto do prompt, com contagem viva', async () => {
    vi.stubGlobal('fetch', mockarFetch(SWAGGER));
    const { texto, diagnostico } = await montarCatalogo();

    expect(diagnostico.fonte).toBe('banco');
    expect(texto).toContain('resultado:text');
    expect(texto).toContain('lidas do banco');
    // 1.234 vem do count mockado; "ativos" porque a tabela tem deleted_at.
    expect(texto).toContain('(1.234 ativos)');
  });

  it('mantém a curadoria que o schema não conta', async () => {
    vi.stubGlobal('fetch', mockarFetch(SWAGGER));
    const { texto } = await montarCatalogo();
    expect(texto).toContain("'deferido', 'indeferido', 'arquivado_decurso'");
    expect(texto).toContain("lead_status = 'closed'");
    expect(texto).toContain('DICAS DE JOIN');
  });

  it('não expõe tabela fora da curadoria, mas conta no diagnóstico', async () => {
    vi.stubGlobal('fetch', mockarFetch(SWAGGER));
    const { texto, diagnostico } = await montarCatalogo();
    expect(texto).not.toContain('whatsapp_messages —');
    expect(diagnostico.fora_do_catalogo).toBe(1);
  });

  it('marca como faltando a tabela da curadoria que o banco não devolveu', async () => {
    vi.stubGlobal('fetch', mockarFetch(SWAGGER));
    const { diagnostico } = await montarCatalogo();
    // Do SWAGGER só vieram leads e inss_admin_processes com colunas.
    expect(diagnostico.faltando).toContain('activity_types');
    expect(diagnostico.faltando).toContain('legal_cases');
    expect(diagnostico.tabelas).toBe(2);
  });
});

describe('montarCatalogo — modo degradado', () => {
  it('proíbe afirmar que o campo não existe quando não leu o schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sem rede')));
    const { texto, diagnostico } = await montarCatalogo();

    expect(diagnostico.fonte).toBe('degradado');
    expect(diagnostico.colunas).toBe(0);
    expect(texto).toContain('É PROIBIDO afirmar que um campo não existe');
    // Sem lista de colunas o modelo não pode ser mandado a "usar só as de baixo".
    expect(texto).not.toContain('  colunas:');
    // A curadoria continua de pé — é o que sobra pra ele se orientar.
    expect(texto).toContain('inss_admin_processes');
    expect(texto).toContain('DICAS DE JOIN');
  });

  it('trata HTTP de erro como falha de leitura, não como schema vazio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const { diagnostico } = await montarCatalogo();
    expect(diagnostico.fonte).toBe('degradado');
    expect(diagnostico.erro).toContain('401');
  });
});
