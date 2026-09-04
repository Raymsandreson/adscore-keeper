/**
 * Grupo PREV 1428 (`120363425114615351`) — o caso que abriu a investigação em
 * 18/08/2026: as mesmas mensagens apareciam de lados opostos no menu "Grupo WA"
 * das atividades e na aba do WhatsApp.
 *
 * Medido no Externo naquele dia: 143 linhas para 24 mensagens reais, espelhadas
 * por 4 a 6 instâncias, e 19 das 24 com `direction` conflitante entre espelhos.
 * As linhas abaixo são reais (texto encurtado).
 */
import { describe, it, expect } from 'vitest';
import { mirrorKey, resolveMirrorAuthor, dedupeMirroredMessages } from '../whatsappGroupMirror';

/** `whatsapp_instances.owner_phone` das instâncias que participam do grupo. */
const NOSSOS = new Set(['558688461349', '558688257217', '558688437181', '558694000545']);

/** "Certo" — enviada por nós; 5 espelhos, só 1 gravado como outbound. */
const CERTO = [
  { id: 'a1', direction: 'inbound', created_at: '2026-06-15T19:05:33.100Z', external_message_id: 'Raym:54AE9555100D', sender_pn: '558688257217@s.whatsapp.net', sender_name: 'Atendimento Previdenciário 2' },
  { id: 'a2', direction: 'inbound', created_at: '2026-06-15T19:05:33.300Z', external_message_id: 'ISRAEL:54AE9555100D', sender_pn: '558688257217@s.whatsapp.net', sender_name: 'Atendimento Previdenciário 2' },
  { id: 'a3', direction: 'outbound', created_at: '2026-06-15T19:05:33.500Z', external_message_id: 'AtendPrev:54AE9555100D', sender_pn: '558688257217@s.whatsapp.net', sender_name: 'Atendimento Previdenciário 2' },
  { id: 'a4', direction: 'inbound', created_at: '2026-06-15T19:05:33.700Z', external_message_id: 'Dom:54AE9555100D', sender_pn: '558688257217@s.whatsapp.net', sender_name: 'Atendimento Previdenciário 2' },
];

/** "Pode ser por mensagem" — resposta real da cliente Ivana. Nenhum espelho outbound. */
const IVANA = [
  { id: 'b1', direction: 'inbound', created_at: '2026-06-15T13:27:10.100Z', external_message_id: 'Raym:421A6FFA398F', sender_pn: '554195769554@s.whatsapp.net', sender_name: 'Ivana Silva' },
  { id: 'b2', direction: 'inbound', created_at: '2026-06-15T13:27:10.400Z', external_message_id: 'Dom:421A6FFA398F', sender_pn: '554195769554@s.whatsapp.net', sender_name: 'Ivana Silva' },
];

/** Enviada do celular do "Dom", fora do sistema: nenhum espelho outbound. */
const DOM_NO_CELULAR = [
  { id: 'c1', direction: 'inbound', created_at: '2026-06-14T18:02:00.000Z', external_message_id: 'Raym:2A1E882D287A', sender_pn: '558688437181@s.whatsapp.net', sender_name: 'Dom-Abraci' },
];

describe('mirrorKey', () => {
  it('pareia espelhos pelo tail do external_message_id', () => {
    expect(new Set(CERTO.map(mirrorKey)).size).toBe(1);
    expect(mirrorKey(CERTO[0])).toBe('ext:54AE9555100D');
  });

  it('sem external_message_id, cada linha é a sua própria mensagem', () => {
    expect(mirrorKey({ id: 'x', external_message_id: null })).toBe('row:x');
    expect(mirrorKey({ id: 'y', external_message_id: '' })).toBe('row:y');
  });
});

describe('resolveMirrorAuthor', () => {
  it('um único espelho outbound basta para a mensagem ser nossa', () => {
    const r = resolveMirrorAuthor(CERTO, NOSSOS);
    expect(r.direction).toBe('outbound');
    expect(r.group_sender_name).toBeNull();
  });

  it('o veredito não muda com a ordem dos espelhos (ASC vs DESC)', () => {
    const asc = resolveMirrorAuthor(CERTO, NOSSOS);
    const desc = resolveMirrorAuthor([...CERTO].reverse(), NOSSOS);
    expect(asc.direction).toBe(desc.direction);
  });

  it('resposta da cliente continua inbound, com nome e telefone', () => {
    const r = resolveMirrorAuthor(IVANA, NOSSOS);
    expect(r.direction).toBe('inbound');
    expect(r.group_sender_name).toBe('Ivana Silva');
    expect(r.group_sender_phone).toBe('554195769554');
  });

  it('mensagem digitada no celular da equipe é nossa pelo número, sem espelho outbound', () => {
    expect(resolveMirrorAuthor(DOM_NO_CELULAR, NOSSOS).direction).toBe('outbound');
    // Sem o roster de instâncias, sobra só o sinal do outbound — vira inbound.
    expect(resolveMirrorAuthor(DOM_NO_CELULAR).direction).toBe('inbound');
  });

  it('nunca expõe o @lid como telefone', () => {
    const r = resolveMirrorAuthor([
      { id: 'd1', direction: 'inbound', sender_lid: '136227957272816@lid', sender_name: 'Cliente' },
    ], NOSSOS);
    expect(r.group_sender_phone).toBeNull();
    expect(r.group_sender_name).toBe('Cliente');
  });

  it('lê o autor do metadata cru quando não há projeção (aba do WhatsApp)', () => {
    const r = resolveMirrorAuthor([
      { id: 'e1', direction: 'inbound', metadata: { message: { senderName: 'Ivana Silva', sender_pn: '554195769554@s.whatsapp.net' } } },
    ], NOSSOS);
    expect(r.group_sender_name).toBe('Ivana Silva');
    expect(r.group_sender_phone).toBe('554195769554');
  });
});

describe('dedupeMirroredMessages', () => {
  const TODAS = [...IVANA, ...CERTO];

  it('colapsa os espelhos em uma mensagem por id do WhatsApp', () => {
    expect(TODAS).toHaveLength(6);
    expect(dedupeMirroredMessages(TODAS, { ourPhones: NOSSOS })).toHaveLength(2);
  });

  it('as duas telas concordam sobre quem falou, apesar das ordens opostas', () => {
    const menu = dedupeMirroredMessages(TODAS, { ourPhones: NOSSOS });          // ASC
    const chat = dedupeMirroredMessages([...TODAS].reverse(), { ourPhones: NOSSOS }); // DESC
    const lado = (rows: Array<{ direction: string; mirror_ids: string[] }>) =>
      Object.fromEntries(rows.map(r => [r.mirror_ids.slice().sort().join(','), r.direction]));
    expect(lado(menu)).toEqual(lado(chat));
  });

  it('mantém a primeira linha da ordem de entrada como canônica (o selo "Virou atividade" casa por id)', () => {
    expect(dedupeMirroredMessages(CERTO, { ourPhones: NOSSOS })[0].id).toBe('a1');
    expect(dedupeMirroredMessages([...CERTO].reverse(), { ourPhones: NOSSOS })[0].id).toBe('a4');
  });

  it('guarda os ids de todos os espelhos', () => {
    expect(dedupeMirroredMessages(CERTO, { ourPhones: NOSSOS })[0].mirror_ids).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('preserva a ordem de entrada', () => {
    const out = dedupeMirroredMessages(TODAS, { ourPhones: NOSSOS });
    expect(out.map(m => m.id)).toEqual(['b1', 'a1']);
  });

  it('conversa privada (sem espelho) passa intacta', () => {
    const privada = [
      { id: 'p1', direction: 'inbound', external_message_id: 'cris:AAA', created_at: '2026-08-18T10:00:00Z' },
      { id: 'p2', direction: 'outbound', external_message_id: 'cris:BBB', created_at: '2026-08-18T10:01:00Z' },
    ];
    const out = dedupeMirroredMessages(privada, { ourPhones: NOSSOS });
    expect(out.map(m => [m.id, m.direction])).toEqual([['p1', 'inbound'], ['p2', 'outbound']]);
  });
});

/**
 * PREV 2209 (`120363412100298990`) — caso real de 04/09/2026, o que motivou o
 * campo `sent_by_instance`: "Vocês recebem bolsa família?" gravada 4 vezes, uma
 * por instância nossa no grupo. A linha canônica (a primeira da lista) é de uma
 * instância que apenas RECEBEU; mostrar o `instance_name` dela na bolha diria o
 * número errado.
 */
const BOLSA_FAMILIA = [
  { id: 'x1', direction: 'inbound', instance_name: 'Atendimento Previdenciário 2', external_message_id: '558688257217:3EB0F3DC4B8CB465010BD6', created_at: '2026-09-04T16:41:32.893Z' },
  { id: 'x2', direction: 'inbound', instance_name: 'Luiz Abraci', external_message_id: '558688054381:3EB0F3DC4B8CB465010BD6', created_at: '2026-09-04T16:41:32.584Z' },
  { id: 'x3', direction: 'outbound', instance_name: 'Raym', external_message_id: '558695590127:3EB0F3DC4B8CB465010BD6', created_at: '2026-09-04T16:41:32.474Z' },
  { id: 'x4', direction: 'inbound', instance_name: 'Atendimento Previdenciário', external_message_id: '558694000545:3EB0F3DC4B8CB465010BD6', created_at: '2026-09-04T16:41:32.423Z' },
];

describe('sent_by_instance — por qual número saiu', () => {
  it('é a instância do espelho outbound, não a da linha canônica', () => {
    const [msg] = dedupeMirroredMessages(BOLSA_FAMILIA, { ourPhones: NOSSOS });
    expect(msg.instance_name).toBe('Atendimento Previdenciário 2'); // canônica: só recebeu
    expect(msg.sent_by_instance).toBe('Raym');                      // quem enviou de verdade
  });

  it('não depende da ordem de entrada', () => {
    const asc = dedupeMirroredMessages(BOLSA_FAMILIA, { ourPhones: NOSSOS })[0];
    const desc = dedupeMirroredMessages([...BOLSA_FAMILIA].reverse(), { ourPhones: NOSSOS })[0];
    expect(asc.sent_by_instance).toBe('Raym');
    expect(desc.sent_by_instance).toBe('Raym');
  });

  it('mensagem do celular (sem espelho outbound) resolve pelo telefone do autor', () => {
    const porTelefone = new Map([['558688437181', 'Dom-Abraci']]);
    const [msg] = dedupeMirroredMessages(DOM_NO_CELULAR, {
      ourPhones: NOSSOS,
      instanceNameByPhone: porTelefone,
    });
    expect(msg.direction).toBe('outbound');
    expect(msg.sent_by_instance).toBe('Dom-Abraci');
  });

  it('sem o mapa, mensagem do celular fica sem instância — não chuta', () => {
    const [msg] = dedupeMirroredMessages(DOM_NO_CELULAR, { ourPhones: NOSSOS });
    expect(msg.sent_by_instance).toBeNull();
  });

  it('mensagem do cliente não tem instância remetente', () => {
    const [msg] = dedupeMirroredMessages(IVANA, { ourPhones: NOSSOS });
    expect(msg.direction).toBe('inbound');
    expect(msg.sent_by_instance).toBeNull();
  });
});
