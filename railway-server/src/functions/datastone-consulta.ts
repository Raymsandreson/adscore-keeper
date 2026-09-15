// Consulta cadastral na Data Stone a partir do telefone do lead.
//
// O alvo: em 15/09/2026 havia 12.224 leads vivos com telefone brasileiro e SEM
// CPF. É o dado que procuração e requerimento do INSS precisam e que hoje só
// chega por OCR de documento. O caminho inverso (CPF -> telefone) alcançaria 6
// leads, então é este o lado que vale crédito.
//
// TRÊS TRAVAS, porque cada chamada custa dinheiro e mexe em ficha de cliente:
//
//  1. CACHE. `/persons/search/` não tem carência de 24h — reconsultar o mesmo
//     telefone cobra de novo. Antes de ir à rede, procura em datastone_consultas.
//  2. TETO DIÁRIO. O rate limit da conta é 100/dia e estourar bloqueia por 24h.
//     O teto sai de system_settings (`datastone_teto_diario`, padrão 80) e o
//     lote PARA ao atingir, em vez de continuar e levar bloqueio.
//  3. GATE DE NOME. Telefone é chave forte, mas número reciclado existe. Só
//     grava no lead quando o nome retornado bate com o nome do lead
//     (conferirNomeDoSegurado, o mesmo comparador do vínculo do INSS).
//     Conflito não grava nada: fica registrado para conferência humana.
//
// Modo `simular: true` responde quem seria consultado e por quê, sem tocar na
// rede e sem gastar um crédito.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import { chamarDatastone, mascararTelefone, mascararCpf } from '../lib/datastone';
import {
  telefoneParaConsulta,
  camposParaGravar,
  cpfDaResposta,
  hashChave,
  type PessoaDataStone,
} from '../lib/datastone-lead';
import { conferirNomeDoSegurado } from '../lib/inss-nome-confere';

const COLUNAS_LEAD =
  'id, lead_name, victim_name, lead_phone, cpf, rg, birth_date, cep, street, street_number, complement, neighborhood, city, state';

const TETO_PADRAO = 80;

async function tetoDiario(): Promise<number> {
  const { data } = await ext
    .from('system_settings')
    .select('value')
    .eq('key', 'datastone_teto_diario')
    .maybeSingle();
  const n = parseInt(String((data as any)?.value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : TETO_PADRAO;
}

async function gastoDeHoje(): Promise<number> {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const { count } = await ext
    .from('datastone_consultas')
    .select('id', { count: 'exact', head: true })
    .gt('creditos', 0)
    .gte('created_at', inicio.toISOString());
  return count ?? 0;
}

export const handler: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as {
    lead_id?: string;
    lead_ids?: string[];
    limite?: number;
    gravar?: boolean;
    simular?: boolean;
    formato_telefone?: 'nacional' | 'e164';
    /** Busca também a ficha completa por CPF (+1 crédito, só com nome conferido). */
    completo?: boolean;
  };
  const gravar = body.gravar !== false;
  const simular = body.simular === true;
  const formato = body.formato_telefone || 'nacional';
  const limite = Math.min(Math.max(body.limite ?? 10, 1), 200);

  // Seleção dos alvos: ids explícitos, ou a fila (telefone brasileiro, sem CPF).
  let leads: any[] = [];
  if (body.lead_id || body.lead_ids?.length) {
    const ids = body.lead_ids?.length ? body.lead_ids : [body.lead_id!];
    const { data, error } = await ext.from('leads').select(COLUNAS_LEAD).in('id', ids);
    if (error) return res.status(200).json({ success: false, error: error.message });
    leads = data || [];
  } else {
    const { data, error } = await ext
      .from('leads')
      .select(COLUNAS_LEAD)
      .is('deleted_at', null)
      .is('cpf', null)
      .not('lead_phone', 'is', null)
      .like('lead_phone', '55%')
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) return res.status(200).json({ success: false, error: error.message });
    leads = data || [];
  }

  const teto = await tetoDiario();
  let gasto = await gastoDeHoje();

  const detalhes: any[] = [];
  let consultados = 0;
  let doCache = 0;
  let encontrados = 0;
  let gravados = 0;
  let conflitos = 0;
  let creditos = 0;
  let tetoAtingido = false;

  for (const lead of leads) {
   // try por lead: um retorno fora do formato esperado não pode derrubar o lote
   // inteiro — o crédito das consultas já feitas estaria pago e sem desfecho.
   try {
    const tel = telefoneParaConsulta(lead.lead_phone);
    if (!tel.tel) {
      detalhes.push({ lead_id: lead.id, acao: 'recusado', motivo: tel.motivo, detalhe: tel.detalhe });
      continue;
    }

    const valor = formato === 'e164' ? tel.tel.e164 : `${tel.tel.ddd}${tel.tel.numero}`;
    const chave = hashChave('telefone', tel.tel.e164);

    // 1. Cache — vale para qualquer formato, a chave é o telefone normalizado.
    const { data: cacheado } = await ext
      .from('datastone_consultas')
      .select('id, resposta, encontrou, created_at')
      .eq('chave_hash', chave)
      .eq('encontrou', true)
      .gt('expira_em', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let pessoa: PessoaDataStone = null;
    let veioDoCache = false;

    if (cacheado?.resposta) {
      pessoa = (Array.isArray(cacheado.resposta) ? cacheado.resposta[0] : cacheado.resposta) as PessoaDataStone;
      veioDoCache = true;
      doCache++;
    } else {
      if (simular) {
        detalhes.push({ lead_id: lead.id, acao: 'consultaria', telefone: mascararTelefone(tel.tel.e164) });
        continue;
      }
      // 2. Teto diário — para antes de levar bloqueio de 24h.
      if (gasto >= teto) {
        tetoAtingido = true;
        detalhes.push({ lead_id: lead.id, acao: 'adiado', motivo: `teto diário de ${teto} atingido` });
        break;
      }

      const r = await chamarDatastone<PessoaDataStone[]>('/persons/search/', { query: { phone: valor } });
      consultados++;

      const lista = Array.isArray(r.dados) ? r.dados : [];
      const achou = r.ok && lista.length > 0;
      if (achou) {
        pessoa = lista[0];
        encontrados++;
        creditos += 1;
        gasto += 1;
      }

      await ext.from('datastone_consultas').insert({
        endpoint: '/persons/search/',
        chave_tipo: 'telefone',
        chave_hash: chave,
        chave_mascarada: mascararTelefone(tel.tel.e164),
        lead_id: lead.id,
        status: r.status,
        creditos: achou ? 1 : 0,
        encontrou: achou,
        resposta: achou ? (lista as any) : null,
      });

      if (!r.ok) {
        detalhes.push({ lead_id: lead.id, acao: 'erro', falha: r.falha, motivo: r.motivo, status: r.status });
        // 429 é bloqueio de 24h: parar o lote inteiro, não só este lead.
        if (r.falha === 'rate_limit' || r.falha === 'sem_credito' || r.falha === 'chave_ou_ip') break;
        continue;
      }
      if (!achou) {
        detalhes.push({ lead_id: lead.id, acao: 'sem_retorno', telefone: mascararTelefone(tel.tel.e164) });
        continue;
      }
    }

    if (!pessoa) continue;

    // 3. Gate de nome — o mesmo comparador que decide vínculo de protocolo do INSS.
    const conferencia = conferirNomeDoSegurado(pessoa.name, {
      victimName: lead.victim_name,
      leadName: lead.lead_name,
    });

    if (conferencia.veredito !== 'ok') {
      if (conferencia.veredito === 'conflito') conflitos++;
      const previa = camposParaGravar(lead, pessoa);
      detalhes.push({
        lead_id: lead.id,
        acao: 'para_conferencia',
        veredito: conferencia.veredito,
        motivo: conferencia.motivo,
        do_cache: veioDoCache,
        campos_disponiveis: Object.keys(previa.campos),
      });
      continue;
    }

    // 4. Ficha completa — SÓ depois do gate aprovar.
    //
    // A busca por telefone devolve um resumo: nome, CPF, idade, cidade e UF.
    // Nascimento, nome da mãe, RG e endereço exigem `/persons/?cpf=`, que é
    // outro crédito. Pagar isso antes de conferir o nome seria comprar a ficha
    // de quem não é o cliente. Esta chamada tem carência de 24h por documento,
    // ao contrário da busca por telefone.
    const cpfAchado = cpfDaResposta(pessoa.cpf);
    if (body.completo && cpfAchado && !simular) {
      const chaveCpf = hashChave('cpf', cpfAchado);
      const { data: fichaCache } = await ext
        .from('datastone_consultas')
        .select('resposta')
        .eq('chave_hash', chaveCpf)
        .eq('encontrou', true)
        .gt('expira_em', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fichaCache?.resposta) {
        const f = Array.isArray(fichaCache.resposta) ? fichaCache.resposta[0] : fichaCache.resposta;
        pessoa = { ...pessoa, ...(f as PessoaDataStone) };
        doCache++;
      } else if (gasto < teto) {
        const rf = await chamarDatastone<PessoaDataStone[]>('/persons/', { query: { cpf: cpfAchado } });
        consultados++;
        const listaF = Array.isArray(rf.dados) ? rf.dados : [];
        const achouF = rf.ok && listaF.length > 0;
        if (achouF) {
          pessoa = { ...pessoa, ...listaF[0] };
          creditos += 1;
          gasto += 1;
        }
        await ext.from('datastone_consultas').insert({
          endpoint: '/persons/',
          chave_tipo: 'cpf',
          chave_hash: chaveCpf,
          chave_mascarada: mascararCpf(cpfAchado),
          lead_id: lead.id,
          status: rf.status,
          creditos: achouF ? 1 : 0,
          encontrou: achouF,
          resposta: achouF ? (listaF as any) : null,
        });
        if (rf.falha === 'rate_limit' || rf.falha === 'sem_credito' || rf.falha === 'chave_ou_ip') {
          detalhes.push({ lead_id: lead.id, acao: 'erro', falha: rf.falha, motivo: rf.motivo });
          break;
        }
      } else {
        tetoAtingido = true;
      }
    }

    const { campos, divergentes } = camposParaGravar(lead, pessoa);

    if (!gravar || Object.keys(campos).length === 0) {
      detalhes.push({
        lead_id: lead.id,
        acao: Object.keys(campos).length === 0 ? 'nada_a_preencher' : 'gravaria',
        campos: Object.keys(campos),
        divergentes,
        do_cache: veioDoCache,
      });
      continue;
    }

    const { error: upErr } = await ext.from('leads').update(campos).eq('id', lead.id);
    if (upErr) {
      detalhes.push({ lead_id: lead.id, acao: 'erro_ao_gravar', motivo: upErr.message });
      continue;
    }
    gravados++;
    await ext
      .from('datastone_consultas')
      .update({ gravou: true, nome_confere: 'ok' })
      .eq('chave_hash', chave)
      .eq('lead_id', lead.id);

    detalhes.push({
      lead_id: lead.id,
      acao: 'gravado',
      campos: Object.keys(campos),
      divergentes,
      do_cache: veioDoCache,
    });
   } catch (err) {
      detalhes.push({
        lead_id: lead.id,
        acao: 'erro_inesperado',
        motivo: err instanceof Error ? err.message : String(err),
      });
   }
  }

  return res.status(200).json({
    success: true,
    modo: simular ? 'simulacao' : gravar ? 'gravando' : 'somente_leitura',
    alvos: leads.length,
    consultados,
    do_cache: doCache,
    encontrados,
    gravados,
    conflitos,
    creditos_gastos: creditos,
    teto_diario: teto,
    gasto_hoje: gasto,
    teto_atingido: tetoAtingido,
    detalhes,
  });
};
