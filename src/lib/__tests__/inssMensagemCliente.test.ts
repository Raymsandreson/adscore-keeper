import { describe, it, expect } from 'vitest';
// Módulo do railway-server, puro (só Intl) — o vitest da raiz é o único runner.
import {
  classificarMensagemCliente,
  beneficioLegivel,
  mascararDocumentos,
  fallbackMensagemCliente,
  promptMensagemCliente,
  dentroDaJanela,
  eventoElegivelParaZap,
  mensagemVaiAoCliente,
  ZAP_CLIENTE_DESDE,
} from '../../../railway-server/src/lib/inss-mensagem-cliente';

describe('classificarMensagemCliente', () => {
  it('protocolo e exigência sempre viram mensagem', () => {
    expect(classificarMensagemCliente({ status: 'Protocolado' })).toBe('protocolado');
    expect(classificarMensagemCliente({ status: 'Exigência' })).toBe('exigencia');
    expect(classificarMensagemCliente({ status: 'exigencia' })).toBe('exigencia');
  });

  it('conclusão segue o veredito, não o status', () => {
    expect(classificarMensagemCliente({ status: 'Concluída', resultado: 'deferido' })).toBe('deferido');
    expect(classificarMensagemCliente({ status: 'Concluída', resultado: 'indeferido' })).toBe('indeferido');
    expect(classificarMensagemCliente({ status: 'Concluída', resultado: 'arquivado_decurso' }))
      .toBe('arquivado_decurso');
  });

  it('cala em conclusão sem veredito (193 de 643 no histórico)', () => {
    expect(classificarMensagemCliente({ status: 'Concluída', resultado: null })).toBeNull();
  });

  it('cala nos status que são texto do próprio escritório', () => {
    for (const status of ['Em Análise', 'Em análise', 'Pendente', 'Cancelada', 'PARSE_FAILED', '']) {
      expect(classificarMensagemCliente({ status })).toBeNull();
    }
  });
});

describe('beneficioLegivel', () => {
  it('traduz o que a whitelist reconhece', () => {
    expect(beneficioLegivel('ASSISTENCIAL À PESSOA COM DEFICIÊNCIA')).toBe('seu pedido de BPC/LOAS');
    expect(beneficioLegivel('AUXÍLIO-ACIDENTE')).toBe('seu pedido de auxílio-acidente');
    expect(beneficioLegivel('POR INCAPACIDADE')).toBe('seu pedido de auxílio por incapacidade');
    expect(beneficioLegivel('PENSÃO POR MORTE URBANA')).toBe('seu pedido de pensão por morte');
  });

  it('corta o lixo colado pelo parser do e-mail', () => {
    expect(beneficioLegivel('ASSISTENCIAL À PESSOA COM DEFICIÊNCIA Data do Protocolo : 25/08/2026 16:40 Unida'))
      .toBe('seu pedido de BPC/LOAS');
  });

  it('NUNCA ecoa fragmento com número de benefício', () => {
    const sujo = '(NB) 2466847943. Aguarde correspondência com informações sobre o seu pagamento';
    expect(beneficioLegivel(sujo)).toBe('seu pedido no INSS');
    expect(beneficioLegivel(sujo)).not.toContain('2466847943');
    expect(beneficioLegivel(null)).toBe('seu pedido no INSS');
  });
});

describe('mascararDocumentos', () => {
  it('esconde CPF e número de benefício, preserva data e prazo', () => {
    const t = mascararDocumentos('Pedido nº 732.257.379-0, CPF 12345678901, prazo até 25/09/2026.');
    expect(t).not.toContain('732.257.379-0');
    expect(t).not.toContain('12345678901');
    expect(t).toContain('25/09/2026');
  });
});

describe('fallbackMensagemCliente', () => {
  it('fala simples: sem termo jurídico', () => {
    const proibidos = /requerimento|indeferi|decurso|deferimento|processo administrativo/i;
    for (const tipo of ['protocolado', 'exigencia', 'deferido', 'indeferido', 'arquivado_decurso'] as const) {
      const txt = fallbackMensagemCliente(tipo, { beneficio: 'ASSISTENCIAL À PESSOA COM DEFICIÊNCIA' });
      expect(txt).not.toMatch(proibidos);
      expect(txt.length).toBeLessThan(400);
    }
  });

  it('exigência carrega os pontos pendentes quando existem', () => {
    const txt = fallbackMensagemCliente('exigencia', { pontosPendentes: '- RG e CPF\n\n⏳ Prazo: 25/09/2026' });
    expect(txt).toContain('RG e CPF');
    expect(txt).toContain('⏳ Prazo: 25/09/2026');
  });

  it('não aprovado aponta a ação judicial, sem prometer vitória', () => {
    // Alinhado ao áudio que a equipe gravou (04/09/2026): depois do
    // indeferimento o caminho é a Justiça, não o pedido de revisão no INSS.
    // Texto e áudio precisam dizer a mesma coisa — o cliente recebe os dois.
    const txt = fallbackMensagemCliente('indeferido', {});
    expect(txt).toMatch(/ação na Justiça/i);
    expect(txt).not.toMatch(/olhar de novo|recorrer/i);
    expect(txt).not.toMatch(/vamos ganhar|com certeza|garant/i);
  });
});

describe('promptMensagemCliente', () => {
  it('protocolado nunca usa IA (0 dos 296 eventos tem despacho)', () => {
    expect(promptMensagemCliente('protocolado', { despacho: 'qualquer coisa' })).toBeNull();
  });

  it('sem despacho não inventa: cai no texto fixo', () => {
    expect(promptMensagemCliente('indeferido', { despacho: null })).toBeNull();
    expect(promptMensagemCliente('indeferido', { despacho: 'curto demais' })).toBeNull();
  });

  it('com despacho, manda o texto do INSS e as regras de linguagem', () => {
    const p = promptMensagemCliente('indeferido', {
      despacho: 'A Previdência Social comunica que não foi reconhecido o direito ao benefício por não comparecimento à perícia.',
    })!;
    expect(p).toContain('não foi reconhecido o direito');
    expect(p).toContain('baixa renda');
    expect(p).toMatch(/NUNCA repita número/);
  });
});

// O vitest.config fixa TZ=America/Sao_Paulo, então `-03:00` é a hora local.
describe('dentroDaJanela', () => {
  it('abre às 8h e fecha às 20h de Brasília', () => {
    expect(dentroDaJanela(new Date('2026-08-26T07:59:00-03:00'))).toBe(false);
    expect(dentroDaJanela(new Date('2026-08-26T08:00:00-03:00'))).toBe(true);
    expect(dentroDaJanela(new Date('2026-08-26T19:59:00-03:00'))).toBe(true);
    expect(dentroDaJanela(new Date('2026-08-26T20:00:00-03:00'))).toBe(false);
    expect(dentroDaJanela(new Date('2026-08-26T03:00:00-03:00'))).toBe(false);
  });

  it('lê o fuso de Brasília, não o do servidor (Railway roda em UTC)', () => {
    // 10:00 UTC = 07:00 em Brasília: hora comercial no servidor, cedo demais aqui.
    expect(dentroDaJanela(new Date('2026-08-26T10:00:00Z'))).toBe(false);
    // 22:00 UTC = 19:00 em Brasília: madrugada no servidor, ainda dentro aqui.
    expect(dentroDaJanela(new Date('2026-08-26T22:00:00Z'))).toBe(true);
  });
});

describe('eventoElegivelParaZap', () => {
  it('evento anterior ao corte nunca vira mensagem', () => {
    expect(eventoElegivelParaZap('2026-08-20T10:00:00Z')).toBe(false);
    expect(eventoElegivelParaZap(null)).toBe(false);
    expect(eventoElegivelParaZap('data inválida')).toBe(false);
  });

  it('evento a partir do corte é elegível', () => {
    expect(eventoElegivelParaZap(ZAP_CLIENTE_DESDE)).toBe(true);
    expect(eventoElegivelParaZap('2026-09-01T03:00:00Z')).toBe(true);
  });
});

describe('mensagemVaiAoCliente', () => {
  it('deferimento fica só com a equipe', () => {
    // Decisão do usuário (04/09/2026): aprovação não vira zap automático. O
    // tipo continua classificado — é o que permite seguir medindo quantas
    // aprovações chegaram — mas quem fala com o cliente é gente.
    expect(mensagemVaiAoCliente('deferido')).toBe(false);
  });

  it('os outros tipos continuam indo ao cliente', () => {
    for (const tipo of ['protocolado', 'exigencia', 'indeferido', 'arquivado_decurso'] as const) {
      expect(mensagemVaiAoCliente(tipo)).toBe(true);
    }
  });
});
