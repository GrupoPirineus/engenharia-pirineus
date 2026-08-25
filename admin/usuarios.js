import { sb, SUPABASE_URL } from '../shared/supabase.js';
import { toast, fmtDate } from '../shared/ui.js';
import { carregarAtribuicoes } from '../shared/acesso.js';
import { renderAreasDiretorias } from './areas.js';
import { renderUnidadesSetores } from './unidades.js';

// ═══════════════════════════════════════════════════
// ADMINISTRAÇÃO — usuários e atribuições (só isMaster())
// Grava em `atribuicoes`; a RLS já garante que só o master escreve.
// ═══════════════════════════════════════════════════

const MUNDO_LABELS = { chamados: 'Chamados', investimentos: 'Investimentos' };
const PAPEL_LABELS = {
  solicitante: 'Solicitante', engenheiro: 'Engenheiro', gestor: 'Gestor',
  inv_solicitante: 'Solicitante', inv_aprovador: 'Aprovador',
  controladoria_op: 'Controladoria Operacional', controladoria_contabil: 'Controladoria Contábil',
  diretor: 'Diretor'
};
// 'master' fica de fora de propósito — não é atribuível por aqui (ver
// Arquitetura do Portal - Dois Mundos.dc.html: "o master não recebe papel de
// mundo nenhum, só administra"). Promoção a master é ação direta no banco.
const PAPEIS_POR_MUNDO = {
  chamados: ['solicitante', 'engenheiro', 'gestor'],
  investimentos: ['inv_solicitante', 'inv_aprovador', 'controladoria_op', 'controladoria_contabil', 'diretor']
};

let filtroAtual = 'todos'; // 'todos' | 'pendentes'
let secaoAdmin = 'usuarios'; // 'usuarios' | 'areas' | 'unidades'

export function montarAdmin() {
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('user-role-display').textContent = 'Administrador';
  filtroAtual = 'todos';
  secaoAdmin = 'usuarios';
  construirNavAdmin();
  renderListaUsuarios();
}

function construirNavAdmin() {
  document.getElementById('sidebar-nav').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">Administração</div>
      <button class="nav-item ${secaoAdmin === 'usuarios' ? 'active' : ''}" onclick="navegarAdmin('usuarios')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
        Usuários
      </button>
      <button class="nav-item ${secaoAdmin === 'areas' ? 'active' : ''}" onclick="navegarAdmin('areas')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>
        Áreas e Diretorias
      </button>
      <button class="nav-item ${secaoAdmin === 'unidades' ? 'active' : ''}" onclick="navegarAdmin('unidades')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        Unidades e Setores
      </button>
    </div>`;
}

export function navegarAdmin(secao) {
  secaoAdmin = secao;
  construirNavAdmin();
  if (secao === 'usuarios') renderListaUsuarios();
  else if (secao === 'areas') renderAreasDiretorias();
  else renderUnidadesSetores();
}

export async function renderListaUsuarios(filtro) {
  if (filtro) filtroAtual = filtro;
  document.getElementById('topbar-title').textContent = 'Administração · Usuários';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const { data: usuarios, error } = await sb.from('usuarios').select('*').order('nome');
  if (error) { toast('Erro ao carregar usuários: ' + error.message, 'error'); return; }

  const { data: todasAtribuicoes } = await sb.from('atribuicoes').select('usuario_id, mundo, papel');
  const porUsuario = {};
  (todasAtribuicoes || []).forEach(a => { (porUsuario[a.usuario_id] ||= []).push(a); });

  const linhas = (usuarios || []).map(u => ({ ...u, atribuicoes: porUsuario[u.id] || [] }));
  const pendentes = linhas.filter(u => u.atribuicoes.length === 0);
  const listaExibida = filtroAtual === 'pendentes' ? pendentes : linhas;

  page.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Usuários · ${linhas.length}</div>
        <div class="filters">
          <button class="btn btn-sm ${filtroAtual === 'todos' ? 'btn-primary' : 'btn-secondary'}" onclick="renderListaUsuarios('todos')">Todos</button>
          <button class="btn btn-sm ${filtroAtual === 'pendentes' ? 'btn-primary' : 'btn-secondary'}" onclick="renderListaUsuarios('pendentes')">Pendentes (${pendentes.length})</button>
        </div>
      </div>
      ${listaExibida.length === 0 ? `<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-title">Nenhum usuário aqui</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Mundos · papéis</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${listaExibida.map(u => `
            <tr onclick="abrirFichaUsuario('${u.id}')">
              <td><strong>${u.nome}</strong></td>
              <td><span class="text-muted text-sm">${u.email}</span></td>
              <td>${u.atribuicoes.length === 0
                ? '<span class="text-muted text-xs">sem atribuição</span>'
                : u.atribuicoes.map(a => `<span class="badge ${a.mundo === 'chamados' ? 'badge-execucao' : 'badge-atribuicao'}">${MUNDO_LABELS[a.mundo] || a.mundo} · ${a.papel === 'master' ? 'Master' : (PAPEL_LABELS[a.papel] || a.papel)}</span>`).join(' ')}</td>
              <td>${u.ativo === false ? '<span class="badge badge-danger">Bloqueado</span>' : (u.atribuicoes.length === 0 ? '<span class="badge badge-pendente">Pendente</span>' : '<span class="badge badge-success">Ativo</span>')}</td>
              <td class="text-right"><span class="text-muted text-xs">Ver ficha ›</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

function renderTabelaAtribuicoes(atribuicoes) {
  if (!atribuicoes.length) {
    return '<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:24px">🔒</div><div class="empty-desc">Sem atribuições — este usuário está pendente, sem acesso a nenhum mundo.</div></div>';
  }
  return `
    <table>
      <thead><tr><th>Mundo</th><th>Papel</th><th>Empresa</th><th>Setor</th><th></th></tr></thead>
      <tbody>
        ${atribuicoes.map(a => `
          <tr>
            <td><span class="badge ${a.mundo === 'chamados' ? 'badge-execucao' : 'badge-atribuicao'}">${MUNDO_LABELS[a.mundo] || a.mundo}</span></td>
            <td>${a.papel === 'master' ? 'Master' : (PAPEL_LABELS[a.papel] || a.papel)}</td>
            <td>${a.empresas?.nome || '<span class="text-muted">Todas</span>'}</td>
            <td>${a.setores?.nome || '<span class="text-muted">Todos</span>'}</td>
            <td class="text-right"><a href="#" onclick="removerAtribuicao('${a.id}','${a.usuario_id}');return false;" style="color:var(--red);font-size:14px;font-weight:bold;text-decoration:none" title="Remover atribuição">✕</a></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

export async function abrirFichaUsuario(usuarioId) {
  const { data: usuario, error } = await sb.from('usuarios').select('*').eq('id', usuarioId).single();
  if (error || !usuario) { toast('Usuário não encontrado', 'error'); return; }

  const [atribuicoes, empresasRes, setoresRes] = await Promise.all([
    carregarAtribuicoes(usuarioId),
    sb.from('empresas').select('id,nome').eq('ativo', true).order('nome'),
    sb.from('setores').select('id,nome').order('nome')
  ]);
  const empresas = empresasRes.data || [];
  const setores = setoresRes.data || [];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-ficha-usuario';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header">
        <div>
          <h2>${usuario.nome}</h2>
          <div class="text-xs text-muted" style="margin-top:4px">${usuario.email}</div>
        </div>
        <button class="close-btn" onclick="document.getElementById('modal-ficha-usuario').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="info-row" style="margin-bottom:20px">
          <div class="info-item"><span class="info-label">Status</span><span class="info-val">${usuario.ativo === false ? '<span class="badge badge-danger">Bloqueado</span>' : '<span class="badge badge-success">Ativo</span>'}</span></div>
          <div class="info-item"><span class="info-label">Cadastro</span><span class="info-val">${fmtDate(usuario.criado_em)}</span></div>
        </div>

        <div class="form-section-title">Atribuições · cada linha é um acesso</div>
        <div id="ficha-atribuicoes-lista" style="margin-top:10px">
          ${renderTabelaAtribuicoes(atribuicoes)}
        </div>

        <div class="form-section" style="border:1.5px dashed var(--border);border-radius:var(--radius);padding:14px;margin-top:16px">
          <div class="form-section-title" style="margin-bottom:10px">+ Nova atribuição</div>
          <div class="form-row">
            <div class="field">
              <label>Mundo</label>
              <select id="nova-atrib-mundo" onchange="atualizarPapeisDoMundo()">
                <option value="chamados">Chamados</option>
                <option value="investimentos">Investimentos</option>
              </select>
            </div>
            <div class="field">
              <label>Papel</label>
              <select id="nova-atrib-papel"></select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Empresa</label>
              <select id="nova-atrib-empresa">
                <option value="">Todas as empresas</option>
                ${empresas.map(e => `<option value="${e.id}">${e.nome}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Setor</label>
              <select id="nova-atrib-setor">
                <option value="">Todos os setores</option>
                ${setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="adicionarAtribuicao('${usuarioId}')">Adicionar</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sm ${usuario.ativo === false ? 'btn-success' : 'btn-warning'}" onclick="alternarBloqueioAdmin('${usuario.id}','${usuario.nome.replace(/'/g, "\\'")}', ${usuario.ativo === false ? 'false' : 'true'})">
          ${usuario.ativo === false ? 'Liberar acesso' : 'Bloquear'}
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('modal-ficha-usuario').remove()">Fechar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  atualizarPapeisDoMundo();
}

export function atualizarPapeisDoMundo() {
  const mundo = document.getElementById('nova-atrib-mundo').value;
  const papelSel = document.getElementById('nova-atrib-papel');
  papelSel.innerHTML = PAPEIS_POR_MUNDO[mundo].map(p => `<option value="${p}">${PAPEL_LABELS[p]}</option>`).join('');
}

export async function adicionarAtribuicao(usuarioId) {
  const mundo = document.getElementById('nova-atrib-mundo').value;
  const papel = document.getElementById('nova-atrib-papel').value;
  const empresaId = document.getElementById('nova-atrib-empresa').value || null;
  const setorId = document.getElementById('nova-atrib-setor').value || null;

  const { error } = await sb.from('atribuicoes').insert({
    usuario_id: usuarioId, mundo, papel, empresa_id: empresaId, setor_id: setorId
  });

  if (error) {
    if (error.code === '23505') {
      toast('Essa atribuição já existe para este usuário.', 'error');
    } else {
      toast('Erro ao adicionar atribuição: ' + error.message, 'error');
    }
    return;
  }

  toast('Atribuição adicionada');
  const atribuicoes = await carregarAtribuicoes(usuarioId);
  const lista = document.getElementById('ficha-atribuicoes-lista');
  if (lista) lista.innerHTML = renderTabelaAtribuicoes(atribuicoes);
  renderListaUsuarios();
}

export async function removerAtribuicao(atribuicaoId, usuarioId) {
  if (!confirm('Remover esta atribuição?')) return;
  const { error } = await sb.from('atribuicoes').delete().eq('id', atribuicaoId);
  if (error) { toast('Erro ao remover: ' + error.message, 'error'); return; }
  toast('Atribuição removida');
  const atribuicoes = await carregarAtribuicoes(usuarioId);
  const lista = document.getElementById('ficha-atribuicoes-lista');
  if (lista) lista.innerHTML = renderTabelaAtribuicoes(atribuicoes);
  renderListaUsuarios();
}

// ─── Bloquear / Liberar acesso (mesma Edge Function que o admin legado de Chamados usa) ───
export async function alternarBloqueioAdmin(userId, nome, bloquear) {
  const acao = bloquear ? 'bloquear' : 'liberar';
  if (!confirm(`Confirma ${acao} o acesso de "${nome}"? ${bloquear ? 'A pessoa não conseguirá mais fazer login até ser liberada.' : 'A pessoa voltará a conseguir fazer login.'}`)) return;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Sessão expirada, faça login novamente', 'error'); return; }

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/bloquear-usuario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ target_id: userId, bloquear })
    });
    const result = await resp.json();
    if (!resp.ok) { toast('Erro: ' + (result.error || 'falha ao processar'), 'error'); return; }
    toast(bloquear ? 'Usuário bloqueado' : 'Acesso liberado');
    document.getElementById('modal-ficha-usuario')?.remove();
    renderListaUsuarios();
  } catch (e) {
    toast('Erro de conexão: ' + e.message, 'error');
  }
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  renderListaUsuarios, abrirFichaUsuario, atualizarPapeisDoMundo,
  adicionarAtribuicao, removerAtribuicao, alternarBloqueioAdmin, navegarAdmin
});
