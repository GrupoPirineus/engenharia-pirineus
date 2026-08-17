import { sb } from '../../shared/supabase.js';
import { STATUS_LABELS } from '../../shared/ui.js';
import { currentUser, isGestor, isEngenheiro, isSolicitante } from './auth.js';

let charts = {};

// ═══════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════
export async function renderDashboard() {
  document.getElementById('topbar-title').textContent = 'Dashboard';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  let escopoLabel = '';
  if (isGestor()) escopoLabel = '';
  else if (isEngenheiro()) escopoLabel = 'Mostrando seus chamados criados e atribuídos a você';
  else if (isSolicitante()) escopoLabel = 'Mostrando seus chamados';

  const now = new Date();
  const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const mesFim = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString();

  // Filtro por perfil: gestor vê tudo, engenheiro vê os dele (criados + atribuídos), solicitante vê os criados
  let baseQuery = sb.from('chamados').select('status, prioridade, data_desejada, empresa_id, tipo_servico_id, criado_em');
  let mesQuery = sb.from('chamados').select('status, criado_em').gte('criado_em', mesInicio);
  if (isEngenheiro() && !isGestor()) {
    baseQuery = baseQuery.or(`solicitante_id.eq.${currentUser.id},engenheiro_id.eq.${currentUser.id}`);
    mesQuery = mesQuery.or(`solicitante_id.eq.${currentUser.id},engenheiro_id.eq.${currentUser.id}`);
  } else if (isSolicitante() && !isGestor()) {
    baseQuery = baseQuery.eq('solicitante_id', currentUser.id);
    mesQuery = mesQuery.eq('solicitante_id', currentUser.id);
  }

  const [{ data: todos }, { data: mesChamados }, { data: horas }] = await Promise.all([
    baseQuery,
    mesQuery,
    sb.from('diario_bordo').select('horas, data_trabalho, chamado_id').gte('data_trabalho', mesInicio.split('T')[0])
  ]);

  const abertos = (todos||[]).filter(c => !['concluido','rejeitado'].includes(c.status)).length;
  const aguardando = (todos||[]).filter(c => c.status === 'aprovacao').length;
  const emExecucao = (todos||[]).filter(c => c.status === 'execucao').length;
  const hoje = new Date().toISOString().split('T')[0];
  const atrasados = (todos||[]).filter(c => c.data_desejada && c.data_desejada < hoje && !['concluido','rejeitado'].includes(c.status)).length;
  const concluidosMes = (mesChamados||[]).filter(c => c.status === 'concluido').length;
  const totalHorasMes = (horas||[]).reduce((a,b) => a + (b.horas||0), 0);

  // por status
  const porStatus = {};
  (todos||[]).forEach(c => { porStatus[c.status] = (porStatus[c.status]||0)+1; });

  // por empresa (precisamos buscar empresas)
  const { data: empresas } = await sb.from('empresas').select('id,nome');
  const empMap = {};
  (empresas||[]).forEach(e => empMap[e.id] = e.nome);

  const porEmpresa = {};
  (todos||[]).forEach(c => {
    const n = empMap[c.empresa_id] || 'Outros';
    porEmpresa[n] = (porEmpresa[n]||0)+1;
  });

  // horas por mês (últimos 6 meses)
  const { data: todasHoras } = await sb.from('diario_bordo').select('horas, data_trabalho')
    .gte('data_trabalho', new Date(now.getFullYear(), now.getMonth()-5, 1).toISOString().split('T')[0]);

  const horasPorMes = {};
  const abertosConcluidosPorMes = {};
  const meses6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'});
    meses6.push({key, label});
    horasPorMes[key] = 0;
    abertosConcluidosPorMes[key] = {abertos:0, concluidos:0};
  }

  (todasHoras||[]).forEach(h => {
    const key = h.data_trabalho?.substring(0,7);
    if (horasPorMes[key] !== undefined) horasPorMes[key] += h.horas||0;
  });

  const { data: todosChamados } = await sb.from('chamados').select('status, criado_em')
    .gte('criado_em', new Date(now.getFullYear(), now.getMonth()-5, 1).toISOString());
  (todosChamados||[]).forEach(c => {
    const key = c.criado_em?.substring(0,7);
    if (abertosConcluidosPorMes[key] !== undefined) {
      abertosConcluidosPorMes[key].abertos++;
      if (c.status === 'concluido') abertosConcluidosPorMes[key].concluidos++;
    }
  });

  page.innerHTML = `
    ${escopoLabel ? `<div style="margin-bottom:16px;padding:10px 14px;background:var(--accent-dim);border-radius:var(--radius);font-size:13px;color:var(--accent);display:inline-block">${escopoLabel}</div>` : ''}
    <div class="stats-grid">
      <div class="stat-card amber"><div class="stat-label">Chamados Abertos</div><div class="stat-value">${abertos}</div></div>
      <div class="stat-card orange"><div class="stat-label">Aguardando Aprovação</div><div class="stat-value">${aguardando}</div></div>
      <div class="stat-card blue"><div class="stat-label">Em Execução</div><div class="stat-value">${emExecucao}</div></div>
      <div class="stat-card red"><div class="stat-label">Atrasados</div><div class="stat-value">${atrasados}</div></div>
      <div class="stat-card green"><div class="stat-label">Concluídos no Mês</div><div class="stat-value">${concluidosMes}</div></div>
      <div class="stat-card purple"><div class="stat-label">Horas no Mês</div><div class="stat-value">${totalHorasMes.toFixed(0)}h</div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-title">Chamados por Status</div><div class="chart-wrap"><canvas id="chartStatus"></canvas></div></div>
      <div class="chart-card"><div class="chart-title">Chamados por Empresa</div><div class="chart-wrap"><canvas id="chartEmpresa"></canvas></div></div>
      <div class="chart-card"><div class="chart-title">Horas Lançadas por Mês</div><div class="chart-wrap"><canvas id="chartHoras"></canvas></div></div>
      <div class="chart-card"><div class="chart-title">Abertos vs Concluídos por Mês</div><div class="chart-wrap"><canvas id="chartAbConc"></canvas></div></div>
    </div>
  `;

  const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8b92a8', font: { size: 11 } } } } };
  const gridOpts = { color: '#2a3045' };

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  // Paleta Pirineus
  const PIRI_TEAL   = '#1a9e9e';
  const PIRI_TEAL2  = '#148080';
  const PIRI_BLUE   = '#1a5c9e';
  const PIRI_NAVY   = '#0f2233';
  const PIRI_MID    = '#2cbfbf';
  const PIRI_LIGHT  = '#7dd8d8';
  const PIRI_GREEN  = '#0e9e6e';
  const PIRI_ORANGE = '#e07820';
  const PIRI_RED    = '#e03e3e';
  const PIRI_PURPLE = '#6a3eb8';
  const STATUS_COLORS = ['#1a5c9e','#e07820','#6a3eb8','#1a9e9e','#2cbfbf','#0e9e6e','#e03e3e'];
  const gridColor = '#d0dde8';
  const tickColor = '#4a6478';
  const scaleOpts = { x: { ticks: { color: tickColor, font:{size:11} }, grid: { color: gridColor } }, y: { ticks: { color: tickColor }, grid: { color: gridColor } } };

  charts.status = new Chart(document.getElementById('chartStatus'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(porStatus).map(k => STATUS_LABELS[k]||k),
      datasets: [{ data: Object.values(porStatus), backgroundColor: STATUS_COLORS, borderWidth: 0 }]
    },
    options: { ...chartOpts, cutout: '65%', plugins: { legend: { labels: { color: tickColor, font:{size:11} } } } }
  });

  charts.empresa = new Chart(document.getElementById('chartEmpresa'), {
    type: 'bar',
    data: {
      labels: Object.keys(porEmpresa),
      datasets: [{ data: Object.values(porEmpresa), backgroundColor: PIRI_TEAL, borderRadius: 4, hoverBackgroundColor: PIRI_TEAL2 }]
    },
    options: { ...chartOpts, plugins: { legend: { display: false } }, scales: scaleOpts }
  });

  charts.horas = new Chart(document.getElementById('chartHoras'), {
    type: 'line',
    data: {
      labels: meses6.map(m => m.label),
      datasets: [{ label: 'Horas', data: meses6.map(m => horasPorMes[m.key]), borderColor: PIRI_TEAL, backgroundColor: 'rgba(26,158,158,0.08)', fill: true, tension: 0.3, pointBackgroundColor: PIRI_TEAL, pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 5 }]
    },
    options: { ...chartOpts, plugins: { legend: { labels: { color: tickColor } } }, scales: scaleOpts }
  });

  charts.abConc = new Chart(document.getElementById('chartAbConc'), {
    type: 'bar',
    data: {
      labels: meses6.map(m => m.label),
      datasets: [
        { label: 'Abertos', data: meses6.map(m => abertosConcluidosPorMes[m.key]?.abertos||0), backgroundColor: PIRI_BLUE, borderRadius: 4 },
        { label: 'Concluídos', data: meses6.map(m => abertosConcluidosPorMes[m.key]?.concluidos||0), backgroundColor: PIRI_GREEN, borderRadius: 4 }
      ]
    },
    options: { ...chartOpts, plugins: { legend: { labels: { color: tickColor } } }, scales: scaleOpts }
  });
}
