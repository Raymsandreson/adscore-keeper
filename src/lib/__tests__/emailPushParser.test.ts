import { describe, it, expect } from 'vitest';
// O parser vive na pasta da edge (é lá que roda), mas é módulo puro — sem API
// do Deno — então o teste importa direto e existe UMA implementação só.
import { parseEmailPush, soDigitos } from '../../../supabase/functions/_shared/emailPushParser';

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
