import { sb, SUPABASE_URL } from '../../shared/supabase.js';
import { PERFIL_LABELS, badgePerfil, fmtDate, toast } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { updateBadges } from './nav.js';

// ═══════════════════════════════════════════════════
// USUÁRIOS
// ═══════════════════════════════════════════════════
export async function renderUsuarios() {
  document.getElementById('topbar-title').textContent = 'Usuários';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const { data: usuarios } = await sb.from('usuarios').select('*').order('criado_em', {ascending:false});

  page.innerHTML = `
    <div class="table-card">
      <div class="table-header"><div class="table-title">Usuários do Sistema</div></div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Desde</th><th>Ação</th></tr></thead>
        <tbody>
          ${(usuarios||[]).map(u => `
            <tr>
              <td><strong>${u.nome}</strong></td>
              <td><span class="text-muted text-sm">${u.email}</span></td>
              <td>${badgePerfil(u.perfil)}</td>
              <td>${u.ativo === false ? '<span class="badge badge-danger">Bloqueado</span>' : '<span class="badge badge-success">Ativo</span>'}</td>
              <td><span class="text-muted text-sm">${fmtDate(u.criado_em)}</span></td>
              <td>${u.id !== currentUser.id ? `
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  <select class="filter-select" onchange="alterarPerfil('${u.id}',this.value)">
                    ${['pendente','solicitante','engenheiro','gestor','gestor_master'].map(p => `<option value="${p}" ${u.perfil===p?'selected':''}>${PERFIL_LABELS[p]}</option>`).join('')}
                  </select>
                  <button class="btn btn-sm ${u.ativo === false ? 'btn-success' : 'btn-warning'}" onclick="bloquearUsuario('${u.id}','${u.nome.replace(/'/g,"\\'")}', ${u.ativo === false ? 'false' : 'true'})">
                    ${u.ativo === false ? 'Desbloquear' : 'Bloquear'}
                  </button>
                  <button class="btn btn-sm btn-danger" onclick="apagarUsuario('${u.id}','${u.nome.replace(/'/g,"\\'")}')">Apagar</button>
                </div>` : '<span class="text-muted text-xs">Você</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

export async function alterarPerfil(userId, novoPerfil) {
  const { error } = await sb.from('usuarios').update({perfil:novoPerfil}).eq('id',userId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('Perfil atualizado');
  updateBadges();
}

// ─── Bloquear / Desbloquear (Caminho B: bloqueio real no Auth via Edge Function) ───
export async function bloquearUsuario(userId, nome, bloquear) {
  const acao = bloquear ? 'bloquear' : 'desbloquear';
  if (!confirm(`Confirma ${acao} o acesso de "${nome}"? ${bloquear ? 'A pessoa não conseguirá mais fazer login até ser desbloqueada.' : 'A pessoa voltará a conseguir fazer login.'}`)) return;

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
    toast(bloquear ? 'Usuário bloqueado' : 'Usuário desbloqueado');
    renderUsuarios();
  } catch (e) {
    toast('Erro de conexão: ' + e.message, 'error');
  }
}

// ─── Apagar (via Edge Function: verifica histórico no servidor e apaga Auth + perfil) ───
export async function apagarUsuario(userId, nome) {
  toast('Verificando histórico...', 'success');

  const [chamados, diario, comentarios, historico] = await Promise.all([
    sb.from('chamados').select('id', {count:'exact',head:true}).or(`solicitante_id.eq.${userId},engenheiro_id.eq.${userId}`),
    sb.from('diario_bordo').select('id', {count:'exact',head:true}).eq('engenheiro_id', userId),
    sb.from('comentarios_chamado').select('id', {count:'exact',head:true}).eq('usuario_id', userId),
    sb.from('historico_status').select('id', {count:'exact',head:true}).eq('usuario_id', userId)
  ]);

  const totalHistorico = (chamados.count||0) + (diario.count||0) + (comentarios.count||0) + (historico.count||0);

  if (totalHistorico > 0) {
    alert(`"${nome}" não pode ser apagado: existem ${totalHistorico} registro(s) vinculados (chamados, lançamentos de horas, comentários ou histórico de status).\n\nUse o botão "Bloquear" em vez de apagar — isso impede o acesso sem perder o histórico.`);
    return;
  }

  if (!confirm(`"${nome}" não tem histórico vinculado. Confirma apagar este usuário do sistema? Isso remove o acesso e o login dele por completo. Esta ação não pode ser desfeita.`)) return;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Sessão expirada, faça login novamente', 'error'); return; }

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/apagar-usuario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ target_id: userId })
    });
    const result = await resp.json();
    if (!resp.ok) { toast('Erro: ' + (result.error || 'falha ao apagar'), 'error'); return; }
    toast('Usuário apagado');
    renderUsuarios();
  } catch (e) {
    toast('Erro de conexão: ' + e.message, 'error');
  }
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { alterarPerfil, bloquearUsuario, apagarUsuario });
