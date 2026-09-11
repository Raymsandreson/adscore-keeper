/**
 * A lista de categorias da API tem ~80 itens numa caixa de 160px de altura:
 * achar "Combustível" era rolar no olho. Estes testes prendem a busca por texto:
 *
 *  1. filtra pelo trecho digitado, escondendo o resto;
 *  2. ignora acento e caixa ("combustivel" acha "Combustível");
 *  3. termo sem resultado avisa, em vez de mostrar caixa vazia sem explicação.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({
    categories: [],
    loading: false,
    addCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    getCategoryExpenseCount: vi.fn().mockResolvedValue(0),
    getParentCategories: () => [],
    getSubcategories: () => [],
  }),
}));

vi.mock('@/hooks/useAccountCategoryLinks', () => ({
  useAccountCategoryLinks: () => ({
    getLinksForCategory: () => [],
    setLinksForCategory: vi.fn(),
  }),
}));

// Mantém a lista real de categorias da API — o filtro é testado contra ela.
vi.mock('@/hooks/useCategoryApiMappings', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useCategoryApiMappings')>();
  return {
    availableApiCategories: real.availableApiCategories,
    useCategoryApiMappings: () => ({
      mappings: [],
      getMappingsForCategory: () => [],
      setMappingsForCategory: vi.fn(),
    }),
  };
});

import { ExpenseCategoryManager } from '../ExpenseCategoryManager';

async function abrirDialogo() {
  const user = userEvent.setup();
  render(<ExpenseCategoryManager />);
  await user.click(screen.getByRole('button', { name: /Nova Categoria/i }));
  return user;
}

describe('ExpenseCategoryManager — busca nas categorias da API', () => {
  it('sem busca, mostra a lista inteira', async () => {
    await abrirDialogo();
    expect(screen.getByLabelText('Transporte')).toBeInTheDocument();
    expect(screen.getByLabelText('Restaurantes')).toBeInTheDocument();
  });

  it('filtra pelo trecho digitado e esconde o que não casa', async () => {
    const user = await abrirDialogo();
    await user.type(screen.getByPlaceholderText('Buscar categoria...'), 'transp');

    expect(screen.getByLabelText('Transporte')).toBeInTheDocument();
    expect(screen.getByLabelText('Transporte Público')).toBeInTheDocument();
    expect(screen.queryByLabelText('Restaurantes')).not.toBeInTheDocument();
  });

  it('ignora acento e caixa', async () => {
    const user = await abrirDialogo();
    await user.type(screen.getByPlaceholderText('Buscar categoria...'), 'COMBUSTIVEL');

    expect(screen.getByLabelText('Combustível')).toBeInTheDocument();
    expect(screen.getByLabelText('Postos de Combustível')).toBeInTheDocument();
    expect(screen.queryByLabelText('Transporte')).not.toBeInTheDocument();
  });

  it('termo sem resultado avisa em vez de deixar a caixa muda', async () => {
    const user = await abrirDialogo();
    await user.type(screen.getByPlaceholderText('Buscar categoria...'), 'zzzz');

    expect(screen.getByText('Nenhuma categoria encontrada para "zzzz".')).toBeInTheDocument();
  });

  it('limpar a busca traz a lista de volta', async () => {
    const user = await abrirDialogo();
    const campo = screen.getByPlaceholderText('Buscar categoria...');
    await user.type(campo, 'transp');
    expect(screen.queryByLabelText('Restaurantes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getByLabelText('Restaurantes')).toBeInTheDocument();
  });
});
