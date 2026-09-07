import { describe, it, expect } from 'vitest';
import { erroLegivel } from '../erroDoBanco';

// Os erros abaixo são os que o gatilho lead_processes_numero_valido levanta de
// verdade — copiados da migration 20260907120000, não inventados.
const CNJ_COM_DIGITO_A_MAIS = {
  code: '23514',
  message: 'CNJ inválido: 1505819-97.2025.8.26.03788',
  details: 'Está escrito no formato de CNJ mas tem 21 dígitos, e CNJ tem 20.',
  hint: 'Confira o número na fonte — quase sempre é um dígito a mais ou a menos no fim. Se não for CNJ, escreva sem a pontuação de CNJ (protocolo, NB e boletim de ocorrência entram normalmente).',
};

describe('erroLegivel', () => {
  it('põe o "o quê" no título e junta "por quê" com "e agora" na descrição', () => {
    const { titulo, descricao } = erroLegivel(CNJ_COM_DIGITO_A_MAIS, 'Erro ao salvar');
    expect(titulo).toBe('CNJ inválido: 1505819-97.2025.8.26.03788');
    expect(descricao).toContain('tem 21 dígitos, e CNJ tem 20');
    expect(descricao).toContain('Confira o número na fonte');
  });

  it('sem detail nem hint, não inventa descrição', () => {
    const { titulo, descricao } = erroLegivel(
      { message: 'Processo 0056732-43.2026.4.05.8300 já cadastrado.' },
      'Erro ao salvar',
    );
    expect(titulo).toBe('Processo 0056732-43.2026.4.05.8300 já cadastrado.');
    expect(descricao).toBeUndefined();
  });

  it('sem mensagem, cai no título padrão com o código para o suporte', () => {
    expect(erroLegivel({ code: '42501' }, 'Não consegui salvar o processo')).toEqual({
      titulo: 'Não consegui salvar o processo (42501)',
      descricao: undefined,
    });
  });

  it('erro que não é objeto do Postgrest não quebra a tela', () => {
    expect(erroLegivel(null, 'Erro ao salvar').titulo).toBe('Erro ao salvar');
    expect(erroLegivel('caiu a rede', 'Erro ao salvar').titulo).toBe('Erro ao salvar');
    expect(erroLegivel(new Error('Failed to fetch'), 'Erro ao salvar').titulo).toBe('Failed to fetch');
  });

  it('campo em branco vale como ausente — nada de título vazio', () => {
    const { titulo, descricao } = erroLegivel(
      { message: '   ', details: '', hint: '  ', code: '23514' },
      'Erro ao salvar',
    );
    expect(titulo).toBe('Erro ao salvar (23514)');
    expect(descricao).toBeUndefined();
  });
});
