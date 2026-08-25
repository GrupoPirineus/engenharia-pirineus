import { sb } from '../shared/supabase.js';
import { toast } from '../shared/ui.js';

// ═══════════════════════════════════════════════════
// ADMINISTRAÇÃO — Unidades e Setores (só isMaster(), RLS garante a escrita)
// Unidades = empresas. Setores = cadastro global do grupo (setores).
// Cada unidade escolhe quais setores tem, em empresa_setores — o vínculo à
// área de cada linha empresa_setores é feito na aba "Vínculo Setor → Área".
// ═══════════════════════════════════════════════════

let abaAtual = 'unidades'; // 'unidades' | 'setores' | 'setores-unidade'

export async function renderUnidadesSetores(aba) {
  if (aba) abaAtual = aba;
  document.getElementById('topbar-title').textContent = 'Administração · Unidades e Setores';
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('page-content').innerHTML = `
    <div class="filters" style="margin-bottom:16px">
      <button class="btn btn-sm ${abaAtual === 'unidades' ? 'btn-primary' : 'btn-secondary'}" onclick="renderUnidadesSetores('unidades')">Unidades</button>
      <button class="btn btn-sm ${abaAtual === 'setores' ? 'btn-primary' : 'btn-secondary'}" onclick="renderUnidadesSetores('setores')">Setores</button>
      <button class="btn btn-sm ${abaAtual === 'setores-unidade' ? 'btn-primary' : 'btn-secondary'}" onclick="renderUnidadesSetores('setores-unidade')">Setores por unidade</button>
    </div>
    <div id="unidades-conteudo"><div class="loading"><div class="spinner"></div> Carregando...</div></div>`;

  if (abaAtual === 'unidades') await montarAbaUnidades();
  else if (abaAtual === 'setores') await montarAbaSetoresGlobais();
  else await montarAbaSetoresPorUnidade();
}

// ═══════════════════════════════════════════════════
// ABA · UNIDADES (empresas)
// ═══════════════════════════════════════════════════
async function montarAbaUnidades() {
  const conteudo = document.getElementById('unidades-conteudo');
  const { data: empresas, error } = await sb.from('empresas').select('*').order('nome');
  if (error) { toast('Erro ao carregar unidades: ' + error.message, 'error'); return; }

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Unidades · ${(empresas || []).length}</div>
        <button class="btn btn-primary btn-sm" onclick="abrirFormUnidade()">+ Nova unidade</button>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Unidade</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${(empresas || []).map(e => `
            <tr onclick="abrirFormUnidade('${e.id}')">
              <td><strong>${e.nome}</strong></td>
              <td>${e.ativo ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-danger">Inativa</span>'}</td>
              <td class="text-right"><a href="#" onclick="event.stopPropagation();alternarAtivaUnidade('${e.id}',${e.ativo});return false;" style="color:var(--accent);font-size:12px">${e.ativo ? 'Desativar' : 'Ativar'}</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

export async function abrirFormUnidade(id) {
  const existente = id ? await sb.from('empresas').select('*').eq('id', id).single().then(r => r.data) : null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-unidade';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h2>${id ? 'Editar unidade' : 'Nova unidade'}</h2>
        <button class="close-btn" onclick="document.getElementById('modal-unidade').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field"><label>Nome *</label><input type="text" id="unidade-nome" value="${existente?.nome || ''}" placeholder="ex.: Fillercal"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-unidade').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarUnidade(${id ? `'${id}'` : 'null'})">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('unidade-nome')?.focus(), 100);
}

export async function salvarUnidade(id) {
  const nome = document.getElementById('unidade-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório', 'error'); return; }
  const { error } = id
    ? await sb.from('empresas').update({ nome }).eq('id', id)
    : await sb.from('empresas').insert({ nome });
  if (error) { toast('Erro ao salvar unidade: ' + error.message, 'error'); return; }
  document.getElementById('modal-unidade')?.remove();
  toast('Unidade salva');
  montarAbaUnidades();
}

export async function alternarAtivaUnidade(id, ativaAtual) {
  const { error } = await sb.from('empresas').update({ ativo: !ativaAtual }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(ativaAtual ? 'Unidade desativada' : 'Unidade ativada');
  montarAbaUnidades();
}

// ═══════════════════════════════════════════════════
// ABA · SETORES (cadastro global do grupo)
// ═══════════════════════════════════════════════════
async function montarAbaSetoresGlobais() {
  const conteudo = document.getElementById('unidades-conteudo');
  const { data: setores, error } = await sb.from('setores').select('*').order('nome');
  if (error) { toast('Erro ao carregar setores: ' + error.message, 'error'); return; }

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Setores (cadastro global) · ${(setores || []).length}</div>
        <button class="btn btn-primary btn-sm" onclick="abrirFormSetorGlobal()">+ Novo setor</button>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Setor</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${(setores || []).map(s => `
            <tr>
              <td>${s.nome}</td>
              <td>${s.ativo ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-danger">Inativo</span>'}</td>
              <td class="text-right"><a href="#" onclick="alternarAtivoSetorGlobal('${s.id}',${s.ativo});return false;" style="color:var(--accent);font-size:12px">${s.ativo ? 'Desativar' : 'Ativar'}</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

export function abrirFormSetorGlobal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-setor-global';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h2>Novo setor</h2>
        <button class="close-btn" onclick="document.getElementById('modal-setor-global').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field"><label>Nome *</label><input type="text" id="setor-global-nome" placeholder="ex.: Expedição"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-setor-global').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarSetorGlobal()">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('setor-global-nome')?.focus(), 100);
}

export async function salvarSetorGlobal() {
  const nome = document.getElementById('setor-global-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório', 'error'); return; }
  const { error } = await sb.from('setores').insert({ nome });
  if (error) { toast('Erro ao salvar setor: ' + error.message, 'error'); return; }
  document.getElementById('modal-setor-global')?.remove();
  toast('Setor criado');
  montarAbaSetoresGlobais();
}

export async function alternarAtivoSetorGlobal(id, ativoAtual) {
  const { error } = await sb.from('setores').update({ ativo: !ativoAtual }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(ativoAtual ? 'Setor desativado' : 'Setor ativado');
  montarAbaSetoresGlobais();
}

// ═══════════════════════════════════════════════════
// ABA · SETORES POR UNIDADE (empresa_setores — quais setores cada unidade tem)
// O vínculo à área dessas linhas é feito na aba "Vínculo Setor → Área".
// ═══════════════════════════════════════════════════
let empresaSetoresSelecionada = null;

async function montarAbaSetoresPorUnidade() {
  const conteudo = document.getElementById('unidades-conteudo');
  const { data: empresas, error } = await sb.from('empresas').select('id,nome').eq('ativo', true).order('nome');
  if (error) { toast('Erro ao carregar unidades: ' + error.message, 'error'); return; }

  if (empresaSetoresSelecionada && !(empresas || []).some(e => e.id === empresaSetoresSelecionada)) {
    empresaSetoresSelecionada = null;
  }

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Setores por unidade</div>
        <select id="setores-unidade-empresa" style="max-width:280px" onchange="selecionarEmpresaSetores(this.value)">
          <option value="">— escolha a unidade —</option>
          ${(empresas || []).map(e => `<option value="${e.id}" ${empresaSetoresSelecionada === e.id ? 'selected' : ''}>${e.nome}</option>`).join('')}
        </select>
      </div>
      <div id="setores-da-unidade-lista">
        ${empresaSetoresSelecionada ? '<div class="loading"><div class="spinner"></div> Carregando...</div>' : '<div class="empty-state"><div class="empty-title">Escolha uma unidade acima</div></div>'}
      </div>
    </div>`;

  if (empresaSetoresSelecionada) await carregarSetoresDaUnidade(empresaSetoresSelecionada);
}

export function selecionarEmpresaSetores(empresaId) {
  empresaSetoresSelecionada = empresaId || null;
  montarAbaSetoresPorUnidade();
}

// Caixa customizada (não é <input type="checkbox"> nativo): marcada = preenchida
// com var(--accent) + check; desmarcada = vazia com borda neutra.
function caixaSetorHtml(marcado) {
  const base = 'width:20px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-sizing:border-box;';
  if (marcado) {
    return `<span class="setor-chk" style="${base}background:var(--accent);border:1.5px solid var(--accent);color:#fff">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </span>`;
  }
  return `<span class="setor-chk" style="${base}background:transparent;border:1.5px solid var(--border)"></span>`;
}

function aplicarEstadoVisualSetor(linhaEl, marcado) {
  linhaEl.dataset.marcado = marcado ? '1' : '0';
  const slot = linhaEl.querySelector('.setor-chk-slot');
  if (slot) slot.innerHTML = caixaSetorHtml(marcado);
}

async function carregarSetoresDaUnidade(empresaId) {
  const alvo = document.getElementById('setores-da-unidade-lista');
  const [{ data: todosSetores, error: errSetores }, { data: vinculados, error: errVinculo }] = await Promise.all([
    sb.from('setores').select('id,nome').eq('ativo', true).order('nome'),
    sb.from('empresa_setores').select('setor_id').eq('empresa_id', empresaId)
  ]);
  if (errSetores) { toast('Erro ao carregar setores: ' + errSetores.message, 'error'); return; }
  if (errVinculo) { toast('Erro ao carregar vínculos da unidade: ' + errVinculo.message, 'error'); return; }

  const idsVinculados = new Set((vinculados || []).map(v => v.setor_id));
  if (!alvo) return;
  alvo.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 16px 4px">
      <div class="text-xs text-muted" style="display:flex;align-items:center;gap:8px">
        ${caixaSetorHtml(true)} marcado = setor pertence a esta unidade · clique para adicionar/remover
      </div>
      <div style="display:flex;gap:14px">
        <a href="#" onclick="marcarTodosSetoresDaUnidade('${empresaId}');return false;" style="color:var(--accent);font-size:12px">Marcar todos</a>
        <a href="#" onclick="desmarcarTodosSetoresDaUnidade('${empresaId}');return false;" style="color:var(--red);font-size:12px">Desmarcar todos</a>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;padding:8px 16px 16px">
      ${(todosSetores || []).length === 0 ? '<div class="empty-desc">Nenhum setor cadastrado ainda. Cadastre na aba "Setores".</div>' : (todosSetores || []).map(s => {
        const marcado = idsVinculados.has(s.id);
        return `
        <div class="setor-unidade-row" data-setor="${s.id}" data-marcado="${marcado ? '1' : '0'}" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 0" onclick="clicouSetorNaUnidade('${empresaId}','${s.id}', this)">
          <span class="setor-chk-slot">${caixaSetorHtml(marcado)}</span>
          <span style="font-size:13px;color:var(--text)">${s.nome}</span>
        </div>`;
      }).join('')}
    </div>`;
}

export async function clicouSetorNaUnidade(empresaId, setorId, linhaEl) {
  const marcadoAtualmente = linhaEl.dataset.marcado === '1';
  if (marcadoAtualmente && !confirm('Remover este setor desta unidade? Isso também apaga o vínculo com a área feito para esta unidade.')) {
    return;
  }

  const novoEstado = !marcadoAtualmente;
  aplicarEstadoVisualSetor(linhaEl, novoEstado); // otimista — troca já no clique

  const { error } = novoEstado
    ? await sb.from('empresa_setores').insert({ empresa_id: empresaId, setor_id: setorId })
    : await sb.from('empresa_setores').delete().eq('empresa_id', empresaId).eq('setor_id', setorId);

  if (error) {
    aplicarEstadoVisualSetor(linhaEl, marcadoAtualmente); // reverte, a gravação falhou
    toast('Erro ao ' + (novoEstado ? 'adicionar' : 'remover') + ' setor: ' + error.message, 'error');
    return;
  }
  toast(novoEstado ? 'Setor adicionado à unidade' : 'Setor removido da unidade');
}

function linhasSetoresDaLista() {
  return [...document.querySelectorAll('#setores-da-unidade-lista .setor-unidade-row')];
}

export async function marcarTodosSetoresDaUnidade(empresaId) {
  const naoMarcadas = linhasSetoresDaLista().filter(l => l.dataset.marcado !== '1');
  if (naoMarcadas.length === 0) { toast('Todos os setores já estão vinculados a esta unidade'); return; }

  naoMarcadas.forEach(l => aplicarEstadoVisualSetor(l, true)); // otimista

  const payload = naoMarcadas.map(l => ({ empresa_id: empresaId, setor_id: l.dataset.setor }));
  const { error } = await sb.from('empresa_setores').insert(payload);

  if (error) {
    naoMarcadas.forEach(l => aplicarEstadoVisualSetor(l, false)); // reverte, a gravação falhou
    toast('Erro ao marcar todos: ' + error.message, 'error');
    return;
  }
  toast(`${naoMarcadas.length} setor(es) adicionado(s) à unidade`);
}

export async function desmarcarTodosSetoresDaUnidade(empresaId) {
  if (!confirm('Remover todos os setores desta unidade? Isso apaga também os vínculos com área feitos para esta unidade.')) return;

  const marcadas = linhasSetoresDaLista().filter(l => l.dataset.marcado === '1');
  if (marcadas.length === 0) { toast('Nenhum setor vinculado a esta unidade'); return; }

  marcadas.forEach(l => aplicarEstadoVisualSetor(l, false)); // otimista

  const { error } = await sb.from('empresa_setores').delete().eq('empresa_id', empresaId);

  if (error) {
    marcadas.forEach(l => aplicarEstadoVisualSetor(l, true)); // reverte, a gravação falhou
    toast('Erro ao desmarcar todos: ' + error.message, 'error');
    return;
  }
  toast(`${marcadas.length} setor(es) removido(s) da unidade`);
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  renderUnidadesSetores, abrirFormUnidade, salvarUnidade, alternarAtivaUnidade,
  abrirFormSetorGlobal, salvarSetorGlobal, alternarAtivoSetorGlobal,
  selecionarEmpresaSetores, clicouSetorNaUnidade,
  marcarTodosSetoresDaUnidade, desmarcarTodosSetoresDaUnidade
});
