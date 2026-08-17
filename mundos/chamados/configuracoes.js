import { sb } from '../../shared/supabase.js';
import { toast } from '../../shared/ui.js';

// ═══════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════
export async function renderConfiguracoes() {
  document.getElementById('topbar-title').textContent = 'Configurações';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const [{ data: tipos }, { data: empresas }, { data: setores }] = await Promise.all([
    sb.from('tipos_servico').select('*').order('nome'),
    sb.from('empresas').select('*').order('nome'),
    sb.from('setores').select('*').order('nome')
  ]);

  page.innerHTML = `
    <div style="display:grid;gap:20px;max-width:900px">

      <div class="table-card">
        <div class="table-header">
          <div class="table-title">Tipos de Serviço</div>
          <button class="btn btn-primary btn-sm" onclick="addItem('tipos_servico','tipo de serviço')">+ Adicionar</button>
        </div>
        <table>
          <thead><tr><th>Nome</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(tipos||[]).map(t => `
              <tr>
                <td>${t.nome}</td>
                <td><span class="badge ${t.ativo ? 'badge-concluido' : 'badge-rejeitado'}">${t.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td class="text-right"><button class="btn btn-ghost btn-sm" onclick="toggleItem('tipos_servico','${t.id}',${!t.ativo})">${t.ativo ? 'Desativar' : 'Ativar'}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="table-card">
        <div class="table-header">
          <div class="table-title">Empresas</div>
          <button class="btn btn-primary btn-sm" onclick="addItem('empresas','empresa')">+ Adicionar</button>
        </div>
        <table>
          <thead><tr><th>Nome</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(empresas||[]).map(e => `
              <tr>
                <td>${e.nome}</td>
                <td><span class="badge ${e.ativo ? 'badge-concluido' : 'badge-rejeitado'}">${e.ativo ? 'Ativa' : 'Inativa'}</span></td>
                <td class="text-right"><button class="btn btn-ghost btn-sm" onclick="toggleItem('empresas','${e.id}',${!e.ativo})">${e.ativo ? 'Desativar' : 'Ativar'}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="table-card">
        <div class="table-header">
          <div class="table-title">Setores</div>
          <button class="btn btn-primary btn-sm" onclick="addSetor()">+ Adicionar</button>
        </div>
        <table>
          <thead><tr><th>Nome</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(setores||[]).map(s => `
              <tr>
                <td>${s.nome}</td>
                <td><span class="badge ${s.ativo ? 'badge-concluido' : 'badge-rejeitado'}">${s.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td class="text-right"><button class="btn btn-ghost btn-sm" onclick="toggleItem('setores','${s.id}',${!s.ativo})">${s.ativo ? 'Desativar' : 'Ativar'}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

    </div>`;
}

export async function addItem(tabela, label) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-add-item';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h2>Novo ${label}</h2>
        <button class="close-btn" onclick="document.getElementById('modal-add-item').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Nome</label>
          <input type="text" id="add-item-nome" placeholder="Digite o nome..." autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-add-item').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarAddItem('${tabela}','${label}')">Adicionar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('add-item-nome')?.focus(), 100);
  document.getElementById('add-item-nome').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmarAddItem(tabela, label);
  });
}

export async function confirmarAddItem(tabela, label) {
  const nome = document.getElementById('add-item-nome')?.value?.trim();
  if (!nome) { toast('Digite um nome', 'error'); return; }
  const { error } = await sb.from(tabela).insert({nome});
  document.getElementById('modal-add-item')?.remove();
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(`${label} adicionado`);
  renderConfiguracoes();
}

export async function addSetor() {
  const { data: empresas } = await sb.from('empresas').select('id,nome').eq('ativo',true).order('nome');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-add-setor';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h2>Novo Setor</h2>
        <button class="close-btn" onclick="document.getElementById('modal-add-setor').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Nome do Setor</label>
          <input type="text" id="setor-nome" placeholder="Digite o nome do setor...">
        </div>
        <div class="field">
          <label>Empresas que terão este setor</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:var(--text)">
              <input type="checkbox" id="setor-todas" onchange="toggleTodasEmpresas(this)" style="width:auto"> Todas as empresas
            </label>
            <div id="setor-empresas-list" style="display:flex;flex-direction:column;gap:6px;padding-left:8px;border-left:2px solid var(--border)">
              ${(empresas||[]).map(e => `
                <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:var(--text)">
                  <input type="checkbox" class="emp-check" value="${e.id}" style="width:auto"> ${e.nome}
                </label>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-add-setor').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarAddSetor()">Adicionar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('setor-nome')?.focus(), 100);
}

export function toggleTodasEmpresas(cb) {
  document.querySelectorAll('.emp-check').forEach(c => c.checked = cb.checked);
}

export async function confirmarAddSetor() {
  const nome = document.getElementById('setor-nome')?.value?.trim();
  if (!nome) { toast('Digite o nome do setor', 'error'); return; }

  const { data: setor, error } = await sb.from('setores').insert({nome}).select().single();
  if (error) { toast('Erro: ' + error.message, 'error'); return; }

  const checkedEmps = [...document.querySelectorAll('.emp-check:checked')].map(c => c.value);
  for (const empId of checkedEmps) {
    await sb.from('empresa_setores').insert({empresa_id:empId, setor_id:setor.id}).catch(()=>{});
  }

  document.getElementById('modal-add-setor')?.remove();
  toast('Setor adicionado');
  renderConfiguracoes();
}

export async function toggleItem(tabela, id, ativo) {
  await sb.from(tabela).update({ativo}).eq('id',id);
  toast(ativo ? 'Ativado' : 'Desativado');
  renderConfiguracoes();
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  addItem, confirmarAddItem, addSetor, toggleTodasEmpresas, confirmarAddSetor, toggleItem
});
