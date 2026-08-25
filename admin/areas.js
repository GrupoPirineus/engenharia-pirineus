import { sb } from '../shared/supabase.js';
import { toast } from '../shared/ui.js';

// ═══════════════════════════════════════════════════
// ADMINISTRAÇÃO — Áreas e Diretorias (só isMaster(), RLS garante a escrita)
// setor → área (alçada 1) → diretoria (alçada 2) → diretor.
// Nenhuma responsabilidade fica em código — tudo é configuração aqui.
// ═══════════════════════════════════════════════════

let abaAtual = 'areas'; // 'areas' | 'diretorias' | 'vinculo' | 'conferencia'

export async function renderAreasDiretorias(aba) {
  if (aba) abaAtual = aba;
  document.getElementById('topbar-title').textContent = 'Administração · Áreas e Diretorias';
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('page-content').innerHTML = `
    <div class="filters" style="margin-bottom:16px">
      <button class="btn btn-sm ${abaAtual === 'areas' ? 'btn-primary' : 'btn-secondary'}" onclick="renderAreasDiretorias('areas')">Áreas</button>
      <button class="btn btn-sm ${abaAtual === 'diretorias' ? 'btn-primary' : 'btn-secondary'}" onclick="renderAreasDiretorias('diretorias')">Diretorias</button>
      <button class="btn btn-sm ${abaAtual === 'vinculo' ? 'btn-primary' : 'btn-secondary'}" onclick="renderAreasDiretorias('vinculo')">Vínculo Setor → Área</button>
      <button class="btn btn-sm ${abaAtual === 'conferencia' ? 'btn-primary' : 'btn-secondary'}" onclick="renderAreasDiretorias('conferencia')">Conferência</button>
    </div>
    <div id="areas-conteudo"><div class="loading"><div class="spinner"></div> Carregando...</div></div>`;

  if (abaAtual === 'areas') await montarAbaAreas();
  else if (abaAtual === 'diretorias') await montarAbaDiretorias();
  else if (abaAtual === 'vinculo') await montarAbaVinculo();
  else await montarAbaConferencia();
}

// ═══════════════════════════════════════════════════
// ABA · ÁREAS
// ═══════════════════════════════════════════════════
async function montarAbaAreas() {
  const conteudo = document.getElementById('areas-conteudo');
  const { data: areas, error } = await sb.from('areas')
    .select('*, diretorias(nome), responsavel:responsavel_id(nome)')
    .order('ordem');
  if (error) { toast('Erro ao carregar áreas: ' + error.message, 'error'); return; }

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Áreas · ${(areas || []).length}</div>
        <button class="btn btn-primary btn-sm" onclick="abrirFormArea()">+ Nova área</button>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Área</th><th>Cargo (rótulo)</th><th>Diretoria</th><th>Responsável · 1ª alçada</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${(areas || []).map(a => `
            <tr onclick="abrirFormArea('${a.id}')">
              <td><strong>${a.nome}</strong></td>
              <td>${a.cargo_responsavel || '<span class="text-muted">—</span>'}</td>
              <td>${a.diretorias?.nome || '<span class="text-muted">— sem diretoria —</span>'}</td>
              <td>${a.responsavel?.nome || '<span class="text-muted">— sem responsável —</span>'}</td>
              <td>${a.ativa ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-danger">Inativa</span>'}</td>
              <td class="text-right"><a href="#" onclick="event.stopPropagation();alternarAtivaArea('${a.id}',${a.ativa});return false;" style="color:var(--accent);font-size:12px">${a.ativa ? 'Desativar' : 'Ativar'}</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

export async function abrirFormArea(id) {
  const [{ data: diretorias }, { data: usuarios }, existente] = await Promise.all([
    sb.from('diretorias').select('id,nome').eq('ativa', true).order('nome'),
    sb.from('usuarios').select('id,nome').eq('ativo', true).order('nome'),
    id ? sb.from('areas').select('*').eq('id', id).single().then(r => r.data) : Promise.resolve(null)
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-area';
  overlay.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal-header">
        <h2>${id ? 'Editar área' : 'Nova área'}</h2>
        <button class="close-btn" onclick="document.getElementById('modal-area').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field"><label>Nome *</label><input type="text" id="area-nome" value="${existente?.nome || ''}" placeholder="ex.: Mineração"></div>
        <div class="field"><label>Cargo (rótulo, opcional)</label><input type="text" id="area-cargo" value="${existente?.cargo_responsavel || ''}" placeholder="ex.: Superintendente de Mina"></div>
        <div class="field"><label>Diretoria</label>
          <select id="area-diretoria">
            <option value="">— sem diretoria —</option>
            ${(diretorias || []).map(d => `<option value="${d.id}" ${existente?.diretoria_id === d.id ? 'selected' : ''}>${d.nome}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Responsável · 1ª alçada</label>
          <select id="area-responsavel">
            <option value="">— sem responsável —</option>
            ${(usuarios || []).map(u => `<option value="${u.id}" ${existente?.responsavel_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Ordem</label><input type="number" id="area-ordem" value="${existente?.ordem ?? 0}"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-area').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarArea(${id ? `'${id}'` : 'null'})">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

export async function salvarArea(id) {
  const nome = document.getElementById('area-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório', 'error'); return; }
  const payload = {
    nome,
    cargo_responsavel: document.getElementById('area-cargo').value.trim() || null,
    diretoria_id: document.getElementById('area-diretoria').value || null,
    responsavel_id: document.getElementById('area-responsavel').value || null,
    ordem: parseInt(document.getElementById('area-ordem').value, 10) || 0
  };
  const { error } = id
    ? await sb.from('areas').update(payload).eq('id', id)
    : await sb.from('areas').insert(payload);
  if (error) { toast('Erro ao salvar área: ' + error.message, 'error'); return; }
  document.getElementById('modal-area')?.remove();
  toast('Área salva');
  montarAbaAreas();
}

export async function alternarAtivaArea(id, ativaAtual) {
  const { error } = await sb.from('areas').update({ ativa: !ativaAtual }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(ativaAtual ? 'Área desativada' : 'Área ativada');
  montarAbaAreas();
}

// ═══════════════════════════════════════════════════
// ABA · DIRETORIAS
// ═══════════════════════════════════════════════════
async function montarAbaDiretorias() {
  const conteudo = document.getElementById('areas-conteudo');
  const { data: diretorias, error } = await sb.from('diretorias')
    .select('*, diretor:diretor_id(nome)')
    .order('ordem');
  if (error) { toast('Erro ao carregar diretorias: ' + error.message, 'error'); return; }

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Diretorias · ${(diretorias || []).length}</div>
        <button class="btn btn-primary btn-sm" onclick="abrirFormDiretoria()">+ Nova diretoria</button>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Diretoria</th><th>Diretor · 2ª alçada</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${(diretorias || []).map(d => `
            <tr onclick="abrirFormDiretoria('${d.id}')">
              <td><strong>${d.nome}</strong></td>
              <td>${d.diretor?.nome || '<span class="text-muted">— sem diretor —</span>'}</td>
              <td>${d.ativa ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-danger">Inativa</span>'}</td>
              <td class="text-right"><a href="#" onclick="event.stopPropagation();alternarAtivaDiretoria('${d.id}',${d.ativa});return false;" style="color:var(--accent);font-size:12px">${d.ativa ? 'Desativar' : 'Ativar'}</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

export async function abrirFormDiretoria(id) {
  const [{ data: usuarios }, existente] = await Promise.all([
    sb.from('usuarios').select('id,nome').eq('ativo', true).order('nome'),
    id ? sb.from('diretorias').select('*').eq('id', id).single().then(r => r.data) : Promise.resolve(null)
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-diretoria';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h2>${id ? 'Editar diretoria' : 'Nova diretoria'}</h2>
        <button class="close-btn" onclick="document.getElementById('modal-diretoria').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field"><label>Nome *</label><input type="text" id="diretoria-nome" value="${existente?.nome || ''}" placeholder="ex.: Industrial"></div>
        <div class="field"><label>Diretor · 2ª alçada</label>
          <select id="diretoria-diretor">
            <option value="">— sem diretor —</option>
            ${(usuarios || []).map(u => `<option value="${u.id}" ${existente?.diretor_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Ordem</label><input type="number" id="diretoria-ordem" value="${existente?.ordem ?? 0}"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-diretoria').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarDiretoria(${id ? `'${id}'` : 'null'})">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

export async function salvarDiretoria(id) {
  const nome = document.getElementById('diretoria-nome').value.trim();
  if (!nome) { toast('Nome é obrigatório', 'error'); return; }
  const payload = {
    nome,
    diretor_id: document.getElementById('diretoria-diretor').value || null,
    ordem: parseInt(document.getElementById('diretoria-ordem').value, 10) || 0
  };
  const { error } = id
    ? await sb.from('diretorias').update(payload).eq('id', id)
    : await sb.from('diretorias').insert(payload);
  if (error) { toast('Erro ao salvar diretoria: ' + error.message, 'error'); return; }
  document.getElementById('modal-diretoria')?.remove();
  toast('Diretoria salva');
  montarAbaDiretorias();
}

export async function alternarAtivaDiretoria(id, ativaAtual) {
  const { error } = await sb.from('diretorias').update({ ativa: !ativaAtual }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(ativaAtual ? 'Diretoria desativada' : 'Diretoria ativada');
  montarAbaDiretorias();
}

// ═══════════════════════════════════════════════════
// ABA · VÍNCULO SETOR → ÁREA (POR UNIDADE — Etapa 3d)
// O mesmo setor pode cair em áreas diferentes conforme a unidade (ex.:
// Expedição = Beneficiamento na Fillercal, Administrativo nas calcárias).
// O vínculo mora em empresa_setores.area_id, não mais em setores.area_id.
// ═══════════════════════════════════════════════════
let empresaVinculoSelecionada = null;

async function montarAbaVinculo() {
  const conteudo = document.getElementById('areas-conteudo');
  const { data: empresas, error } = await sb.from('empresas').select('id,nome').eq('ativo', true).order('nome');
  if (error) { toast('Erro ao carregar empresas: ' + error.message, 'error'); return; }

  if (empresaVinculoSelecionada && !(empresas || []).some(e => e.id === empresaVinculoSelecionada)) {
    empresaVinculoSelecionada = null;
  }

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Vínculo Setor → Área</div>
        <select id="vinculo-empresa" style="max-width:280px" onchange="selecionarEmpresaVinculo(this.value)">
          <option value="">— escolha a unidade —</option>
          ${(empresas || []).map(e => `<option value="${e.id}" ${empresaVinculoSelecionada === e.id ? 'selected' : ''}>${e.nome}</option>`).join('')}
        </select>
      </div>
      <div id="vinculo-setores-da-unidade">
        ${empresaVinculoSelecionada ? '<div class="loading"><div class="spinner"></div> Carregando...</div>' : '<div class="empty-state"><div class="empty-title">Escolha uma unidade acima</div></div>'}
      </div>
    </div>`;

  if (empresaVinculoSelecionada) await carregarSetoresDaUnidadeVinculo(empresaVinculoSelecionada);
}

export async function selecionarEmpresaVinculo(empresaId) {
  empresaVinculoSelecionada = empresaId || null;
  montarAbaVinculo();
}

async function carregarSetoresDaUnidadeVinculo(empresaId) {
  const alvo = document.getElementById('vinculo-setores-da-unidade');
  const [{ data: vinculos, error }, { data: areas }] = await Promise.all([
    sb.from('empresa_setores').select('setor_id,area_id,setores!inner(nome,ativo)').eq('empresa_id', empresaId).eq('setores.ativo', true),
    sb.from('areas').select('id,nome').eq('ativa', true).order('ordem')
  ]);
  if (error) { toast('Erro ao carregar setores da unidade: ' + error.message, 'error'); return; }

  const ordenados = [...(vinculos || [])].sort((a, b) => (a.area_id ? 1 : 0) - (b.area_id ? 1 : 0) || a.setores.nome.localeCompare(b.setores.nome));
  const semArea = ordenados.filter(v => !v.area_id).length;

  if (!alvo) return;
  alvo.innerHTML = `
    <div style="padding:12px 16px 0">
      ${semArea > 0 ? `<span class="badge badge-pendente">${semArea} setor(es) sem área nesta unidade</span>` : '<span class="badge badge-success">Todos os setores desta unidade vinculados</span>'}
    </div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Setor</th><th style="width:280px">Área</th></tr></thead>
      <tbody>
        ${ordenados.length === 0 ? `<tr><td colspan="2"><div class="empty-state"><div class="empty-desc">Esta unidade ainda não tem setores. Cadastre em "Unidades e Setores".</div></div></td></tr>` : ordenados.map(v => `
          <tr style="${!v.area_id ? 'background:var(--orange-dim)' : ''}">
            <td>${v.setores.nome}</td>
            <td>
              <select onchange="mudarAreaDoSetorNaUnidade('${empresaId}','${v.setor_id}', this.value)">
                <option value="">— sem área —</option>
                ${(areas || []).map(a => `<option value="${a.id}" ${v.area_id === a.id ? 'selected' : ''}>${a.nome}</option>`).join('')}
              </select>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

export async function mudarAreaDoSetorNaUnidade(empresaId, setorId, areaId) {
  const { error } = await sb.from('empresa_setores').update({ area_id: areaId || null }).eq('empresa_id', empresaId).eq('setor_id', setorId);
  if (error) { toast('Erro ao vincular setor: ' + error.message, 'error'); return; }
  toast('Setor vinculado');
  carregarSetoresDaUnidadeVinculo(empresaId);
}

// ═══════════════════════════════════════════════════
// ABA · CONFERÊNCIA (alcada_por_setor — cadeia resolvida, ponta a ponta)
// ═══════════════════════════════════════════════════
function motivoIncompleto(r) {
  if (!r.area_id) return 'sem área';
  if (!r.diretoria_id) return 'área sem diretoria';
  if (!r.responsavel_id) return 'sem responsável';
  if (!r.diretor_id) return 'sem diretor';
  return '';
}

async function montarAbaConferencia() {
  const conteudo = document.getElementById('areas-conteudo');
  const { data: linhas, error } = await sb.from('alcada_por_setor').select('*').order('empresa_nome').order('setor_nome');
  if (error) { toast('Erro ao carregar conferência: ' + error.message, 'error'); return; }

  const ordenadas = [...(linhas || [])].sort((a, b) => (b.configuracao_incompleta ? 1 : 0) - (a.configuracao_incompleta ? 1 : 0));
  const incompletos = ordenadas.filter(r => r.configuracao_incompleta).length;

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Conferência · cadeia de alçada por unidade e setor</div>
        ${incompletos > 0 ? `<span class="badge badge-pendente">${incompletos} incompleto(s)</span>` : '<span class="badge badge-success">Tudo configurado</span>'}
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Empresa</th><th>Setor</th><th>Área</th><th>Responsável · 1ª alçada</th><th>Diretoria</th><th>Diretor · 2ª alçada</th><th>Status</th></tr></thead>
        <tbody>
          ${ordenadas.map(r => `
            <tr style="${r.configuracao_incompleta ? 'background:var(--orange-dim)' : ''}">
              <td>${r.empresa_nome || '<span class="text-muted">—</span>'}</td>
              <td>${r.setor_nome}</td>
              <td>${r.area_nome || '<span class="text-muted">—</span>'}</td>
              <td>${r.responsavel_nome || '<span class="text-muted">—</span>'}</td>
              <td>${r.diretoria_nome || '<span class="text-muted">—</span>'}</td>
              <td>${r.diretor_nome || '<span class="text-muted">—</span>'}</td>
              <td>${r.configuracao_incompleta ? `<span class="badge badge-pendente">Incompleto · ${motivoIncompleto(r)}</span>` : '<span class="badge badge-success">Completo</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  renderAreasDiretorias, abrirFormArea, salvarArea, alternarAtivaArea,
  abrirFormDiretoria, salvarDiretoria, alternarAtivaDiretoria,
  selecionarEmpresaVinculo, mudarAreaDoSetorNaUnidade
});
