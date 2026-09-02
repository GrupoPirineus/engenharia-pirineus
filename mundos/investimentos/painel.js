import { sb } from '../../shared/supabase.js';
import { fmtDate } from '../../shared/ui.js';
import { temPapel } from '../../shared/acesso.js';
import { fmtMoeda } from './dashboard.js';
import { resolverEscoposSolicitante } from './solicitacao.js';

// ═══════════════════════════════════════════════════
// DASHBOARD DO MUNDO INVESTIMENTOS (Etapa 10)
//
// Alçada ampla (controladoria_op, superintendente, diretor, diretor_ceo,
// controladoria_contabil — ou master, que "tem" todos via tem_papel) vê
// duas abas: Consolidado (soma todas as empresas com plano no ano) e Por
// Unidade (o mesmo conjunto de métricas, empresa a empresa). Quem só tem
// inv_solicitante vê um único bloco, restrito às próprias área(s).
//
// Fontes: saldo_areas (aprovado/comprometido/livre, Etapa 6) e a view
// nova realizado_por_area (Etapa 10 — valor_total - saldo_final dos PAIs
// encerrados, ver migracoes/etapa10_dashboard.sql). "Devolvido" (ao bolo)
// é a soma das linhas tipo=devolucao de linhas_plano no plano do ano/
// escopo (o saldo de sobra/excedente que a Etapa 8 lança de volta no
// encerramento) — não tem relação com pais.status='devolvido', que é
// devolução para ajuste, um conceito totalmente diferente.
// ═══════════════════════════════════════════════════

const PAPEIS_ALCADA_AMPLA = ['controladoria_op', 'inv_aprovador', 'diretor', 'diretor_ceo', 'controladoria_contabil'];

let estado = null;
let charts = {};

function numOrZero(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function hojeISO() { return new Date().toISOString().slice(0, 10); }
function addDias(iso, dias) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); }
function soma(lista, campo) { return lista.reduce((a, l) => a + numOrZero(l[campo]), 0); }

export async function renderPainel() {
  document.getElementById('topbar-title').textContent = 'Dashboard';
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
  }

  const { data: planos } = await sb.from('planos_investimento').select('ano_calendario, empresa_id, empresas(nome)').order('ano_calendario');
  const anosDisponiveis = [...new Set((planos || []).map(p => p.ano_calendario))].sort((a, b) => a - b);

  if (!anosDisponiveis.length) {
    page.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Nenhum plano lançado ainda</div><div class="empty-desc">O dashboard aparece assim que houver ao menos um plano de investimento publicado.</div></div>`;
    return;
  }

  const anoAtual = new Date().getFullYear();
  const anoDefault = anosDisponiveis.includes(anoAtual) ? anoAtual : anosDisponiveis[anosDisponiveis.length - 1];

  estado = { amplo, escoposRestritos, planos: planos || [], anosDisponiveis, ano: anoDefault, aba: 'consolidado' };
  montarTela();
}

function montarTela() {
  const page = document.getElementById('page-content');
  page.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
      <h2 style="font-size:22px;margin:0">Dashboard · Investimentos</h2>
      <div class="auth-tabs" style="max-width:${Math.max(160, estado.anosDisponiveis.length * 72)}px">
        ${estado.anosDisponiveis.map(a => `<button class="auth-tab ${a === estado.ano ? 'active' : ''}" onclick="onAnoPainelChange(${a})">${a}</button>`).join('')}
      </div>
    </div>
    ${estado.amplo ? `
    <div class="auth-tabs" style="max-width:340px;margin-bottom:20px">
      <button class="auth-tab ${estado.aba === 'consolidado' ? 'active' : ''}" onclick="onAbaPainelChange('consolidado')">Consolidado · Grupo</button>
      <button class="auth-tab ${estado.aba === 'unidade' ? 'active' : ''}" onclick="onAbaPainelChange('unidade')">Por Unidade</button>
    </div>` : ''}
    <div id="painel-conteudo"><div class="loading"><div class="spinner"></div> Carregando...</div></div>`;
  carregarConteudo();
}

export function onAnoPainelChange(ano) { estado.ano = Number(ano); montarTela(); }
export function onAbaPainelChange(aba) { estado.aba = aba; montarTela(); }

// ═══════════════════════════════════════════════════
// CARGA DE DADOS
// ═══════════════════════════════════════════════════
async function carregarDados(ano, empresaIds, areaIdsFiltro) {
  if (!empresaIds.length) return { saldos: [], realizados: [], pais: [], passosPendentes: [], aumentos: [], totalDevolvido: 0 };

  let saldosQuery = sb.from('saldo_areas').select('*').eq('ano_calendario', ano).in('empresa_id', empresaIds);
  let realizadosQuery = sb.from('realizado_por_area').select('*').eq('ano_calendario', ano).in('empresa_id', empresaIds);
  if (areaIdsFiltro?.length) {
    saldosQuery = saldosQuery.in('area_id', areaIdsFiltro);
    realizadosQuery = realizadosQuery.in('area_id', areaIdsFiltro);
  }

  const [{ data: saldos }, { data: realizados }, { data: paisRows }, { data: aumentos }, { data: devolucaoLinhas }, { data: mapaSetorArea }] = await Promise.all([
    saldosQuery, realizadosQuery,
    sb.from('pais').select('id,status,previsao_conclusao,empresa_id,setor_id,numero,titulo,valor_total').eq('ano_calendario', ano).in('empresa_id', empresaIds),
    sb.from('aumentos_verba').select('id,status,empresa_id,valor,numero').eq('ano_calendario', ano).in('empresa_id', empresaIds),
    sb.from('linhas_plano').select('valor,setor_id,planos_investimento!inner(empresa_id,ano_calendario)')
      .eq('tipo', 'devolucao').eq('cancelada', false)
      .eq('planos_investimento.ano_calendario', ano).in('planos_investimento.empresa_id', empresaIds),
    sb.from('empresa_setores').select('empresa_id,setor_id,area_id').in('empresa_id', empresaIds)
  ]);

  const areaDoSetor = {};
  (mapaSetorArea || []).forEach(m => { areaDoSetor[`${m.empresa_id}·${m.setor_id}`] = m.area_id; });

  let paisFiltrados = paisRows || [];
  if (areaIdsFiltro?.length) {
    paisFiltrados = paisFiltrados.filter(p => areaIdsFiltro.includes(areaDoSetor[`${p.empresa_id}·${p.setor_id}`]));
  }

  // "Devolvido ao bolo" (Etapa 8): soma das linhas tipo=devolucao lançadas
  // no encerramento — NÃO tem relação com pais.status='devolvido' (que é
  // devolução para ajuste, um conceito diferente).
  let devolucaoFiltrada = devolucaoLinhas || [];
  if (areaIdsFiltro?.length) {
    devolucaoFiltrada = devolucaoFiltrada.filter(l => {
      const empresaDaLinha = l.planos_investimento?.empresa_id;
      return areaIdsFiltro.includes(areaDoSetor[`${empresaDaLinha}·${l.setor_id}`]);
    });
  }
  const totalDevolvido = devolucaoFiltrada.reduce((a, l) => a + numOrZero(l.valor), 0);

  const idsEmCritica = paisFiltrados.filter(p => p.status === 'em_critica').map(p => p.id);
  const { data: passosPendentes } = idsEmCritica.length
    ? await sb.from('passos_aprovacao').select('pai_id,etapa').eq('decisao', 'pendente').in('pai_id', idsEmCritica)
    : { data: [] };

  return { saldos: saldos || [], realizados: realizados || [], pais: paisFiltrados, passosPendentes: passosPendentes || [], aumentos: aumentos || [], totalDevolvido };
}

async function carregarConteudo() {
  const conteudo = document.getElementById('painel-conteudo');
  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  if (!estado.amplo) {
    if (!estado.escoposRestritos.length) {
      conteudo.innerHTML = telaVazia('Sem área de investimento atribuída ainda.');
      return;
    }
    const empresaIds = [...new Set(estado.escoposRestritos.map(e => e.empresaId))];
    const areaIds = [...new Set(estado.escoposRestritos.map(e => e.areaId).filter(Boolean))];
    const dados = await carregarDados(estado.ano, empresaIds, areaIds.length ? areaIds : null);
    conteudo.innerHTML = renderBloco(dados, 'restrito');
    montarGrafico(dados, 'restrito');
    return;
  }

  if (estado.aba === 'consolidado') {
    const empresaIds = [...new Set(estado.planos.filter(p => p.ano_calendario === estado.ano).map(p => p.empresa_id))];
    const dados = await carregarDados(estado.ano, empresaIds, null);
    conteudo.innerHTML = renderBloco(dados, 'consolidado');
    montarGrafico(dados, 'consolidado');
    return;
  }

  // Por unidade — mesmo bloco de métricas, empilhado por empresa.
  const empresasDoAno = estado.planos.filter(p => p.ano_calendario === estado.ano);
  if (!empresasDoAno.length) { conteudo.innerHTML = telaVazia('Nenhum plano neste ano.'); return; }

  const blocos = [];
  for (const p of empresasDoAno) {
    const dados = await carregarDados(estado.ano, [p.empresa_id], null);
    blocos.push({ chave: `u${p.empresa_id.replace(/-/g, '')}`, nome: p.empresas?.nome || '—', dados });
  }
  conteudo.innerHTML = blocos.map(b => `
    <div class="form-section">
      <div class="form-section-title" style="font-size:16px">${b.nome}</div>
      ${renderBloco(b.dados, b.chave)}
    </div>`).join('');
  blocos.forEach(b => montarGrafico(b.dados, b.chave));
}

function telaVazia(msg) {
  return `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-desc">${msg}</div></div>`;
}

// ═══════════════════════════════════════════════════
// RENDER DO BLOCO DE MÉTRICAS (reutilizado por consolidado/unidade/restrito)
// ═══════════════════════════════════════════════════
function calcularFunil(paisRows, passosPendentes) {
  const etapaPorPai = {};
  passosPendentes.forEach(p => { etapaPorPai[p.pai_id] = p.etapa; });
  const f = { em_critica: 0, aguardando_alcada: 0, em_formalizacao: 0, em_execucao: 0, encerrado: 0, devolvido: 0, reprovado: 0 };
  paisRows.forEach(p => {
    if (p.status === 'em_critica') {
      const etapa = etapaPorPai[p.id];
      if (etapa === 'aprovador' || etapa === 'diretor') f.aguardando_alcada++;
      else f.em_critica++;
    } else if (p.status === 'aprovado') f.em_formalizacao++;
    else if (['formalizado', 'em_execucao', 'concluido_solicitante'].includes(p.status)) f.em_execucao++;
    else if (p.status === 'encerrado') f.encerrado++;
    else if (p.status === 'devolvido') f.devolvido++;
    else if (p.status === 'reprovado') f.reprovado++;
  });
  return f;
}

function renderFunil(funil) {
  const ordem = [
    ['em_critica', 'Em Crítica'], ['aguardando_alcada', 'Aguardando Alçada'], ['em_formalizacao', 'Em Formalização'],
    ['em_execucao', 'Em Execução'], ['encerrado', 'Encerrado'], ['devolvido', 'Devolvido'], ['reprovado', 'Reprovado']
  ];
  const max = Math.max(1, ...ordem.map(([k]) => funil[k] || 0));
  return ordem.map(([k, label]) => `
    <div style="display:flex;align-items:center;gap:10px;font-size:13px">
      <div style="width:130px;color:var(--text2);flex-shrink:0">${label}</div>
      <div style="flex:1;background:var(--surface2);border-radius:4px;height:14px;overflow:hidden"><div style="width:${((funil[k] || 0) / max * 100).toFixed(0)}%;background:var(--accent);height:100%"></div></div>
      <div style="width:24px;text-align:right;font-weight:600">${funil[k] || 0}</div>
    </div>`).join('');
}

function renderAlertas(dados) {
  const hoje = hojeISO();
  const limite = addDias(hoje, 7);
  const paisVencendo = dados.pais.filter(p => p.status !== 'encerrado' && p.previsao_conclusao && p.previsao_conclusao <= limite);
  const aumentosPendentes = dados.aumentos.filter(a => a.status === 'em_critica');
  const areasNegativas = dados.saldos.filter(s => numOrZero(s.livre) < 0);

  const itens = [];
  paisVencendo.forEach(p => {
    const venceu = p.previsao_conclusao < hoje;
    itens.push(`<div class="text-xs" style="color:${venceu ? 'var(--red)' : 'var(--orange)'}">⏰ ${p.numero || '—'} — ${venceu ? 'vencido em' : 'vence em'} ${fmtDate(p.previsao_conclusao)}</div>`);
  });
  if (aumentosPendentes.length) {
    itens.push(`<div class="text-xs" style="color:var(--orange)">💰 ${aumentosPendentes.length} aumento(s) de verba pendente(s) de aprovação</div>`);
  }
  areasNegativas.forEach(a => {
    itens.push(`<div class="text-xs" style="color:var(--red)">⚠️ ${a.area_nome || '—'} com saldo livre negativo (${fmtMoeda(a.livre)})</div>`);
  });

  if (!itens.length) return `<div class="text-xs text-muted">Nenhum alerta no momento.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px">${itens.join('')}</div>`;
}

function agruparPorArea(dados) {
  const mapa = {};
  dados.saldos.forEach(s => {
    mapa[s.area_id] = mapa[s.area_id] || { nome: s.area_nome || '—', aprovado: 0, reservado: 0, livre: 0, realizado: 0 };
    mapa[s.area_id].aprovado += numOrZero(s.aprovado);
    mapa[s.area_id].reservado += numOrZero(s.reservado);
    mapa[s.area_id].livre += numOrZero(s.livre);
  });
  dados.realizados.forEach(r => {
    if (!r.area_id) return;
    if (!mapa[r.area_id]) mapa[r.area_id] = { nome: '—', aprovado: 0, reservado: 0, livre: 0, realizado: 0 };
    mapa[r.area_id].realizado += numOrZero(r.realizado);
  });
  return mapa;
}

function renderTabelaBolo(dados) {
  const linhas = Object.values(agruparPorArea(dados));
  if (!linhas.length) return `<div class="empty-state" style="padding:24px"><div class="empty-desc">Sem dados para este recorte.</div></div>`;
  return `
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Área</th><th class="text-right">Aprovado</th><th class="text-right">Comprometido</th><th class="text-right">Realizado</th><th class="text-right">Livre</th></tr></thead>
      <tbody>
        ${linhas.map(l => `
          <tr>
            <td>${l.nome}</td>
            <td class="text-right">${fmtMoeda(l.aprovado)}</td>
            <td class="text-right">${fmtMoeda(l.reservado)}</td>
            <td class="text-right">${fmtMoeda(l.realizado)}</td>
            <td class="text-right" style="color:${l.livre < 0 ? 'var(--red)' : 'inherit'}">${fmtMoeda(l.livre)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function renderBloco(dados, chave) {
  const totalAprovado = soma(dados.saldos, 'aprovado');
  const totalReservado = soma(dados.saldos, 'reservado');
  const totalLivre = soma(dados.saldos, 'livre');
  const totalDevolvido = dados.totalDevolvido;
  const funil = calcularFunil(dados.pais, dados.passosPendentes);

  return `
    <div class="stats-grid">
      <div class="stat-card blue"><div class="stat-label">Aprovado</div><div class="stat-value">${fmtMoeda(totalAprovado)}</div></div>
      <div class="stat-card orange"><div class="stat-label">Comprometido</div><div class="stat-value">${fmtMoeda(totalReservado)}</div></div>
      <div class="stat-card green"><div class="stat-label">Livre</div><div class="stat-value">${fmtMoeda(totalLivre)}</div></div>
      <div class="stat-card purple"><div class="stat-label">Devolvido</div><div class="stat-value">${fmtMoeda(totalDevolvido)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:20px;margin:20px 0;align-items:start">
      <div class="chart-card">
        <div class="chart-title">Planejado × Comprometido × Realizado por área</div>
        <div class="chart-wrap"><canvas id="painel-chart-${chave}"></canvas></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="chart-card">
          <div class="chart-title">Funil de status dos PAIs</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${renderFunil(funil)}</div>
        </div>
        <div class="chart-card">
          <div class="chart-title">Alertas</div>
          <div style="margin-top:8px">${renderAlertas(dados)}</div>
        </div>
      </div>
    </div>
    <div class="table-card">
      <div class="table-header"><div class="table-title">Bolo por área</div></div>
      ${renderTabelaBolo(dados)}
    </div>`;
}

function montarGrafico(dados, chave) {
  const canvas = document.getElementById(`painel-chart-${chave}`);
  if (!canvas) return;
  const areas = Object.values(agruparPorArea(dados));
  const tickColor = '#4a6478';
  const gridColor = '#d0dde8';
  charts[chave] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: areas.map(a => a.nome),
      datasets: [
        { label: 'Planejado', data: areas.map(a => a.aprovado), backgroundColor: '#1a5c9e', borderRadius: 4 },
        { label: 'Comprometido', data: areas.map(a => a.reservado), backgroundColor: '#e07820', borderRadius: 4 },
        { label: 'Realizado', data: areas.map(a => a.realizado), backgroundColor: '#0e9e6e', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor }, grid: { color: gridColor } }
      }
    }
  });
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { renderPainel, onAnoPainelChange, onAbaPainelChange });
