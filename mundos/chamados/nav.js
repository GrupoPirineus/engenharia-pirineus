import { sb } from '../../shared/supabase.js';
import { setPage, PERFIL_LABELS } from '../../shared/ui.js';
import { isGestor, isMaster, isEngenheiro } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderChamados, renderMeusChamados, renderMinhaFila } from './chamados.js';
import { renderUsuarios } from './usuarios.js';
import { renderConfiguracoes } from './configuracoes.js';

export let currentPage = null;

// ═══════════════════════════════════════════════════
// APP SETUP
// ═══════════════════════════════════════════════════
export function setupApp(userData) {
  setPage('app-screen');
  document.getElementById('user-name-display').textContent = userData.nome;
  document.getElementById('user-role-display').textContent = PERFIL_LABELS[userData.perfil] || userData.perfil;
  document.getElementById('user-avatar').textContent = userData.nome.charAt(0).toUpperCase();
  buildNav();
  // Recuperar última página visitada
  const savedPage = sessionStorage.getItem('currentPage');
  navigateTo(savedPage || 'dashboard');
}

export function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  let html = '';

  // Dashboard — todos os perfis
  html += `
    <div class="nav-section">
      <div class="nav-label">Principal</div>
      <button class="nav-item" onclick="navigateTo('dashboard')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        Dashboard
      </button>`;

  // Gestores veem todos os chamados
  if (isGestor()) {
    html += `
      <button class="nav-item" onclick="navigateTo('chamados')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Chamados
        <span class="nav-badge hidden" id="badge-aprovacao">0</span>
      </button>`;
  }

  // Engenheiro vê a fila dele
  if (isEngenheiro()) {
    html += `
      <button class="nav-item" onclick="navigateTo('minha-fila')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Minha Fila
      </button>`;
  }

  // Meus Chamados — todos exceto Master (todos podem criar e acompanhar os próprios)
  if (!isMaster()) {
    html += `
      <button class="nav-item" onclick="navigateTo('meus-chamados')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Meus Chamados
      </button>`;
  }
  html += `</div>`;

  // Gestão — usuários (só gestores)
  if (isGestor()) {
    html += `
    <div class="nav-section">
      <div class="nav-label">Gestão</div>
      <button class="nav-item" onclick="navigateTo('usuarios')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
        Usuários
        <span class="nav-badge hidden" id="badge-pendentes">0</span>
      </button>
    </div>`;
  }

  // Sistema — configurações (só master)
  if (isMaster()) {
    html += `
    <div class="nav-section">
      <div class="nav-label">Sistema</div>
      <button class="nav-item" onclick="navigateTo('configuracoes')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M20 12h2M2 12h2M17.66 17.66l-1.41-1.41M6.34 17.66l1.41-1.41"/></svg>
        Configurações
      </button>
    </div>`;
  }

  nav.innerHTML = html;
  updateBadges();
}

export async function updateBadges() {
  if (isGestor()) {
    const { count: ap } = await sb.from('chamados').select('*', {count:'exact',head:true}).eq('status','aprovacao');
    const { count: pe } = await sb.from('usuarios').select('*', {count:'exact',head:true}).eq('perfil','pendente');
    const badgeAp = document.getElementById('badge-aprovacao');
    const badgePe = document.getElementById('badge-pendentes');
    if (badgeAp) { badgeAp.textContent = ap||0; ap>0 ? badgeAp.classList.remove('hidden') : badgeAp.classList.add('hidden'); }
    if (badgePe) { badgePe.textContent = pe||0; pe>0 ? badgePe.classList.remove('hidden') : badgePe.classList.add('hidden'); }
  }
}

export function navigateTo(page) {
  currentPage = page;
  sessionStorage.setItem('currentPage', page);
  closeSidebar();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('onclick')?.includes(page)) el.classList.add('active');
  });
  document.getElementById('topbar-actions').innerHTML = '';
  switch(page) {
    case 'dashboard': renderDashboard(); break;
    case 'chamados': renderChamados(); break;
    case 'meus-chamados': renderMeusChamados(); break;
    case 'minha-fila': renderMinhaFila(); break;
    case 'usuarios': renderUsuarios(); break;
    case 'configuracoes': renderConfiguracoes(); break;
  }
}

export function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('show');
}
export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { navigateTo, toggleSidebar, closeSidebar });
