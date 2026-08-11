import { describe, it, expect } from 'vitest';
import { buildPersonAvatar, type Acolhedor } from '../useAcolhedores';
import { pickProfileAvatar, type ProfileAvatar } from '../useProfileAvatars';

const FOTO_PERFIL = 'https://kmedldlepwiityjsdahz.supabase.co/storage/v1/object/public/avatars/alexandre.jpg';

const PERFIS: ProfileAvatar[] = [
  {
    user_id: 'cfab247e-c8e3-40c4-8aa7-5dbf367ea9b1',
    full_name: 'Alexandre Medeiros Cavalcante',
    avatar_url: FOTO_PERFIL,
  },
];

const resolvePerfil = (name: string | null | undefined) => pickProfileAvatar(PERFIS, name);
const semPerfil = () => null;

describe('pickProfileAvatar', () => {
  it('casa ignorando caixa e acento', () => {
    expect(pickProfileAvatar(PERFIS, 'alexandre medeiros cavalcante')).toBe(FOTO_PERFIL);
    expect(pickProfileAvatar(PERFIS, 'ALEXANDRE  MEDEIROS   CAVALCANTE')).toBe(FOTO_PERFIL);
  });

  it('não casa nome parcial nem vazio', () => {
    expect(pickProfileAvatar(PERFIS, 'Alexandre')).toBeNull();
    expect(pickProfileAvatar(PERFIS, '')).toBeNull();
    expect(pickProfileAvatar(PERFIS, null)).toBeNull();
  });
});

describe('buildPersonAvatar', () => {
  it('usa a foto do perfil quando a pessoa não está em acolhedores (caso do responsável da atividade)', () => {
    const av = buildPersonAvatar('Alexandre Medeiros Cavalcante', [], resolvePerfil);
    expect(av?.fotoUrl).toBe(FOTO_PERFIL);
    expect(av?.acolhedor).toBeNull();
  });

  it('sem foto de perfil e sem acolhedor, cai nas iniciais (comportamento antigo)', () => {
    const av = buildPersonAvatar('Alexandre Medeiros Cavalcante', [], semPerfil);
    expect(av?.fotoUrl).toBeNull();
    expect(av?.initials).toBe('AM');
    expect(av?.bgColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('foto do perfil ganha da foto_url curada em acolhedores', () => {
    const acolhedores: Acolhedor[] = [
      {
        id: '1',
        nome_canonico: 'Alexandre Medeiros Cavalcante',
        foto_url: 'https://exemplo/curada.jpg',
        aliases: [],
        ativo: true,
      },
    ];
    expect(buildPersonAvatar('Alexandre Medeiros Cavalcante', acolhedores, resolvePerfil)?.fotoUrl)
      .toBe(FOTO_PERFIL);
  });

  it('resolve pelo alias: acha o registro pelo apelido e a foto pelo nome canônico', () => {
    const acolhedores: Acolhedor[] = [
      {
        id: '1',
        nome_canonico: 'Alexandre Medeiros Cavalcante',
        foto_url: null,
        aliases: ['Alexandre'],
        ativo: true,
      },
    ];
    const av = buildPersonAvatar('Alexandre', acolhedores, resolvePerfil);
    expect(av?.fotoUrl).toBe(FOTO_PERFIL);
    expect(av?.initials).toBe('AM');
  });

  it('sem foto de perfil, mantém a foto_url de acolhedores', () => {
    const acolhedores: Acolhedor[] = [
      { id: '2', nome_canonico: 'Fulana de Tal', foto_url: 'https://exemplo/fulana.jpg', aliases: [], ativo: true },
    ];
    expect(buildPersonAvatar('Fulana de Tal', acolhedores, semPerfil)?.fotoUrl)
      .toBe('https://exemplo/fulana.jpg');
  });

  it('nome vazio devolve null', () => {
    expect(buildPersonAvatar('', [], resolvePerfil)).toBeNull();
    expect(buildPersonAvatar(null, [], resolvePerfil)).toBeNull();
  });
});
