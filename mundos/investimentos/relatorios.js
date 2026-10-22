import { sb } from '../../shared/supabase.js';
import { toast, fmtDate } from '../../shared/ui.js';
import { temPapel } from '../../shared/acesso.js';
import { fmtMoeda, badgeStatusPai, STATUS_PAI_LABELS, TIPO_INVESTIMENTO_LABELS } from './dashboard.js';
import { resolverEscoposSolicitante } from './solicitacao.js';

// ═══════════════════════════════════════════════════
// RELATÓRIOS EXPORTÁVEIS DO MUNDO INVESTIMENTOS (Etapa 12/16)
//
// Mesmo corte de acesso do dashboard (painel.js): alçada ampla
// (controladoria_op, inv_aprovador, diretor, diretor_ceo,
// controladoria_contabil — ou master, via tem_papel) vê grupo + todas as
// unidades; quem só é inv_solicitante vê só a(s) própria(s) área(s).
//
// Fontes reaproveitadas do dashboard, sem SQL novo: saldo_areas e
// realizado_por_area (Etapa 6/10) para o Consolidado; pais/itens_pai para
// PAIs e Auditoria; linhas_plano tipo=devolucao para o "Ajuste de saldo
// (débito)" — desde a Etapa 15, só o excedente do encerramento entra aí.
//
// Filtros (ano, empresa, área, status, tipo) recarregam os dados; trocar
// de aba só troca a visão sobre os dados já carregados (estado.dados).
// Exportação (XLSX/PDF) sempre gera as 5 tabelas (Consolidado por área,
// Consolidado por unidade, Por categoria de composição, PAIs, Auditoria)
// no recorte atual, independente de qual aba estiver aberta no clique.
// ═══════════════════════════════════════════════════

const PAPEIS_ALCADA_AMPLA = ['controladoria_op', 'inv_aprovador', 'diretor', 'diretor_ceo', 'controladoria_contabil'];

let estado = null;

function numOrZero(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

// ═══════════════════════════════════════════════════
// CARGA INICIAL — escopo, anos, empresas/áreas/tipos disponíveis
// ═══════════════════════════════════════════════════
export async function renderRelatorios() {
  document.getElementById('topbar-title').textContent = 'Relatórios';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const resultadosPapeis = await Promise.all(PAPEIS_ALCADA_AMPLA.map(p => temPapel('investimentos', p)));
  const amplo = resultadosPapeis.some(Boolean);

  let escoposRestritos = [];
  if (!amplo) {
    escoposRestritos = await resolverEscoposSolicitante();
    await Promise.all(escoposRestritos.map(async e => {
      const { data: areaId } = await sb.rpc('area_do_setor_emp', { p_empresa: e.empresaId, p_setor: e.setorId });
      e.areaId = areaId || null;
    }));
    if (!escoposRestritos.length) {
      page.innerHTML = `<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-title">Sem área de investimento atribuída</div><div class="empty-desc">Fale com o administrador para liberar seu acesso numa empresa/área.</div></div>`;
      return;
    }
  }

  const empresaIdsEscopo = amplo ? null : [...new Set(escoposRestritos.map(e => e.empresaId))];

  // categorias_composicao: todas (inclusive inativas) — PAIs antigos podem
  // usar uma categoria desativada depois e ela ainda precisa de nome/ordem.
  const [{ data: empresasTodas }, { data: planos }, { data: tiposInvestimento }, { data: areasTodas }, { data: categoriasComposicao }] = await Promise.all([
    sb.from('empresas').select('id,nome').eq('ativo', true).order('nome'),
    sb.from('planos_investimento').select('ano_calendario, empresa_id').order('ano_calendario'),
    sb.from('tipos_investimento').select('id,nome').eq('ativo', true).order('ordem'),
    sb.from('areas').select('id,nome').eq('ativa', true).order('ordem'),
    sb.from('categorias_composicao').select('id,nome,ordem').order('ordem')
  ]);

  const empresasEscopo = amplo ? (empresasTodas || []) : (empresasTodas || []).filter(e => empresaIdsEscopo.includes(e.id));
  const planosEscopo = amplo ? (planos || []) : (planos || []).filter(p => empresaIdsEscopo.includes(p.empresa_id));
  const anosDisponiveis = [...new Set(planosEscopo.map(p => p.ano_calendario))].sort((a, b) => a - b);

  if (!anosDisponiveis.length) {
    page.innerHTML = `<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-title">Nenhum plano lançado ainda</div><div class="empty-desc">Os relatórios aparecem assim que houver ao menos um plano de investimento publicado no seu escopo.</div></div>`;
    return;
  }

  const anoAtual = new Date().getFullYear();
  const anoDefault = anosDisponiveis.includes(anoAtual) ? anoAtual : anosDisponiveis[anosDisponiveis.length - 1];

  const areaIdsRestritos = amplo ? null : [...new Set(escoposRestritos.map(e => e.areaId).filter(Boolean))];
  const areasEscopo = amplo ? (areasTodas || []) : (areasTodas || []).filter(a => areaIdsRestritos.includes(a.id));

  estado = {
    amplo, empresasEscopo, areasEscopo, areaIdsRestritos,
    tiposInvestimento: tiposInvestimento || [],
    categoriasComposicao: categoriasComposicao || [],
    anosDisponiveis, ano: anoDefault, aba: 'consolidado',
    filtros: { empresaIds: [], areaIds: [], statusList: [], tipos: [] },
    dados: null
  };
  await carregarConteudo();
}

// ═══════════════════════════════════════════════════
// RESOLUÇÃO DE ESCOPO EFETIVO (permitido pelo papel × filtro escolhido)
// ═══════════════════════════════════════════════════
function empresaIdsEfetivos() {
  const permitidos = estado.empresasEscopo.map(e => e.id);
  return estado.filtros.empresaIds.length ? permitidos.filter(id => estado.filtros.empresaIds.includes(id)) : permitidos;
}
function areaIdsEfetivos() {
  let base = estado.areaIdsRestritos; // null (amplo, sem restrição) ou array (restrito ao solicitante)
  if (estado.filtros.areaIds.length) {
    base = base ? base.filter(id => estado.filtros.areaIds.includes(id)) : estado.filtros.areaIds;
  }
  return base; // null = todas as áreas
}

// ═══════════════════════════════════════════════════
// CARGA DE DADOS (respeitando escopo + filtros)
// ═══════════════════════════════════════════════════
async function carregarDados() {
  const empresaIds = empresaIdsEfetivos();
  const areaIds = areaIdsEfetivos();
  if (!empresaIds.length) return { saldos: [], realizados: [], pais: [], devolucaoLinhas: [], bensPorPai: {}, itens: [] };

  let saldosQuery = sb.from('saldo_areas').select('*').eq('ano_calendario', estado.ano).in('empresa_id', empresaIds);
  let realizadosQuery = sb.from('realizado_por_area').select('*').eq('ano_calendario', estado.ano).in('empresa_id', empresaIds);
  if (areaIds) { saldosQuery = saldosQuery.in('area_id', areaIds); realizadosQuery = realizadosQuery.in('area_id', areaIds); }

  let paisQuery = sb.from('pais').select('*, empresas(nome), setores(nome)').eq('ano_calendario', estado.ano).in('empresa_id', empresaIds);
  if (estado.filtros.statusList.length) paisQuery = paisQuery.in('status', estado.filtros.statusList);
  if (estado.filtros.tipos.length) paisQuery = paisQuery.in('tipo', estado.filtros.tipos);

  const [{ data: saldos }, { data: realizados }, { data: paisRows }, { data: devolucaoLinhas }, { data: mapaSetorArea }] = await Promise.all([
    saldosQuery, realizadosQuery, paisQuery,
    sb.from('linhas_plano').select('valor,setor_id,planos_investimento!inner(empresa_id,ano_calendario)')
      .eq('tipo', 'devolucao').eq('cancelada', false)
      .eq('planos_investimento.ano_calendario', estado.ano).in('planos_investimento.empresa_id', empresaIds),
    sb.from('empresa_setores').select('empresa_id,setor_id,area_id,areas(nome)').in('empresa_id', empresaIds)
  ]);

  const areaDoSetor = {};
  (mapaSetorArea || []).forEach(m => { areaDoSetor[`${m.empresa_id}·${m.setor_id}`] = { id: m.area_id, nome: m.areas?.nome || '—' }; });

  let paisFiltrados = (paisRows || []).map(p => ({ ...p, _area: areaDoSetor[`${p.empresa_id}·${p.setor_id}`] || null }));
  if (areaIds) paisFiltrados = paisFiltrados.filter(p => p._area && areaIds.includes(p._area.id));

  let devolucaoFiltrada = (devolucaoLinhas || []).map(l => ({
    ...l, _empresaId: l.planos_investimento?.empresa_id,
    _area: areaDoSetor[`${l.planos_investimento?.empresa_id}·${l.setor_id}`] || null
  }));
  if (areaIds) devolucaoFiltrada = devolucaoFiltrada.filter(l => l._area && areaIds.includes(l._area.id));

  // Itens de todos os PAIs do recorte: valor/categoria alimentam a visão
  // "Por categoria de composição" (Etapa 22); numero_bem dos encerrados
  // alimenta a Auditoria.
  const { data: itens } = paisFiltrados.length
    ? await sb.from('itens_pai').select('pai_id,numero_bem,valor,categoria_id').in('pai_id', paisFiltrados.map(p => p.id))
    : { data: [] };
  const encerradosIds = new Set(paisFiltrados.filter(p => p.status === 'encerrado').map(p => p.id));
  const bensPorPai = {};
  (itens || []).forEach(i => {
    if (!i.numero_bem || !encerradosIds.has(i.pai_id)) return;
    (bensPorPai[i.pai_id] = bensPorPai[i.pai_id] || []).push(i.numero_bem);
  });

  return { saldos: saldos || [], realizados: realizados || [], pais: paisFiltrados, devolucaoLinhas: devolucaoFiltrada, bensPorPai, itens: itens || [] };
}

// ═══════════════════════════════════════════════════
// AGRUPAMENTOS (Consolidado)
// ═══════════════════════════════════════════════════
function novoAcumulador(nome) { return { nome, aprovado: 0, reservado: 0, livre: 0, realizado: 0, ajuste: 0 }; }

function agruparPorArea(dados) {
  const mapa = {};
  dados.saldos.forEach(s => {
    mapa[s.area_id] = mapa[s.area_id] || novoAcumulador(s.area_nome || '—');
    mapa[s.area_id].aprovado += numOrZero(s.aprovado);
    mapa[s.area_id].reservado += numOrZero(s.reservado);
    mapa[s.area_id].livre += numOrZero(s.livre);
  });
  dados.realizados.forEach(r => {
    if (!r.area_id) return;
    mapa[r.area_id] = mapa[r.area_id] || novoAcumulador('—');
    mapa[r.area_id].realizado += numOrZero(r.realizado);
  });
  dados.devolucaoLinhas.forEach(l => {
    if (!l._area) return;
    mapa[l._area.id] = mapa[l._area.id] || novoAcumulador(l._area.nome);
    mapa[l._area.id].ajuste += numOrZero(l.valor);
  });
  return mapa;
}

function agruparPorUnidade(dados) {
  const mapa = {};
  dados.saldos.forEach(s => {
    mapa[s.empresa_id] = mapa[s.empresa_id] || novoAcumulador(nomeEmpresaPorId(s.empresa_id));
    mapa[s.empresa_id].aprovado += numOrZero(s.aprovado);
    mapa[s.empresa_id].reservado += numOrZero(s.reservado);
    mapa[s.empresa_id].livre += numOrZero(s.livre);
  });
  dados.realizados.forEach(r => {
    mapa[r.empresa_id] = mapa[r.empresa_id] || novoAcumulador(nomeEmpresaPorId(r.empresa_id));
    mapa[r.empresa_id].realizado += numOrZero(r.realizado);
  });
  dados.devolucaoLinhas.forEach(l => {
    if (!l._empresaId) return;
    mapa[l._empresaId] = mapa[l._empresaId] || novoAcumulador(nomeEmpresaPorId(l._empresaId));
    mapa[l._empresaId].ajuste += numOrZero(l.valor);
  });
  return mapa;
}

// Soma do valor dos itens por categoria da composição, na ordem cadastrada.
// Itens anteriores à Etapa 22 (sem categoria_id) caem num grupo próprio, no fim.
const SEM_CATEGORIA = '__sem_categoria__';
function agruparPorCategoria(dados) {
  const mapa = {};
  dados.itens.forEach(i => {
    const chave = i.categoria_id || SEM_CATEGORIA;
    mapa[chave] = mapa[chave] || { valor: 0, pais: new Set() };
    mapa[chave].valor += numOrZero(i.valor);
    mapa[chave].pais.add(i.pai_id);
  });
  const total = Object.values(mapa).reduce((a, g) => a + g.valor, 0);
  const linha = (nome, g) => ({ nome, qtdPais: g.pais.size, valor: g.valor, pct: total ? (g.valor / total) * 100 : 0 });

  const linhas = estado.categoriasComposicao.filter(c => mapa[c.id]).map(c => linha(c.nome, mapa[c.id]));
  if (mapa[SEM_CATEGORIA]) linhas.push(linha('Sem categoria (itens anteriores à lista fixa)', mapa[SEM_CATEGORIA]));
  return { linhas, total };
}

function fmtPct(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }

function nomeEmpresaPorId(id) { return estado.empresasEscopo.find(e => e.id === id)?.nome || '—'; }
function nomeAreaPorId(id) { return estado.areasEscopo.find(a => a.id === id)?.nome || '—'; }

// ═══════════════════════════════════════════════════
// CASCA DA TELA — filtros + abas
// ═══════════════════════════════════════════════════
function renderCasca() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
      <h2 style="font-size:22px;margin:0">Relatórios · Investimentos</h2>
      <div class="field" style="margin:0;min-width:140px">
        <label>Ano-calendário</label>
        <select onchange="onAnoRelatorioChange(this.value)">
          ${estado.anosDisponiveis.map(a => `<option value="${a}" ${a === estado.ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Filtros</div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="display:block;margin-bottom:6px">Empresa / Unidade</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${estado.empresasEscopo.map(e => `<button type="button" class="chip-toggle ${estado.filtros.empresaIds.includes(e.id) ? 'active' : ''}" onclick="onFiltroRelatorioToggle('empresaIds','${e.id}')">${e.nome}</button>`).join('') || '<span class="text-xs text-muted">Nenhuma unidade no seu escopo.</span>'}
          </div>
        </div>
        <div>
          <label style="display:block;margin-bottom:6px">Área</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${estado.areasEscopo.map(a => `<button type="button" class="chip-toggle ${estado.filtros.areaIds.includes(a.id) ? 'active' : ''}" onclick="onFiltroRelatorioToggle('areaIds','${a.id}')">${a.nome}</button>`).join('') || '<span class="text-xs text-muted">Nenhuma área no seu escopo.</span>'}
          </div>
        </div>
        <div>
          <label style="display:block;margin-bottom:6px">Status do PAI</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${Object.entries(STATUS_PAI_LABELS).map(([k, label]) => `<button type="button" class="chip-toggle ${estado.filtros.statusList.includes(k) ? 'active' : ''}" onclick="onFiltroRelatorioToggle('statusList','${k}')">${label}</button>`).join('')}
          </div>
        </div>
        <div>
          <label style="display:block;margin-bottom:6px">Tipo de investimento</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${estado.tiposInvestimento.map(t => `<button type="button" class="chip-toggle ${estado.filtros.tipos.includes(t.nome) ? 'active' : ''}" onclick="onFiltroRelatorioToggle('tipos', ${JSON.stringify(t.nome)})">${t.nome}</button>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="auth-tabs" style="max-width:520px;margin:20px 0">
      <button class="auth-tab ${estado.aba === 'consolidado' ? 'active' : ''}" onclick="onAbaRelatorioChange('consolidado')">Consolidado</button>
      <button class="auth-tab ${estado.aba === 'pais' ? 'active' : ''}" onclick="onAbaRelatorioChange('pais')">PAIs</button>
      <button class="auth-tab ${estado.aba === 'auditoria' ? 'active' : ''}" onclick="onAbaRelatorioChange('auditoria')">Auditoria de encerramentos</button>
    </div>

    <div id="relatorios-conteudo"></div>`;
}

async function carregarConteudo() {
  document.getElementById('page-content').innerHTML = renderCasca();
  document.getElementById('relatorios-conteudo').innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  estado.dados = await carregarDados();
  renderConteudoAtual();
}

function renderConteudoAtual() {
  const conteudo = document.getElementById('relatorios-conteudo');
  if (!conteudo) return;
  conteudo.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" onclick="exportarRelatorioXlsx()">⬇ Exportar XLSX</button>
      <button class="btn btn-secondary btn-sm" onclick="exportarRelatorioPdf()">🖨 Exportar PDF</button>
    </div>
    ${estado.aba === 'consolidado' ? renderAbaConsolidado(estado.dados)
      : estado.aba === 'pais' ? renderAbaPais(estado.dados)
      : renderAbaAuditoria(estado.dados)}`;
}

export function onAnoRelatorioChange(valor) { estado.ano = Number(valor); carregarConteudo(); }
export function onFiltroRelatorioToggle(campo, valor) {
  const arr = estado.filtros[campo];
  const i = arr.indexOf(valor);
  if (i === -1) arr.push(valor); else arr.splice(i, 1);
  carregarConteudo();
}
export function onAbaRelatorioChange(aba) {
  estado.aba = aba;
  document.getElementById('page-content').innerHTML = renderCasca();
  renderConteudoAtual();
}

// ═══════════════════════════════════════════════════
// VISÕES
// ═══════════════════════════════════════════════════
function telaVaziaTabela(msg = 'Sem dados para este recorte.') {
  return `<div class="empty-state" style="padding:24px"><div class="empty-desc">${msg}</div></div>`;
}

function renderTabelaConsolidado(linhas, coluna) {
  if (!linhas.length) return telaVaziaTabela();
  return `
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>${coluna}</th><th class="text-right">Aprovado</th><th class="text-right">Comprometido</th><th class="text-right">Realizado</th><th class="text-right">Livre</th><th class="text-right">Ajuste de saldo (débito)</th></tr></thead>
      <tbody>
        ${linhas.map(l => `
          <tr>
            <td>${l.nome}</td>
            <td class="text-right">${fmtMoeda(l.aprovado)}</td>
            <td class="text-right">${fmtMoeda(l.reservado)}</td>
            <td class="text-right">${fmtMoeda(l.realizado)}</td>
            <td class="text-right" style="color:${l.livre < 0 ? 'var(--red)' : 'inherit'}">${fmtMoeda(l.livre)}</td>
            <td class="text-right" style="color:${l.ajuste < 0 ? 'var(--red)' : 'inherit'}">${fmtMoeda(l.ajuste)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderAbaConsolidado(dados) {
  const porArea = Object.values(agruparPorArea(dados));
  const porUnidade = Object.values(agruparPorUnidade(dados));
  return `
    <div class="table-card" style="margin-bottom:20px">
      <div class="table-header"><div class="table-title">Consolidado por área</div></div>
      ${renderTabelaConsolidado(porArea, 'Área')}
    </div>
    <div class="table-card" style="margin-bottom:20px">
      <div class="table-header"><div class="table-title">Consolidado por unidade</div></div>
      ${renderTabelaConsolidado(porUnidade, 'Unidade')}
    </div>
    <div class="table-card">
      <div class="table-header"><div class="table-title">Por categoria de composição</div></div>
      <div class="text-xs text-muted" style="padding:0 16px 8px">Soma da composição dos PAIs do recorte (ano + filtros acima), por categoria.</div>
      ${renderTabelaCategorias(agruparPorCategoria(dados))}
    </div>`;
}

function renderTabelaCategorias({ linhas, total }) {
  if (!linhas.length) return telaVaziaTabela();
  return `
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Categoria</th><th class="text-right">Nº de PAIs</th><th class="text-right">Valor</th><th class="text-right">% do total</th></tr></thead>
      <tbody>
        ${linhas.map(l => `
          <tr>
            <td>${l.nome}</td>
            <td class="text-right">${l.qtdPais}</td>
            <td class="text-right">${fmtMoeda(l.valor)}</td>
            <td class="text-right">${fmtPct(l.pct)}</td>
          </tr>`).join('')}
        <tr style="font-weight:600">
          <td>Total</td><td></td><td class="text-right">${fmtMoeda(total)}</td><td class="text-right">${fmtPct(100)}</td>
        </tr>
      </tbody>
    </table>
    </div>`;
}

function renderAbaPais(dados) {
  if (!dados.pais.length) return `<div class="table-card">${telaVaziaTabela()}</div>`;
  return `
    <div class="table-card">
      <div class="table-header"><div class="table-title">PAIs · ${dados.pais.length}</div></div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Empresa</th><th>Área</th><th>Título</th><th>Tipo</th><th class="text-right">Valor total</th><th>Status</th><th>Previsão de conclusão</th><th>Código MRP</th></tr></thead>
        <tbody>
          ${dados.pais.map(p => `
            <tr>
              <td><span class="font-mono text-xs" style="color:var(--accent)">${p.numero || '—'}</span></td>
              <td>${p.empresas?.nome || '—'}</td>
              <td>${p._area?.nome || '—'}</td>
              <td><strong>${p.titulo || '—'}</strong></td>
              <td>${TIPO_INVESTIMENTO_LABELS[p.tipo] || p.tipo}</td>
              <td class="text-right">${fmtMoeda(p.valor_total)}</td>
              <td>${badgeStatusPai(p.status)}</td>
              <td>${fmtDate(p.previsao_conclusao) || '—'}</td>
              <td>${p.mrp_codigo || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

function renderAbaAuditoria(dados) {
  const encerrados = dados.pais.filter(p => p.status === 'encerrado');
  if (!encerrados.length) return `<div class="table-card">${telaVaziaTabela('Nenhum PAI encerrado neste recorte.')}</div>`;
  return `
    <div class="table-card">
      <div class="table-header"><div class="table-title">Auditoria de encerramentos · ${encerrados.length}</div></div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Empresa</th><th>Área</th><th class="text-right">Valor aprovado</th><th class="text-right">Realizado</th><th class="text-right">Saldo apurado</th><th>Destino</th><th>Número(s) do bem</th><th>Encerrado em</th></tr></thead>
        <tbody>
          ${encerrados.map(p => {
            const realizado = p.valor_total - numOrZero(p.saldo_final);
            const sobra = numOrZero(p.saldo_final) >= 0;
            return `
            <tr>
              <td><span class="font-mono text-xs" style="color:var(--accent)">${p.numero || '—'}</span></td>
              <td>${p.empresas?.nome || '—'}</td>
              <td>${p._area?.nome || '—'}</td>
              <td class="text-right">${fmtMoeda(p.valor_total)}</td>
              <td class="text-right">${fmtMoeda(realizado)}</td>
              <td class="text-right" style="color:${sobra ? 'var(--green)' : 'var(--red)'}">${fmtMoeda(Math.abs(p.saldo_final))} ${sobra ? '(sobra)' : '(excedente)'}</td>
              <td class="text-xs">${sobra ? 'Sobra → caixa da empresa' : 'Excedente → débito no bolo'}</td>
              <td class="text-xs">${(dados.bensPorPai[p.id] || []).join(', ') || '—'}</td>
              <td>${fmtDate(p.encerrado_em) || '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════
// EXPORTAÇÃO — sempre as 5 tabelas do recorte atual (ano + filtros),
// independente da aba aberta no momento do clique.
// ═══════════════════════════════════════════════════
function resumoFiltrosTexto() {
  const partes = [`Ano: ${estado.ano}`];
  partes.push(`Empresas: ${estado.filtros.empresaIds.length ? estado.filtros.empresaIds.map(nomeEmpresaPorId).join(', ') : 'Todas'}`);
  partes.push(`Áreas: ${estado.filtros.areaIds.length ? estado.filtros.areaIds.map(nomeAreaPorId).join(', ') : 'Todas'}`);
  partes.push(`Status: ${estado.filtros.statusList.length ? estado.filtros.statusList.map(s => STATUS_PAI_LABELS[s] || s).join(', ') : 'Todos'}`);
  partes.push(`Tipo: ${estado.filtros.tipos.length ? estado.filtros.tipos.join(', ') : 'Todos'}`);
  return partes.join(' · ');
}

function montarLinhasExportacao(dados) {
  const porArea = Object.values(agruparPorArea(dados)).map(l => ({
    Área: l.nome, Aprovado: l.aprovado, Comprometido: l.reservado, Realizado: l.realizado, Livre: l.livre, 'Ajuste de saldo (débito)': l.ajuste
  }));
  const porUnidade = Object.values(agruparPorUnidade(dados)).map(l => ({
    Unidade: l.nome, Aprovado: l.aprovado, Comprometido: l.reservado, Realizado: l.realizado, Livre: l.livre, 'Ajuste de saldo (débito)': l.ajuste
  }));
  const paisLinhas = dados.pais.map(p => ({
    Número: p.numero || '—', Empresa: p.empresas?.nome || '—', Área: p._area?.nome || '—', Título: p.titulo || '—',
    Tipo: TIPO_INVESTIMENTO_LABELS[p.tipo] || p.tipo, 'Valor total': p.valor_total, Status: STATUS_PAI_LABELS[p.status] || p.status,
    'Previsão de conclusão': p.previsao_conclusao ? fmtDate(p.previsao_conclusao) : '—', 'Código MRP': p.mrp_codigo || '—'
  }));
  const encerrados = dados.pais.filter(p => p.status === 'encerrado');
  const auditoriaLinhas = encerrados.map(p => {
    const realizado = p.valor_total - numOrZero(p.saldo_final);
    const sobra = numOrZero(p.saldo_final) >= 0;
    return {
      Número: p.numero || '—', Empresa: p.empresas?.nome || '—', Área: p._area?.nome || '—',
      'Valor aprovado': p.valor_total, Realizado: realizado, 'Saldo apurado': p.saldo_final,
      Destino: sobra ? 'Sobra → caixa da empresa' : 'Excedente → débito no bolo',
      'Número(s) do bem': (dados.bensPorPai[p.id] || []).join(', ') || '—',
      'Encerrado em': p.encerrado_em ? fmtDate(p.encerrado_em) : '—'
    };
  });
  const { linhas: linhasCategoria, total: totalCategorias } = agruparPorCategoria(dados);
  const porCategoria = linhasCategoria.length
    ? [...linhasCategoria, { nome: 'Total', qtdPais: null, valor: totalCategorias, pct: 100 }].map(l => ({
      Categoria: l.nome, 'Nº de PAIs': l.qtdPais, Valor: l.valor, '% do total': Math.round(l.pct * 10) / 10
    }))
    : [];
  return { porArea, porUnidade, porCategoria, paisLinhas, auditoriaLinhas };
}

export function exportarRelatorioXlsx() {
  if (!estado?.dados) return;
  if (typeof XLSX === 'undefined') { toast('Biblioteca de exportação (XLSX) não carregou — verifique sua conexão.', 'error'); return; }
  const { porArea, porUnidade, porCategoria, paisLinhas, auditoriaLinhas } = montarLinhasExportacao(estado.dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porArea.length ? porArea : [{ Área: 'Sem dados para este recorte' }]), 'Consolidado - Área');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porUnidade.length ? porUnidade : [{ Unidade: 'Sem dados para este recorte' }]), 'Consolidado - Unidade');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porCategoria.length ? porCategoria : [{ Categoria: 'Sem dados para este recorte' }]), 'Por categoria de composição');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paisLinhas.length ? paisLinhas : [{ Número: 'Sem dados para este recorte' }]), 'PAIs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(auditoriaLinhas.length ? auditoriaLinhas : [{ Número: 'Sem dados para este recorte' }]), 'Auditoria de encerramentos');
  XLSX.writeFile(wb, `relatorio-investimentos-${estado.ano}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Mesmo padrão de mundos/investimentos/pdf.js (window.open + CSS de
// impressão + window.print(), com fallback de iframe se o pop-up for
// bloqueado) — cada arquivo com PDF próprio mantém a mesma abordagem já
// usada em Chamados/pdf.js, sem depender de biblioteca nova.
const CSS_IMPRESSAO_RELATORIO = `
  body { font-family: Arial, sans-serif; color: #0f2233; padding: 32px; max-width: 1000px; margin: 0 auto; font-size: 12px; }
  h1 { font-size: 20px; color: #1a9e9e; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #4a6478; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #d0dde8; padding-bottom: 6px; margin: 24px 0 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; border-bottom: 2px solid #1a9e9e; padding-bottom: 16px; }
  .desc { background: #f8fafc; border: 1px solid #d0dde8; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #4a6478; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f0f4f7; padding: 6px 8px; text-align: left; font-size: 10px; color: #4a6478; text-transform: uppercase; white-space: nowrap; }
  td { padding: 6px 8px; border-bottom: 1px solid #e8f0f5; font-size: 11px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #d0dde8; font-size: 11px; color: #8aa0b0; }
  @media print { body { padding: 16px; } h2 { break-before: auto; } table { break-inside: avoid; } }
`;

function documentoHtmlRelatorio(corpoHtml) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório de Investimentos</title><style>${CSS_IMPRESSAO_RELATORIO}</style></head><body>${corpoHtml}</body></html>`;
}

function abrirJanelaImpressaoRelatorio(corpoHtml) {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(documentoHtmlRelatorio(corpoHtml));
    win.document.close();
    setTimeout(() => win.print(), 500);
    return;
  }
  toast('Pop-up bloqueado pelo navegador — imprimindo por aqui mesmo. Para abrir em nova aba da próxima vez, permita pop-ups para este site.', 'error');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(documentoHtmlRelatorio(corpoHtml));
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 500);
}

function tabelaHtmlExport(titulo, colunas, linhas) {
  if (!linhas.length) return `<h2>${titulo}</h2><p style="color:#8aa0b0;font-style:italic">Sem dados para este recorte.</p>`;
  return `
    <h2>${titulo}</h2>
    <table>
      <thead><tr>${colunas.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map(l => `<tr>${colunas.map(c => `<td>${typeof l[c] === 'number' ? fmtMoeda(l[c]) : (l[c] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

export function exportarRelatorioPdf() {
  if (!estado?.dados) return;
  const { porArea, porUnidade, porCategoria, paisLinhas, auditoriaLinhas } = montarLinhasExportacao(estado.dados);
  // tabelaHtmlExport formata todo número como moeda — Nº de PAIs e % vão
  // como texto já formatado.
  const porCategoriaPdf = porCategoria.map(l => ({
    ...l, 'Nº de PAIs': l['Nº de PAIs'] == null ? '' : String(l['Nº de PAIs']), '% do total': fmtPct(l['% do total'])
  }));
  const corpo = `
    <div class="header">
      <div><h1>Grupo Pirineus — Relatório de Investimentos</h1></div>
      <div style="text-align:right;font-size:11px;color:#8aa0b0"><div>Gerado em ${new Date().toLocaleString('pt-BR')}</div></div>
    </div>
    <div class="desc">${resumoFiltrosTexto()}</div>
    ${tabelaHtmlExport('Consolidado por área', ['Área', 'Aprovado', 'Comprometido', 'Realizado', 'Livre', 'Ajuste de saldo (débito)'], porArea)}
    ${tabelaHtmlExport('Consolidado por unidade', ['Unidade', 'Aprovado', 'Comprometido', 'Realizado', 'Livre', 'Ajuste de saldo (débito)'], porUnidade)}
    ${tabelaHtmlExport('Por categoria de composição', ['Categoria', 'Nº de PAIs', 'Valor', '% do total'], porCategoriaPdf)}
    ${tabelaHtmlExport('PAIs', ['Número', 'Empresa', 'Área', 'Título', 'Tipo', 'Valor total', 'Status', 'Previsão de conclusão', 'Código MRP'], paisLinhas)}
    ${tabelaHtmlExport('Auditoria de encerramentos', ['Número', 'Empresa', 'Área', 'Valor aprovado', 'Realizado', 'Saldo apurado', 'Destino', 'Número(s) do bem', 'Encerrado em'], auditoriaLinhas)}
    <div class="footer">Sistema de Gestão de Engenharia — Grupo Pirineus</div>`;
  abrirJanelaImpressaoRelatorio(corpo);
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  renderRelatorios, onAnoRelatorioChange, onFiltroRelatorioToggle, onAbaRelatorioChange,
  exportarRelatorioXlsx, exportarRelatorioPdf
});
