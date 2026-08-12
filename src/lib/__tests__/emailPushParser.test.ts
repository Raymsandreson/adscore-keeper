import { describe, it, expect } from 'vitest';
// O parser vive na pasta da edge (é lá que roda), mas é módulo puro — sem API
// do Deno — então o teste importa direto e existe UMA implementação só.
import { parseEmailPush, soDigitos, extrairEventosInline, resumirEventos } from '../../../supabase/functions/_shared/emailPushParser';

/**
 * Os corpos abaixo são recortes FIÉIS de e-mails da caixa processual@ em
 * 11/08/2026 — é neles que o parser tem que funcionar, não em exemplo inventado.
 */

const PJE_TJPI = `PJe Push Tribunal de Justiça do Piauí

Informamos que o processo a seguir sofreu movimentação:
Número do Processo: 0004694-46.2016.8.18.0140
Polo Ativo: BANCO DO BRASIL SA
Classe Judicial: APELAÇÃO CÍVEL

| Data - Movimento |
|---|
| 11/08/2026 13:23 - Conclusos para admissibilidade recursal |
| 11/08/2026 13:23 - Remetidos os Autos (em grau de recurso) para Vice Presidência |
| 11/08/2026 13:22 - Juntada de certidão |

*ATENÇÃO: este e-mail é gerado de forma automatizada*`;

const TRT10 = `*Tribunal Regional do Trabalho - 1 Grau*

*Número do Processo:* 0001018-05.2026.5.10.0014

*Classe Judicial:* Ação Trabalhista - Rito Ordinário

*Eventos:*

| Data | Evento |
| 10/08/2026 21:00 | Recebido o mandado pelo Oficial de Justiça para cumprimento |
| 10/08/2026 20:06 | Proferido despacho de mero expediente |
| 10/08/2026 20:06 | Despacho - Despacho[](>https://pje.trt10.jus.br/consultaprocessual/detalhe-processo/0001018-05.2026.5.10.0014/1#e37c2a4<) |`;

const EPROC = `Os seguintes processos tiveram uma nova movimentação relacionada a um prazo processual

| Num. Processo: | 5006477-98.2026.4.04.7208 |
| Movimentação: | Confirmada a intimação eletrônica - |
| Evento Número: | 28 |
| Partes: |
| AUTOR |
| ANA PAULA KRIZINSKI MACHADO |
| RÉU |
| INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS |

ATENÇÃO:
   1. Esta comunicação é meramente informativa, NÃO TENDO VALOR DE INTIMAÇÃO.`;

const ESAJ = `Prezado(a) RAYMSANDRESON DE MORAIS PRUDENCIO,
O sistema PUSH está disponibilizando novas informações, as quais são listadas abaixo:

Processo: 1070860-05.2020.8.26.0100 <https://esaj.tjsp.jus.br/cpopg/show.do>
Classe: Recuperação Judicial
Advogados: Abelardo Sampaio Lopes Neto (OAB nº 28310/BA)
        Abenur Amurami de Siqueira (OAB nº 9107/MT)
Novas Movimentações
10/08/2026 16:02 Petição Juntada
Nº Protocolo: WJMJ.26.41038960-4 Tipo da Petição: Petição Intermediária

Processo: 1000139-66.2025.8.26.0354 <https://esaj.tjsp.jus.br/cpopg/show.do>
Classe: Recuperação Judicial
Novas Movimentações
10/08/2026 16:13 Proferidas Outras Decisões não Especificadas
Vistos. Fls. 17924 - Manifeste-se a Administração Judicial em 5 dias.

10/08/2026 17:01 Remetido ao DJE
Relação: 1482/2026 Teor do ato: Vistos.`;

describe('parseEmailPush — PJe push', () => {
  it('lê os 3 movimentos da tabela "data - movimento" do TJPI', () => {
    const movs = parseEmailPush({ assunto: '[Push] Movimentação processual do processo 0004694-46.2016.8.18.0140', corpo: PJE_TJPI });
    expect(movs).toHaveLength(3);
    expect(movs[0]).toMatchObject({
      cnj: '0004694-46.2016.8.18.0140',
      data: '2026-08-11',
      texto: 'Conclusos para admissibilidade recursal',
      fonte: 'pje',
    });
  });

  it('lê a tabela de duas colunas do TRT e limpa o link cru do despacho', () => {
    const movs = parseEmailPush({ assunto: '[TRT10] [PUSH] Atualizações', corpo: TRT10 });
    expect(movs).toHaveLength(3);
    expect(movs[1].texto).toBe('Proferido despacho de mero expediente');
    expect(movs[2].texto).not.toContain('https://');
  });

  it('não confunde cabeçalho de tabela com movimentação', () => {
    const movs = parseEmailPush({ assunto: '', corpo: PJE_TJPI });
    expect(movs.map((m) => m.texto)).not.toContain('Data - Movimento');
  });
});

/**
 * Corpo do TST recebido em 11/08/2026 (gmail_message_id 19fef52b19d31329),
 * copiado do banco: bloco "Eventos:" em LINHA CORRIDA, sem tabela nenhuma.
 * É o layout de 804 dos 4.203 e-mails da caixa.
 */
const TST_INLINE = `Tribunal Superior do Trabalho Número do Processo: 0016855-58.2023.5.16.0008 `
  + `Classe Judicial: RECURSO DE REVISTA COM AGRAVO Eventos: Data Evento `
  + `06/08/2026 00:14 Decorrido o prazo de CGB ENERGIA LTDA em 05/08/2026 `
  + `05/08/2026 00:26 Documento sigiloso 05/08/2026 00:26 Documento sigiloso `
  + `Para acessar este processo na consulta pública, clique em https://pje.tst.jus.br/consultaprocessual . `
  + `ATENÇÃO: este e-mail é gerado de forma automatizada, por gentileza, não o responda.`;

const TRT16_INLINE = `Número do Processo: 0016320-73.2016.5.16.0009 Eventos: Data Evento `
  + `11/08/2026 17:08 Expedido(a) intima&ccedil;&atilde;o a(o) EDIVANDRO DA SILVA BRANDAO `
  + `11/08/2026 17:08 Documento sigiloso `
  + `11/08/2026 17:07 https://pje.trt16.jus.br/consultaprocessual/detalhe-processo/0016320-73.2016.5.16.0009/1#b105d6f Despacho - Despacho `
  + `Para acessar este processo na consulta pública, clique em https://pje.trt16.jus.br/consultaprocessual .`;

describe('parseEmailPush — bloco "Eventos:" em linha corrida', () => {
  it('extrai os 3 eventos do push do TST e devolve UMA movimentação com eles junto', () => {
    const movs = parseEmailPush({
      assunto: '[TST] [PUSH] Atualizações de Informações Processuais do Processo 0016855-58.2023.5.16.0008',
      corpo: TST_INLINE,
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].cnj).toBe('0016855-58.2023.5.16.0008');
    // Data do evento mais recente, não a do primeiro que aparece no corpo.
    expect(movs[0].data).toBe('2026-08-06');
    expect(movs[0].eventos).toHaveLength(3);
    expect(movs[0].eventos?.[0]).toMatchObject({
      data: '2026-08-06', hora: '00:14',
      texto: 'Decorrido o prazo de CGB ENERGIA LTDA em 05/08/2026',
    });
  });

  it('o título é o evento que diz algo, não "Documento sigiloso"', () => {
    const movs = parseEmailPush({ assunto: '', corpo: TST_INLINE });
    expect(movs[0].titulo).toBe('Decorrido o prazo de CGB ENERGIA LTDA em 05/08/2026');
    expect(movs[0].texto).toBe('Decorrido o prazo de CGB ENERGIA LTDA em 05/08/2026 · Documento sigiloso (2x)');
  });

  it('decodifica as entidades HTML e tira o link cru colado no evento', () => {
    const movs = parseEmailPush({ assunto: '', corpo: TRT16_INLINE });
    const textos = movs[0].eventos?.map((e) => e.texto) || [];
    expect(textos[0]).toBe('Expedido(a) intimação a(o) EDIVANDRO DA SILVA BRANDAO');
    expect(textos[2]).toBe('Despacho - Despacho');
    expect(movs[0].texto).not.toContain('https://');
  });

  it('não engole o rodapé do tribunal como se fosse evento', () => {
    const eventos = extrairEventosInline(TST_INLINE);
    expect(eventos.every((e) => !/consulta p[úu]blica|ATEN/i.test(e.texto))).toBe(true);
  });

  it('a tabela tem precedência: e-mail com "Eventos:" E tabela segue granular', () => {
    const movs = parseEmailPush({ assunto: '[TRT10] [PUSH] Atualizações', corpo: TRT10 });
    expect(movs).toHaveLength(3);
    expect(movs[0].eventos).toBeUndefined();
  });

  it('resumo sem repetir o mesmo evento e com contagem', () => {
    const { titulo, resumo } = resumirEventos([
      { data: '2026-08-11', hora: '10:00', texto: 'Documento sigiloso' },
      { data: '2026-08-11', hora: '10:01', texto: 'Documento sigiloso' },
      { data: '2026-08-11', hora: '10:02', texto: 'Juntada a petição de Manifestação' },
    ]);
    expect(titulo).toBe('Juntada a petição de Manifestação');
    expect(resumo).toBe('Juntada a petição de Manifestação · Documento sigiloso (2x)');
  });
});

describe('parseEmailPush — EPROC', () => {
  it('casa processo e movimentação, sem data no corpo', () => {
    const movs = parseEmailPush({ assunto: 'Movimentações Processuais - EPROC', corpo: EPROC });
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({
      cnj: '5006477-98.2026.4.04.7208',
      data: null,
      fonte: 'eproc',
    });
    expect(movs[0].texto).toMatch(/^Confirmada a intimação eletrônica/);
  });
});

describe('parseEmailPush — e-SAJ', () => {
  it('separa os processos do mesmo e-mail e ignora a lista de advogados', () => {
    const movs = parseEmailPush({ assunto: 'Portal e-Saj - Andamento Processual', corpo: ESAJ });
    expect(movs).toHaveLength(3);
    expect(movs[0].cnj).toBe('1070860-05.2020.8.26.0100');
    expect(movs[1].cnj).toBe('1000139-66.2025.8.26.0354');
    expect(movs[2].texto).toBe('Remetido ao DJE');
    expect(movs.some((m) => /OAB/.test(m.texto))).toBe(false);
  });
});

describe('parseEmailPush — o que NÃO pode entrar', () => {
  it('ignora e-mail sem número de processo (marketing, alerta de login)', () => {
    expect(parseEmailPush({ assunto: 'Feliz Dia do Advogado!', corpo: 'Aproveite o Portal OAB' })).toEqual([]);
    expect(parseEmailPush({
      assunto: 'Alerta de novo acesso',
      corpo: 'Detectamos um acesso à PDPJ utilizando um novo dispositivo',
    })).toEqual([]);
  });

  it('push com layout novo não some: guarda o assunto para o processo aparecer', () => {
    const movs = parseEmailPush({
      assunto: 'Movimentação processual do processo 0001018-05.2026.5.10.0014',
      corpo: 'Layout que ainda não conhecemos, processo 0001018-05.2026.5.10.0014.',
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].fonte).toBe('desconhecida');
  });

  it('não repete o mesmo evento citado duas vezes no e-mail', () => {
    const corpo = `Número do Processo: 0001018-05.2026.5.10.0014\n`
      + `| 10/08/2026 20:06 | Proferido despacho |\n`
      + `| 10/08/2026 20:06 | Proferido despacho |`;
    expect(parseEmailPush({ assunto: '', corpo })).toHaveLength(1);
  });
});

describe('soDigitos', () => {
  it('normaliza o CNJ para casar com o cadastro do processo', () => {
    expect(soDigitos('0001018-05.2026.5.10.0014')).toBe('00010180520265100014');
  });
});
