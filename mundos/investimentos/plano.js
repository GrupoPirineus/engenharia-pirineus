import { sb } from '../../shared/supabase.js';
import { toast, fmtDateTime } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { fmtMoeda, badgeStatusPai } from './dashboard.js';
import { anoVigente, renderOpcoesAno, dicaAno, hojeBrasilia } from './ano.js';

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
//
// JANELA DE AJUSTE (Etapa 23): até a data de corte (padrão 31/12 do ano
// anterior ao plano, configurável em Administração → Configurações →
// Calendário do Plano), o plano publicado pode ser ajustado: alterar
// valor/descrição/setor de qualquer linha planejada, incluir e cancelar
// linhas — e o teto da área acompanha (recalculado no banco). Depois do
// corte vale a regra acima (teto congelado). Em plano publicado, toda
// gravação de linha planejada passa pelas funções plano_incluir_linha /
// plano_alterar_linha / plano_cancelar_linha, com motivo obrigatório,
// e vira registro em ajustes_plano. As proteções (valor ≥ reservado,
// linha com reserva não muda de setor nem cancela, teto ≥ reservado da
// área) são checadas aqui para dar a mensagem na hora e de novo no banco
// (triggers de linhas_plano), que é quem garante.
// ═══════════════════════════════════════════════════

const STATUS_LABELS = { rascunho: 'Rascunho', aprovado: 'Aprovado', encerrado: 'Encerrado' };
const STATUS_BADGE = { rascunho: 'badge-rascunho', aprovado: 'badge-success', encerrado: 'badge-concluido' };

export const TIPO_AJUSTE_LABELS = { inclusao: 'Inclusão', alteracao: 'Alteração', cancelamento: 'Cancelamento' };
export const CAMPO_AJUSTE_LABELS = { setor: 'Setor', descricao: 'Descrição', valor: 'Valor', situacao: 'Situação' };

// valor_antes/valor_depois chegam como texto: 'valor' é número cru e
// 'situacao' traz o valor entre parênteses ("Ativa (150000.00)").
export function fmtValorAjuste(campo, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'valor') return fmtMoeda(Number(v));
  if (campo === 'situacao') return String(v).replace(/\((-?[\d.]+)\)/, (_, n) => `(${fmtMoeda(Number(n))})`);
  return v;
}

let estado = null;

function numOrZero(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function fmtDataIso(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }

async function carregarCorte() {
  const { data, error } = await sb.from('config_prazos').select('dia_corte_plano,mes_corte_plano').eq('id', 1).maybeSingle();
  if (error) console.error('Erro ao carregar data de corte do plano:', error);
  const dia = data?.dia_corte_plano ?? 31;
  const mes = data?.mes_corte_plano ?? 12;
  estado.corte = `${estado.ano - 1}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  estado.janelaAberta = hojeBrasilia() <= estado.corte;
}

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
    linhas: [], reservadoPorLinha: {}, tetoPorArea: {}, setoresDaEmpresa: [],
    corte: null, janelaAberta: false, ajustes: []
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
  await Promise.all([carregarSetoresDaEmpresa(), carregarCorte()]);

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

  await carregarLinhas();
}

// Teto e histórico mudam a cada ajuste (na janela o banco recalcula o
// teto) — por isso são recarregados junto com as linhas.
async function carregarTetosEAjustes() {
  estado.tetoPorArea = {};
  estado.ajustes = [];
  if (estado.status !== 'aprovado') return;
  const [{ data: tetos, error: erroTetos }, { data: ajustes, error: erroAjustes }] = await Promise.all([
    sb.from('teto_area_plano').select('area_id,valor_teto').eq('plano_id', estado.planoId),
    sb.from('ajustes_plano').select('*, usuario:feito_por(nome), linhas_plano(descricao)').eq('plano_id', estado.planoId).order('feito_em', { ascending: false })
  ]);
  if (erroTetos) console.error('Erro ao carregar teto por área:', erroTetos);
  if (erroAjustes) console.error('Erro ao carregar histórico de ajustes:', erroAjustes);
  (tetos || []).forEach(t => { estado.tetoPorArea[t.area_id] = numOrZero(t.valor_teto); });
  estado.ajustes = ajustes || [];
}

async function carregarLinhas() {
  const [{ data: linhas, error: erroLinhas }, { data: reservas, error: erroReservas }] = await Promise.all([
    sb.from('linhas_plano').select('*').eq('plano_id', estado.planoId).order('criado_em'),
    sb.from('saldo_linhas').select('linha_id,reservado').eq('plano_id', estado.planoId),
    carregarTetosEAjustes()
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

// Edição em linha (inputs da tabela) só existe no rascunho. Em plano
// publicado a edição é pelo modal "Ajustar linha", que exige motivo.
function linhaEditavel(linha) {
  return !linha.cancelada && estado.status === 'rascunho';
}

// Plano publicado — só linhas 'planejada' (aumento e devolução vêm dos
// próprios fluxos e não são ajustadas aqui). Na janela, qualquer linha
// planejada ativa; depois do corte, a regra da Etapa 6: só linha nascida
// depois da publicação e ainda sem reserva.
function linhaAjustavel(linha) {
  if (estado.status !== 'aprovado' || linha.cancelada || linha.tipo !== 'planejada') return false;
  if (estado.janelaAberta) return true;
  const posPublicacao = estado.aprovadoEm && linha.criadoEm > estado.aprovadoEm;
  return posPublicacao && linha.reservado === 0;
}

function linhaCancelavel(linha) {
  return estado.status === 'aprovado' && !linha.cancelada && linha.tipo === 'planejada' && linha.reservado === 0;
}

function somaAreaAtiva(areaId, excluirLinhaId) {
  return estado.linhas
    .filter(l => l.areaId === areaId && !l.cancelada && l.id !== excluirLinhaId)
    .reduce((a, l) => a + l.valor, 0);
}

// Legenda "Setor · Área · livre R$X" mostrada abaixo do select de setor —
// deixa claro de qual bolo a linha vai debitar antes de digitar o valor.
// Em rascunho ainda não existe teto, então some só "Setor · Área".
// excluirLinhaId tira a própria linha da soma do "ativo" (usado no preview
// ao trocar de setor, antes de persistir — a linha ainda não está lá).
function legendaAreaSetor(setorInfo, excluirLinhaId = null) {
  if (!setorInfo) return '';
  if (!setorInfo.areaId) return `${setorInfo.setorNome} · sem área vinculada`;
  if (estado.status !== 'aprovado') return `${setorInfo.setorNome} · ${setorInfo.areaNome}`;
  const teto = estado.tetoPorArea[setorInfo.areaId] ?? 0;
  // Na janela de ajuste o teto acompanha as linhas — "livre" seria sempre 0.
  if (estado.janelaAberta) return `${setorInfo.setorNome} · ${setorInfo.areaNome} · teto atual ${fmtMoeda(teto)}`;
  const ativa = somaAreaAtiva(setorInfo.areaId, excluirLinhaId);
  const livre = teto - ativa;
  return `${setorInfo.setorNome} · ${setorInfo.areaNome} · livre ${fmtMoeda(livre)}`;
}

// ═══════════════════════════════════════════════════
// MODAL DE CONFIRMAÇÃO (substitui confirm() nativo — mesmo padrão visual
// dos outros modais da tela: .modal-overlay/.modal)
// ═══════════════════════════════════════════════════
function abrirModalConfirmacao({ titulo, mensagem, textoBotao = 'Confirmar', variante = 'btn-primary', aoConfirmar }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-confirmacao-plano';
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <h2>${titulo}</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text2);line-height:1.6;font-size:13px">${mensagem}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn ${variante}" id="btn-confirmar-modal-plano">${textoBotao}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btn-confirmar-modal-plano').onclick = async () => {
    overlay.remove();
    await aoConfirmar();
  };
}

// ═══════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════
function render() {
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
            ${renderOpcoesAno(estado.ano)}
          </select>
          <div class="text-xs text-muted" style="margin-top:4px">${dicaAno(estado.ano)}</div>
        </div>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <span class="badge ${STATUS_BADGE[estado.status] || ''}">${STATUS_LABELS[estado.status] || estado.status}</span>
      ${publicado ? `<span class="text-xs text-muted">publicado em ${fmtDateTime(estado.aprovadoEm)}</span>` : ''}
      ${!publicado && !encerrado ? `<button class="btn btn-primary btn-sm" onclick="onPublicarPlano()">Publicar plano</button>` : ''}
      ${!publicado && !encerrado ? `<span class="text-xs text-muted">enquanto rascunho, o plano não fica disponível para solicitação de PAI</span>` : ''}
    </div>
    ${publicado ? renderAvisoJanela() : ''}

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
          <thead><tr><th style="width:220px">Setor</th><th>Descrição</th><th class="text-right" style="width:150px">Valor</th><th class="text-right" style="width:120px">Reservado</th><th style="width:${publicado ? 170 : 110}px"></th></tr></thead>
          <tbody id="linhas-plano-tbody">${renderLinhasTabela()}</tbody>
        </table>
        </div>`}
        <div style="margin-top:12px">
          ${publicado
            ? `<button class="btn btn-secondary btn-sm" id="btn-add-linha" ${estado.setoresDaEmpresa.length === 0 ? 'disabled' : ''} onclick="onAbrirAjusteLinha()">+ Incluir linha</button>
               <span class="text-xs text-muted" style="margin-left:8px">${estado.janelaAberta ? 'o teto da área acompanha a inclusão' : 'só dentro do livre do teto da área'}</span>`
            : `<button class="btn btn-secondary btn-sm" id="btn-add-linha" ${estado.setoresDaEmpresa.length === 0 ? 'disabled' : ''} onclick="onAddLinha()">+ Adicionar linha</button>`}
        </div>
      </div>

      <div class="chart-card">
        <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Bolo por área</div>
        <div id="resumo-area" style="display:flex;flex-direction:column;gap:10px">${renderResumoArea(resumoArea)}</div>
        <div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--border);padding-top:8px;margin-top:8px">
          <span>Total geral</span><span>${fmtMoeda(totalGeral)}</span>
        </div>
      </div>
    </div>
    ${publicado ? renderHistoricoAjustes() : ''}`;
}

// Aviso da fase do plano publicado (Etapa 23).
function renderAvisoJanela() {
  const [cor, fundo, texto] = estado.janelaAberta
    ? ['var(--accent)', 'var(--accent-dim)', `Plano publicado — ajustes permitidos até ${fmtDataIso(estado.corte)}. Cada alteração exige motivo.`]
    : ['var(--red)', 'var(--surface2)', 'Plano congelado — acréscimos somente por aumento de verba.'];
  return `
    <div id="aviso-janela-plano" style="border:1px solid ${cor};background:${fundo};color:${cor};border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;margin:-8px 0 20px">
      ${texto}
    </div>`;
}

function renderHistoricoAjustes() {
  const ajustes = estado.ajustes;
  return `
    <div class="table-card" style="margin-top:24px">
      <div class="table-header"><div class="table-title">Histórico de ajustes · ${ajustes.length}</div></div>
      ${ajustes.length === 0 ? '<div class="empty-state" style="padding:20px"><div class="empty-desc">Nenhum ajuste depois da publicação.</div></div>' : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Quando</th><th>Quem</th><th>Tipo</th><th>Linha</th><th>Campo</th><th>Antes</th><th>Depois</th><th>Motivo</th></tr></thead>
        <tbody>
          ${ajustes.map(a => `
            <tr>
              <td class="text-xs" style="white-space:nowrap">${fmtDateTime(a.feito_em)}${a.na_janela ? '' : '<div class="text-muted">após o corte</div>'}</td>
              <td>${a.usuario?.nome || '—'}</td>
              <td>${TIPO_AJUSTE_LABELS[a.tipo] || a.tipo}</td>
              <td>${a.linhas_plano?.descricao || '—'}</td>
              <td>${CAMPO_AJUSTE_LABELS[a.campo] || a.campo}</td>
              <td class="text-muted">${fmtValorAjuste(a.campo, a.valor_antes)}</td>
              <td>${fmtValorAjuste(a.campo, a.valor_depois)}</td>
              <td class="text-xs">${a.motivo}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
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

  // Publicado: teto · ativo (soma das linhas não canceladas hoje) · livre
  // (teto − ativo) — o que sobra pra uma linha nova. Na janela de ajuste o
  // teto acompanha os ajustes; depois do corte, fica congelado.
  return resumo.map(r => {
    const teto = r.areaId ? (estado.tetoPorArea[r.areaId] ?? 0) : 0;
    const livre = teto - r.total;
    const estourado = livre < -1e-9;
    return `
      <div style="padding-bottom:10px;margin-bottom:2px;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">${r.nome}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2)"><span>Teto${estado.janelaAberta ? ' (acompanha os ajustes)' : ' (congelado)'}</span><span>${fmtMoeda(teto)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2)"><span>Ativo</span><span>${fmtMoeda(r.total)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600"><span>Livre</span><span style="color:${estourado ? 'var(--red)' : 'var(--green)'}">${fmtMoeda(livre)}</span></div>
      </div>`;
  }).join('');
}

function renderLinhasTabela() {
  return estado.linhas.map(l => {
    const editavel = linhaEditavel(l);
    const ajustavel = linhaAjustavel(l);
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
    // Rascunho: inputs editáveis. Publicado: só leitura em texto — a edição
    // é pelo modal "Ajustar linha" (com motivo).
    const celulasDados = editavel ? `
      <td>
        <select onchange="onSetorLinhaChange('${l.id}', this.value)">
          ${estado.setoresDaEmpresa.map(s => `<option value="${s.setorId}" ${s.setorId === l.setorId ? 'selected' : ''}>${s.setorNome}</option>`).join('')}
        </select>
        <div id="legenda-setor-${l.id}" class="text-xs text-muted" style="margin-top:4px">${legendaAreaSetor(l)}</div>
      </td>
      <td><input type="text" value="${l.descricao}" placeholder="ex.: Britagem — expansão" onchange="onDescricaoLinhaChange('${l.id}', this.value)"></td>
      <td><input type="number" min="${l.reservado || 0}" step="0.01" value="${l.valor || ''}" placeholder="0" onchange="onValorLinhaChange('${l.id}', this.value)"></td>` : `
      <td>
        ${l.setorNome}
        <div id="legenda-setor-${l.id}" class="text-xs text-muted" style="margin-top:4px">${legendaAreaSetor(estado.setoresDaEmpresa.find(s => s.setorId === l.setorId))}</div>
      </td>
      <td>${l.descricao || '<span class="text-muted">(sem descrição)</span>'}${l.tipo !== 'planejada' ? `<div class="text-xs text-muted">${l.tipo === 'aumento' ? 'aumento de verba' : 'devolução'}</div>` : ''}</td>
      <td class="text-right">${fmtMoeda(l.valor)}</td>`;
    return `
    <tr>
      ${celulasDados}
      <td class="text-right">${l.reservado > 0 ? `<a href="#" onclick="onVerPaisDaLinha('${l.id}');return false;" style="color:var(--accent)" title="Ver quais PAIs usam esta linha">${fmtMoeda(l.reservado)}</a>` : '<span class="text-muted">—</span>'}</td>
      <td class="text-right">
        ${estado.status === 'rascunho'
          ? `<button class="btn btn-ghost btn-sm" onclick="onRemoverLinha('${l.id}')" title="Remover">✕ Remover</button>`
          : (ajustavel || cancelavel)
            ? `<div style="display:flex;gap:4px;justify-content:flex-end">
                ${ajustavel ? `<button class="btn btn-ghost btn-sm" onclick="onAbrirAjusteLinha('${l.id}')" title="Ajustar linha">Ajustar</button>` : ''}
                ${cancelavel ? `<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="onAbrirCancelarLinha('${l.id}')" title="Cancelar linha">Cancelar</button>` : ''}
              </div>`
            : `<span title="${tituloCadeado(l)}">🔒</span>`}
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

  const novoSetor = estado.setoresDaEmpresa.find(s => s.setorId === setorId);

  // Feedback imediato: mostra a área/livre do setor recém-escolhido antes
  // mesmo de confirmar a gravação.
  const legendaEl = document.getElementById(`legenda-setor-${linhaId}`);
  if (legendaEl) legendaEl.textContent = legendaAreaSetor(novoSetor, linhaId);

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

  const { error } = await sb.from('linhas_plano').update({ valor: novoValor }).eq('id', linhaId);
  if (error) { toast('Erro ao atualizar valor: ' + error.message, 'error'); render(); return; }
  await carregarLinhas();
  render();
}

// Remoção de verdade — só existe enquanto o plano é rascunho.
function onRemoverLinha(linhaId) {
  if (estado.status !== 'rascunho') { toast('Plano já publicado — cancele a linha em vez de remover.', 'error'); return; }
  abrirModalConfirmacao({
    titulo: 'Remover linha',
    mensagem: 'Remover esta linha do plano? Essa ação não pode ser desfeita.',
    textoBotao: 'Remover',
    variante: 'btn-danger',
    aoConfirmar: async () => {
      const { error } = await sb.from('linhas_plano').delete().eq('id', linhaId);
      if (error) { toast('Erro ao remover linha: ' + error.message, 'error'); return; }
      await carregarLinhas();
      render();
    }
  });
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
        <div class="field"><label>Motivo *</label><textarea id="cancelar-linha-motivo" rows="3" placeholder="Explique por que esta linha está sendo cancelada..." oninput="document.getElementById('cancelar-linha-erro').textContent=''"></textarea></div>
        <div id="cancelar-linha-erro" class="text-xs" style="color:var(--red);margin-top:-8px"></div>
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
  const erroEl = document.getElementById('cancelar-linha-erro');
  if (!motivo) { if (erroEl) erroEl.textContent = 'Explique o motivo do cancelamento.'; return; }
  if (erroEl) erroEl.textContent = '';

  // Via função de banco: grava o cancelamento e o registro em ajustes_plano
  // na mesma transação (Etapa 23).
  const { error } = await sb.rpc('plano_cancelar_linha', { p_linha_id: linhaId, p_motivo: motivo });
  if (error) { if (erroEl) erroEl.textContent = error.message; return; }

  document.getElementById('modal-cancelar-linha')?.remove();
  toast('Linha cancelada');
  await carregarLinhas();
  render();
}

function tituloCadeado(linha) {
  if (linha.tipo !== 'planejada') return 'Linha de aumento/devolução — gerada pelo próprio fluxo, não é ajustada aqui';
  if (linha.reservado > 0) return 'Plano congelado e linha com verba reservada';
  return 'Plano congelado — linha da publicação não muda mais (acréscimos somente por aumento de verba)';
}

// ═══════════════════════════════════════════════════
// AJUSTE DE PLANO PUBLICADO (Etapa 23) — um modal só para "Ajustar linha"
// (linhaId informado) e "Incluir linha" (sem linhaId). Motivo obrigatório.
// ═══════════════════════════════════════════════════
function onAbrirAjusteLinha(linhaId) {
  const linha = linhaId ? estado.linhas.find(l => l.id === linhaId) : null;
  if (linhaId && (!linha || !linhaAjustavel(linha))) { toast('Esta linha não pode ser ajustada.', 'error'); return; }
  const setorAtual = linha?.setorId || estado.setoresDaEmpresa[0]?.setorId;
  const comReserva = (linha?.reservado || 0) > 0;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-ajuste-linha';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h2>${linha ? 'Ajustar linha' : 'Incluir linha'}</h2>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        ${comReserva ? `<div class="text-xs" style="color:var(--text2);background:var(--surface2);border-radius:6px;padding:8px 10px;margin-bottom:12px">Esta linha tem <strong>${fmtMoeda(linha.reservado)}</strong> reservados por PAIs: o valor não pode ficar abaixo disso e o setor não pode mudar.</div>` : ''}
        <div class="field"><label>Setor</label>
          <select id="ajuste-setor" ${comReserva ? 'disabled' : ''} onchange="onAjusteSetorChange(this.value)">
            ${estado.setoresDaEmpresa.map(s => `<option value="${s.setorId}" ${s.setorId === setorAtual ? 'selected' : ''}>${s.setorNome}</option>`).join('')}
          </select>
          <div id="ajuste-legenda-setor" class="text-xs text-muted" style="margin-top:4px">${legendaAreaSetor(estado.setoresDaEmpresa.find(s => s.setorId === setorAtual), linha?.id)}</div>
        </div>
        <div class="field"><label>Descrição</label><input type="text" id="ajuste-descricao" value="${linha?.descricao || ''}" placeholder="ex.: Britagem — expansão"></div>
        <div class="field"><label>Valor *</label>
          <input type="number" min="${linha?.reservado || 0}" step="0.01" id="ajuste-valor" value="${linha ? linha.valor : ''}" placeholder="0">
          ${linha ? `<div class="text-xs text-muted" style="margin-top:4px">atual: ${fmtMoeda(linha.valor)}${comReserva ? ` · reservado: ${fmtMoeda(linha.reservado)}` : ''}</div>` : ''}
        </div>
        <div class="field"><label>Motivo *</label><textarea id="ajuste-motivo" rows="3" placeholder="Por que este ajuste está sendo feito?"></textarea></div>
        <div id="ajuste-erro" class="text-xs" style="color:var(--red);min-height:16px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Voltar</button>
        <button class="btn btn-primary" id="btn-confirmar-ajuste" onclick="onConfirmarAjusteLinha(${linha ? `'${linha.id}'` : 'null'})">${linha ? 'Salvar ajuste' : 'Incluir linha'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function onAjusteSetorChange(setorId) {
  const el = document.getElementById('ajuste-legenda-setor');
  if (el) el.textContent = legendaAreaSetor(estado.setoresDaEmpresa.find(s => s.setorId === setorId));
}

// Mesmas proteções que o banco aplica (triggers de linhas_plano) — aqui só
// para a mensagem sair na hora. Retorna o texto do erro ou null.
function validarAjuste(linha, setorId, descricao, valor, motivo) {
  if (!motivo) return 'Informe o motivo do ajuste — toda alteração de plano publicado exige motivo.';
  if (!(valor > 0)) return 'Informe um valor maior que zero.';
  const reservado = linha?.reservado || 0;
  if (valor < reservado - 1e-9) return `Não é possível reduzir abaixo do já reservado nesta linha (${fmtMoeda(reservado)}).`;
  if (linha && reservado > 0 && setorId !== linha.setorId) return `Linha com reserva (${fmtMoeda(reservado)}) não pode mudar de setor/área.`;
  if (linha && setorId === linha.setorId && descricao === (linha.descricao || '') && Math.abs(valor - linha.valor) < 0.005) return 'Nada foi alterado.';

  const setor = estado.setoresDaEmpresa.find(s => s.setorId === setorId);
  const areaId = setor?.areaId;
  if (!areaId) return null; // setor sem área vinculada: sem teto a conferir

  const somaDepois = somaAreaAtiva(areaId, linha?.id) + valor;
  if (estado.janelaAberta) {
    const reservadoArea = estado.linhas.filter(l => l.areaId === areaId && !l.cancelada && l.id !== linha?.id).reduce((a, l) => a + l.reservado, 0) + reservado;
    if (somaDepois < reservadoArea - 1e-9) return `O teto de ${setor.areaNome} ficaria em ${fmtMoeda(somaDepois)}, abaixo do já reservado na área (${fmtMoeda(reservadoArea)}).`;
  } else {
    const teto = estado.tetoPorArea[areaId] ?? 0;
    if (somaDepois > teto + 1e-9) return `Plano congelado: estouraria o teto de ${setor.areaNome} (livre ${fmtMoeda(teto - somaAreaAtiva(areaId, linha?.id))}) — acréscimos somente por aumento de verba.`;
  }
  return null;
}

async function onConfirmarAjusteLinha(linhaId) {
  const linha = linhaId ? estado.linhas.find(l => l.id === linhaId) : null;
  const erroEl = document.getElementById('ajuste-erro');
  const setorId = linha && linha.reservado > 0 ? linha.setorId : document.getElementById('ajuste-setor').value;
  const descricao = document.getElementById('ajuste-descricao').value.trim();
  const valor = numOrZero(document.getElementById('ajuste-valor').value);
  const motivo = document.getElementById('ajuste-motivo').value.trim();

  const erro = validarAjuste(linha, setorId, descricao, valor, motivo);
  if (erro) { erroEl.textContent = erro; return; }
  erroEl.textContent = '';

  const btn = document.getElementById('btn-confirmar-ajuste');
  if (btn) btn.disabled = true;
  const { error } = linha
    ? await sb.rpc('plano_alterar_linha', { p_linha_id: linha.id, p_setor_id: setorId, p_descricao: descricao, p_valor: valor, p_motivo: motivo })
    : await sb.rpc('plano_incluir_linha', { p_plano_id: estado.planoId, p_setor_id: setorId, p_descricao: descricao, p_valor: valor, p_motivo: motivo });
  if (error) { erroEl.textContent = error.message; if (btn) btn.disabled = false; return; }

  document.getElementById('modal-ajuste-linha')?.remove();
  toast(linha ? 'Ajuste registrado' : 'Linha incluída');
  await carregarLinhas();
  render();
}

function onPublicarPlano() {
  const ativas = estado.linhas.filter(l => !l.cancelada);
  if (ativas.length === 0) { toast('Adicione ao menos uma linha ativa antes de publicar', 'error'); return; }

  abrirModalConfirmacao({
    titulo: 'Publicar plano',
    mensagem: `Publicar o plano de ${estado.ano}? O teto de cada área fica congelado a partir de agora, e o plano passa a ficar disponível para solicitação de PAI.`,
    textoBotao: 'Publicar plano',
    variante: 'btn-primary',
    aoConfirmar: publicarPlanoConfirmado
  });
}

async function publicarPlanoConfirmado() {
  const ativas = estado.linhas.filter(l => !l.cancelada);

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
  onAbrirCancelarLinha, onConfirmarCancelarLinha, onPublicarPlano, onVerPaisDaLinha,
  onAbrirAjusteLinha, onAjusteSetorChange, onConfirmarAjusteLinha
});
