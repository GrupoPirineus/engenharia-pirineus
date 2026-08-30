import { sb } from '../../shared/supabase.js';
import { toast, fmtDateTime } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { fmtMoeda, badgeStatusPai } from './dashboard.js';

// ═══════════════════════════════════════════════════
// CARGA DO PLANO DE INVESTIMENTO (Etapa 6 — papel controladoria_op)
//
// planos_investimento: um por (empresa, ano). Nasce em rascunho (linhas
// totalmente editáveis, remoção é DELETE de verdade) e vira aprovado ao
// publicar — só então a Solicitação do PAI enxerga as linhas (ver
// solicitacao.js/carregarLinhas).
//
// Ao publicar, o teto por área é congelado em teto_area_plano (soma das
// linhas ativas de cada área naquele instante). Depois de aprovado:
//   - toda linha que já existia na publicação fica travada (valor,
//     descrição e setor) — não tem "editar", só CANCELAR (se sem reserva).
//   - uma linha adicionada DEPOIS da publicação (criado_em > aprovado_em)
//     continua editável normalmente até ganhar reserva, como no rascunho.
//   - qualquer valor lançado numa linha editável não pode fazer a área
//     estourar o teto congelado — isso fica bloqueado, remetido ao
//     aumento de verba (etapa futura).
// Cancelar uma linha ativa libera espaço dentro do MESMO teto (não
// aumenta o teto) para uma linha nova.
// ═══════════════════════════════════════════════════

const STATUS_LABELS = { rascunho: 'Rascunho', aprovado: 'Aprovado', encerrado: 'Encerrado' };
const STATUS_BADGE = { rascunho: 'badge-rascunho', aprovado: 'badge-success', encerrado: 'badge-concluido' };

let estado = null;

function anoVigente() { return new Date().getFullYear(); }
function numOrZero(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

export async function renderPlanoInvestimento() {
  document.getElementById('topbar-title').textContent = 'Plano de Investimento';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const { data: empresas, error } = await sb.from('empresas').select('id,nome').eq('ativo', true).order('nome');
  if (error) { toast('Erro ao carregar empresas: ' + error.message, 'error'); return; }
  if (!empresas?.length) { page.innerHTML = '<div class="empty-state"><div class="empty-title">Nenhuma unidade cadastrada</div></div>'; return; }

  estado = {
    empresas, empresaId: empresas[0].id, ano: anoVigente(),
    planoId: null, status: null, aprovadoEm: null, criadoPor: null,
    linhas: [], reservadoPorLinha: {}, tetoPorArea: {}, setoresDaEmpresa: []
  };

  await carregarPlano();
  render();
}

async function carregarSetoresDaEmpresa() {
  const { data, error } = await sb.from('empresa_setores')
    .select('setor_id, area_id, setores(nome), areas(nome)')
    .eq('empresa_id', estado.empresaId);
  if (error) { toast('Erro ao carregar setores da unidade: ' + error.message, 'error'); estado.setoresDaEmpresa = []; return; }
  estado.setoresDaEmpresa = (data || [])
    .map(r => ({ setorId: r.setor_id, setorNome: r.setores?.nome || '—', areaId: r.area_id, areaNome: r.areas?.nome || null }))
    .sort((a, b) => a.setorNome.localeCompare(b.setorNome));
}

// Abre o plano de (empresa, ano) se existir; senão cria em rascunho —
// "carga do plano" começa direto pronta para receber linhas.
async function carregarPlano() {
  await carregarSetoresDaEmpresa();

  let { data: plano, error } = await sb.from('planos_investimento').select('*')
    .eq('empresa_id', estado.empresaId).eq('ano_calendario', estado.ano).maybeSingle();
  if (error) { toast('Erro ao carregar plano: ' + error.message, 'error'); return; }

  if (!plano) {
    const resp = await sb.from('planos_investimento')
      .insert({ empresa_id: estado.empresaId, ano_calendario: estado.ano, status: 'rascunho', criado_por: currentUser.id })
      .select('*').single();
    if (resp.error) { toast('Erro ao criar plano: ' + resp.error.message, 'error'); return; }
    plano = resp.data;
  }

  estado.planoId = plano.id;
  estado.status = plano.status;
  estado.aprovadoEm = plano.aprovado_em;
  estado.criadoPor = plano.criado_por;

  if (estado.status === 'aprovado') {
    const { data: tetos, error: erroTetos } = await sb.from('teto_area_plano').select('area_id,valor_teto').eq('plano_id', estado.planoId);
    if (erroTetos) console.error('Erro ao carregar teto por área:', erroTetos);
    estado.tetoPorArea = {};
    (tetos || []).forEach(t => { estado.tetoPorArea[t.area_id] = numOrZero(t.valor_teto); });
  } else {
    estado.tetoPorArea = {};
  }

  await carregarLinhas();
}

async function carregarLinhas() {
  const [{ data: linhas, error: erroLinhas }, { data: reservas, error: erroReservas }] = await Promise.all([
    sb.from('linhas_plano').select('*').eq('plano_id', estado.planoId).order('criado_em'),
    sb.from('saldo_linhas').select('linha_id,reservado').eq('plano_id', estado.planoId)
  ]);
  if (erroLinhas) { toast('Erro ao carregar linhas: ' + erroLinhas.message, 'error'); estado.linhas = []; return; }
  if (erroReservas) console.error('Erro ao carregar reservas das linhas:', erroReservas);

  estado.reservadoPorLinha = {};
  (reservas || []).forEach(r => { estado.reservadoPorLinha[r.linha_id] = numOrZero(r.reservado); });

  const mapaSetores = {};
  estado.setoresDaEmpresa.forEach(s => { mapaSetores[s.setorId] = s; });

  estado.linhas = (linhas || []).map(l => ({
    id: l.id, setorId: l.setor_id, descricao: l.descricao, valor: numOrZero(l.valor), tipo: l.tipo,
    criadoEm: l.criado_em, cancelada: l.cancelada, canceladaMotivo: l.cancelada_motivo, canceladaEm: l.cancelada_em,
    setorNome: mapaSetores[l.setor_id]?.setorNome || '(setor removido da unidade)',
    areaId: mapaSetores[l.setor_id]?.areaId || null,
    areaNome: mapaSetores[l.setor_id]?.areaNome || null,
    reservado: estado.reservadoPorLinha[l.id] || 0
  }));
}

// Uma linha só é editável quando: o plano ainda é rascunho, OU (o plano já
// foi aprovado, mas essa linha nasceu DEPOIS da publicação e ainda não tem
// reserva). Linhas que já existiam na publicação ficam travadas para
// sempre — só sobra cancelar.
function linhaEditavel(linha) {
  if (linha.cancelada) return false;
  if (estado.status !== 'aprovado') return true;
  const posPublicacao = estado.aprovadoEm && linha.criadoEm > estado.aprovadoEm;
  return posPublicacao && linha.reservado === 0;
}

function linhaCancelavel(linha) {
  return estado.status === 'aprovado' && !linha.cancelada && linha.reservado === 0;
}

function somaAreaAtiva(areaId, excluirLinhaId) {
  return estado.linhas
    .filter(l => l.areaId === areaId && !l.cancelada && l.id !== excluirLinhaId)
    .reduce((a, l) => a + l.valor, 0);
}

// ═══════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════
function render() {
  const anoAtual = anoVigente();
  const publicado = estado.status === 'aprovado';
  const encerrado = estado.status === 'encerrado';
  const ativas = estado.linhas.filter(l => !l.cancelada);
  const totalGeral = ativas.reduce((a, l) => a + l.valor, 0);
  const resumoArea = calcularResumoPorArea();

  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">
      <div>
        <h2 style="font-size:24px;margin:0 0 4px">Plano de Investimento</h2>
        <div class="text-sm text-muted">o bolo do ano — linhas por setor, agrupadas por área de superintendência</div>
      </div>
      <div class="text-sm text-muted">${currentUser.nome} · Controladoria Operacional</div>
    </div>

    <div class="form-section">
      <div class="form-row">
        <div class="field"><label>Empresa</label>
          <select id="plano-empresa" onchange="onEmpresaPlanoChange(this.value)">
            ${estado.empresas.map(e => `<option value="${e.id}" ${e.id === estado.empresaId ? 'selected' : ''}>${e.nome}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Ano-calendário</label>
          <select id="plano-ano" onchange="onAnoPlanoChange(this.value)">
            <option value="${anoAtual}" ${estado.ano === anoAtual ? 'selected' : ''}>${anoAtual} · vigente</option>
            <option value="${anoAtual + 1}" ${estado.ano === anoAtual + 1 ? 'selected' : ''}>${anoAtual + 1} · disponível (entressafra)</option>
          </select>
        </div>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <span class="badge ${STATUS_BADGE[estado.status] || ''}">${STATUS_LABELS[estado.status] || estado.status}</span>
      ${publicado ? `<span class="text-xs text-muted">publicado em ${fmtDateTime(estado.aprovadoEm)}</span>` : ''}
      ${!publicado && !encerrado ? `<button class="btn btn-primary btn-sm" onclick="onPublicarPlano()">Publicar plano</button>` : ''}
      ${!publicado && !encerrado ? `<span class="text-xs text-muted">enquanto rascunho, o plano não fica disponível para solicitação de PAI</span>` : ''}
      ${publicado ? `<span class="text-xs text-muted">linhas da publicação ficam travadas — só dá para cancelar (se sem reserva) ou acrescentar linha nova, dentro do teto de cada área</span>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 320px;gap:32px;align-items:start">
      <div class="form-section">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
          <div class="form-section-title" style="margin-bottom:0">Linhas do plano</div>
          <div class="text-sm text-muted">total geral: <strong style="color:var(--text)">${fmtMoeda(totalGeral)}</strong></div>
        </div>
        ${estado.setoresDaEmpresa.length === 0 ? `
        <div class="empty-state" style="padding:20px"><div class="empty-desc">Esta unidade ainda não tem setores vinculados. Cadastre em Administração → Unidades e Setores.</div></div>
        ` : `
        <div style="overflow-x:auto">
        <table>
          <thead><tr><th style="width:220px">Setor</th><th>Descrição</th><th class="text-right" style="width:150px">Valor</th><th class="text-right" style="width:120px">Reservado</th><th style="width:110px"></th></tr></thead>
          <tbody id="linhas-plano-tbody">${renderLinhasTabela()}</tbody>
        </table>
        </div>`}
        <div style="margin-top:12px">
          <button class="btn btn-secondary btn-sm" id="btn-add-linha" ${estado.setoresDaEmpresa.length === 0 ? 'disabled' : ''} onclick="onAddLinha()">+ Adicionar linha</button>
        </div>
      </div>

      <div class="chart-card">
        <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Bolo por área</div>
        <div id="resumo-area" style="display:flex;flex-direction:column;gap:10px">${renderResumoArea(resumoArea)}</div>
        <div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--border);padding-top:8px;margin-top:8px">
          <span>Total geral</span><span>${fmtMoeda(totalGeral)}</span>
        </div>
      </div>
    </div>`;
}

function calcularResumoPorArea() {
  const porArea = {}; // chave: areaId || 'sem-area'
  estado.linhas.filter(l => !l.cancelada).forEach(l => {
    const chave = l.areaId || 'sem-area';
    if (!porArea[chave]) porArea[chave] = { areaId: l.areaId, nome: l.areaNome || 'Sem área vinculada', total: 0 };
    porArea[chave].total += l.valor;
  });
  return Object.values(porArea).sort((a, b) => b.total - a.total);
}

function renderResumoArea(resumo) {
  if (resumo.length === 0) return '<div class="text-xs text-muted">Nenhuma linha ainda.</div>';
  const publicado = estado.status === 'aprovado';

  if (!publicado) {
    return resumo.map(r => `
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span class="${r.nome === 'Sem área vinculada' ? 'text-muted' : ''}">${r.nome}</span>
        <span>${fmtMoeda(r.total)}</span>
      </div>`).join('');
  }

  // Publicado: teto (congelado na publicação) · ativo (soma das linhas não
  // canceladas hoje) · livre (teto − ativo) — o que sobra pra uma linha nova.
  return resumo.map(r => {
    const teto = r.areaId ? (estado.tetoPorArea[r.areaId] ?? 0) : 0;
    const livre = teto - r.total;
    const estourado = livre < -1e-9;
    return `
      <div style="padding-bottom:10px;margin-bottom:2px;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">${r.nome}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2)"><span>Teto</span><span>${fmtMoeda(teto)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2)"><span>Ativo</span><span>${fmtMoeda(r.total)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600"><span>Livre</span><span style="color:${estourado ? 'var(--red)' : 'var(--green)'}">${fmtMoeda(livre)}</span></div>
      </div>`;
  }).join('');
}

function renderLinhasTabela() {
  return estado.linhas.map(l => {
    const editavel = linhaEditavel(l);
    const cancelavel = linhaCancelavel(l);
    if (l.cancelada) {
      return `
      <tr style="opacity:0.55">
        <td>${l.setorNome}</td>
        <td>
          <span style="text-decoration:line-through">${l.descricao || '—'}</span>
          <div class="text-xs text-muted">Cancelada em ${fmtDateTime(l.canceladaEm)} — ${l.canceladaMotivo || 'sem motivo registrado'}</div>
        </td>
        <td class="text-right" style="text-decoration:line-through">${fmtMoeda(l.valor)}</td>
        <td class="text-right text-muted">—</td>
        <td class="text-right"><span class="badge badge-danger">Cancelada</span></td>
      </tr>`;
    }
    return `
    <tr>
      <td>
        <select ${editavel ? '' : 'disabled'} onchange="onSetorLinhaChange('${l.id}', this.value)">
          ${estado.setoresDaEmpresa.map(s => `<option value="${s.setorId}" ${s.setorId === l.setorId ? 'selected' : ''}>${s.setorNome}</option>`).join('')}
        </select>
      </td>
      <td><input type="text" value="${l.descricao}" placeholder="ex.: Britagem — expansão" ${editavel ? '' : 'disabled'} onchange="onDescricaoLinhaChange('${l.id}', this.value)"></td>
      <td><input type="number" min="${l.reservado || 0}" step="0.01" value="${l.valor || ''}" placeholder="0" ${editavel ? '' : 'disabled'} onchange="onValorLinhaChange('${l.id}', this.value)"></td>
      <td class="text-right">${l.reservado > 0 ? `<a href="#" onclick="onVerPaisDaLinha('${l.id}');return false;" style="color:var(--accent)" title="Ver quais PAIs usam esta linha">${fmtMoeda(l.reservado)}</a>` : '<span class="text-muted">—</span>'}</td>
      <td class="text-right">
        ${estado.status === 'rascunho'
          ? `<button class="btn btn-ghost btn-sm" onclick="onRemoverLinha('${l.id}')" title="Remover">✕ Remover</button>`
          : cancelavel
            ? `<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="onAbrirCancelarLinha('${l.id}')" title="Cancelar linha">Cancelar</button>`
            : `<span title="${l.reservado > 0 ? 'Linha com verba reservada' : 'Linha travada — faz parte da publicação'}">🔒</span>`}
      </td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════
async function onEmpresaPlanoChange(empresaId) {
  estado.empresaId = empresaId;
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  await carregarPlano();
  render();
}

async function onAnoPlanoChange(ano) {
  estado.ano = parseInt(ano, 10);
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  await carregarPlano();
  render();
}

async function onAddLinha() {
  const primeiroSetor = estado.setoresDaEmpresa[0];
  const { error } = await sb.from('linhas_plano').insert({
    plano_id: estado.planoId, setor_id: primeiroSetor.setorId, descricao: '', valor: 0, tipo: 'planejada'
  });
  if (error) { toast('Erro ao adicionar linha: ' + error.message, 'error'); return; }
  await carregarLinhas();
  render();
}

async function onSetorLinhaChange(linhaId, setorId) {
  const linha = estado.linhas.find(l => l.id === linhaId);
  if (!linha || !linhaEditavel(linha)) { toast('Esta linha não pode mais ser editada.', 'error'); render(); return; }

  if (estado.status === 'aprovado') {
    const novoSetor = estado.setoresDaEmpresa.find(s => s.setorId === setorId);
    const teto = novoSetor?.areaId ? (estado.tetoPorArea[novoSetor.areaId] ?? 0) : Infinity;
    const somaSemEsta = somaAreaAtiva(novoSetor?.areaId, linhaId);
    if (somaSemEsta + linha.valor > teto + 1e-9) {
      toast(`Mudar para este setor estouraria o teto da área (${fmtMoeda(teto)}). Solicite aumento de verba (próxima etapa).`, 'error');
      render();
      return;
    }
  }

  const { error } = await sb.from('linhas_plano').update({ setor_id: setorId }).eq('id', linhaId);
  if (error) { toast('Erro ao atualizar linha: ' + error.message, 'error'); return; }
  await carregarLinhas();
  render();
}

async function onDescricaoLinhaChange(linhaId, valor) {
  const linha = estado.linhas.find(l => l.id === linhaId);
  if (!linha || !linhaEditavel(linha)) { toast('Esta linha não pode mais ser editada.', 'error'); render(); return; }
  const { error } = await sb.from('linhas_plano').update({ descricao: valor }).eq('id', linhaId);
  if (error) { toast('Erro ao atualizar descrição: ' + error.message, 'error'); return; }
  linha.descricao = valor;
}

async function onValorLinhaChange(linhaId, valor) {
  const linha = estado.linhas.find(l => l.id === linhaId);
  if (!linha || !linhaEditavel(linha)) { toast('Esta linha não pode mais ser editada.', 'error'); render(); return; }

  const novoValor = numOrZero(valor);
  if (novoValor < linha.reservado - 1e-9) {
    toast(`Não é possível reduzir abaixo do já reservado (${fmtMoeda(linha.reservado)})`, 'error');
    render();
    return;
  }

  if (estado.status === 'aprovado') {
    const teto = linha.areaId ? (estado.tetoPorArea[linha.areaId] ?? 0) : Infinity;
    const somaSemEsta = somaAreaAtiva(linha.areaId, linhaId);
    if (somaSemEsta + novoValor > teto + 1e-9) {
      toast(`Estouraria o teto da área (${fmtMoeda(teto)}). Reduza o valor ou solicite aumento de verba (próxima etapa).`, 'error');
      render();
      return;
    }
  }

  const { error } = await sb.from('linhas_plano').update({ valor: novoValor }).eq('id', linhaId);
  if (error) { toast('Erro ao atualizar valor: ' + error.message, 'error'); render(); return; }
  await carregarLinhas();
  render();
}

// Remoção de verdade — só existe enquanto o plano é rascunho.
async function onRemoverLinha(linhaId) {
  if (estado.status !== 'rascunho') { toast('Plano já publicado — cancele a linha em vez de remover.', 'error'); return; }
  if (!confirm('Remover esta linha do plano?')) return;
  const { error } = await sb.from('linhas_plano').delete().eq('id', linhaId);
  if (error) { toast('Erro ao remover linha: ' + error.message, 'error'); return; }
  await carregarLinhas();
  render();
}

// Cancelamento (soft, com motivo) — a única forma de tirar uma linha do
// plano depois de publicado, e só se ela não tiver reserva.
function onAbrirCancelarLinha(linhaId) {
  const linha = estado.linhas.find(l => l.id === linhaId);
  if (!linha || !linhaCancelavel(linha)) { toast('Esta linha não pode ser cancelada.', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-cancelar-linha';
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <h2>Cancelar linha</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="text-sm text-muted" style="margin-bottom:12px">${linha.setorNome} · ${linha.descricao || '(sem descrição)'} · ${fmtMoeda(linha.valor)}</div>
        <div class="field"><label>Motivo *</label><textarea id="cancelar-linha-motivo" rows="3" placeholder="Explique por que esta linha está sendo cancelada..."></textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Voltar</button>
        <button class="btn btn-danger" onclick="onConfirmarCancelarLinha('${linhaId}')">Cancelar linha</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function onConfirmarCancelarLinha(linhaId) {
  const motivo = document.getElementById('cancelar-linha-motivo').value.trim();
  if (!motivo) { toast('Explique o motivo do cancelamento', 'error'); return; }

  const { error } = await sb.from('linhas_plano').update({
    cancelada: true, cancelada_motivo: motivo, cancelada_por: currentUser.id, cancelada_em: new Date().toISOString()
  }).eq('id', linhaId);
  if (error) { toast('Erro ao cancelar linha: ' + error.message, 'error'); return; }

  document.getElementById('modal-cancelar-linha')?.remove();
  toast('Linha cancelada');
  await carregarLinhas();
  render();
}

async function onPublicarPlano() {
  const ativas = estado.linhas.filter(l => !l.cancelada);
  if (ativas.length === 0) { toast('Adicione ao menos uma linha ativa antes de publicar', 'error'); return; }
  if (!confirm(`Publicar o plano de ${estado.ano}? A partir daí, o teto de cada área fica congelado e o plano passa a ficar disponível para solicitação de PAI.`)) return;

  // Congela o teto por área = soma das linhas ativas de cada área agora.
  const tetoPorArea = {};
  ativas.forEach(l => {
    if (!l.areaId) return; // setor sem área vinculada não tem "área" para travar
    tetoPorArea[l.areaId] = (tetoPorArea[l.areaId] || 0) + l.valor;
  });
  const linhasTeto = Object.entries(tetoPorArea).map(([areaId, valor]) => ({ plano_id: estado.planoId, area_id: areaId, valor_teto: valor }));
  if (linhasTeto.length) {
    const { error: erroTeto } = await sb.from('teto_area_plano').upsert(linhasTeto, { onConflict: 'plano_id,area_id' });
    if (erroTeto) { toast('Erro ao congelar teto por área: ' + erroTeto.message, 'error'); return; }
  }

  const { error } = await sb.from('planos_investimento').update({
    status: 'aprovado', aprovado_em: new Date().toISOString(), aprovado_por: currentUser.id
  }).eq('id', estado.planoId);
  if (error) { toast('Erro ao publicar plano: ' + error.message, 'error'); return; }

  toast('Plano publicado! Já está disponível para solicitação de PAI.');
  await carregarPlano();
  render();
}

// ═══════════════════════════════════════════════════
// RASTREABILIDADE — quais PAIs consomem esta linha (número, título, valor
// vinculado, status). Só faz sentido quando a linha tem reserva.
// ═══════════════════════════════════════════════════
async function onVerPaisDaLinha(linhaId) {
  const linha = estado.linhas.find(l => l.id === linhaId);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><div class="loading"><div class="spinner"></div> Carregando...</div></div>';
  document.body.appendChild(overlay);

  const { data, error } = await sb.from('vinculos_verba').select('valor, pais(numero,titulo,status)').eq('linha_id', linhaId);
  if (error) { toast('Erro ao carregar PAIs da linha: ' + error.message, 'error'); overlay.remove(); return; }

  overlay.querySelector('.modal').innerHTML = `
    <div class="modal-header">
      <h2>PAIs que usam esta linha</h2>
      <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="text-sm text-muted" style="margin-bottom:12px">${linha?.setorNome || ''} · ${linha?.descricao || '(sem descrição)'}</div>
      ${(!data || data.length === 0) ? '<div class="text-xs text-muted">Nenhum PAI usa esta linha ainda.</div>' : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Título</th><th class="text-right">Valor vinculado</th><th>Status</th></tr></thead>
        <tbody>
          ${data.map(v => `
            <tr>
              <td><span class="font-mono text-xs" style="color:var(--accent)">${v.pais?.numero || '—'}</span></td>
              <td>${v.pais?.titulo || '—'}</td>
              <td class="text-right">${fmtMoeda(v.valor)}</td>
              <td>${v.pais?.status ? badgeStatusPai(v.pais.status) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Fechar</button></div>`;
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  renderPlanoInvestimento, onEmpresaPlanoChange, onAnoPlanoChange, onAddLinha,
  onSetorLinhaChange, onDescricaoLinhaChange, onValorLinhaChange, onRemoverLinha,
  onAbrirCancelarLinha, onConfirmarCancelarLinha, onPublicarPlano, onVerPaisDaLinha
});
