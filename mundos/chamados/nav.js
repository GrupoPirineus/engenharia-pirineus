import { sb } from '../../shared/supabase.js';
import { setPage, PERFIL_LABELS, closeSidebar } from '../../shared/ui.js';
import { isGestor, isMaster, isEngenheiro } from './auth.js';
import { renderDashboard } from './dashboard.js';
import { renderChamados, renderMeusChamados, renderMinhaFila } from './chamados.js';
// Import só por efeito colateral: chamado-detalhe.js nunca era importado por
// nenhum módulo, então seu Object.assign(window,...) nunca rodava — Imprimir,
// Lançar Horas etc. lançavam "function is not defined" ao clicar. Corrigido
// aqui (bug pré-existente, achado ao ligar o botão Compartilhar novo).
import './chamado-detalhe.js';

export let currentPage = null;

// ═══════════════════════════════════════════════════
// APP SETUP
// ═══════════════════════════════════════════════════
export function setupApp(userData) {
  setPage('app-screen');
  document.getElementById('user-role-display').textContent = PERFIL_LABELS[userData.perfil] || userData.perfil;
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

  // Etapa 18: "Gestão → Usuários" e "Sistema → Configurações" (empresas,
  // setores, tipos de serviço) saíram daqui — gestão de usuários e de
  // cadastros globais agora é só em Administração (admin/usuarios.js e
  // admin/unidades.js). usuarios.perfil continua no banco (RLS/get_perfil
  // ainda dependem dela), só as telas legadas do mundo Chamados saíram.

  nav.innerHTML = html;
  updateBadges();
}

export async function updateBadges() {
  if (isGestor()) {
    const { count: ap } = await sb.from('chamados').select('*', {count:'exact',head:true}).eq('status','aprovacao');
    const badgeAp = document.getElementById('badge-aprovacao');
    if (badgeAp) { badgeAp.textContent = ap||0; ap>0 ? badgeAp.classList.remove('hidden') : badgeAp.classList.add('hidden'); }
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
    // 'usuarios' e 'configuracoes' (telas removidas na Etapa 18): uma sessão
    // que tinha uma dessas salva em sessionStorage cai aqui — manda pro
    // dashboard em vez de deixar a tela em branco.
    default: renderDashboard();
  }
}

// toggleSidebar/closeSidebar agora vivem em shared/ui.js (são da casca, não
// específicos de Chamados) — navigateTo continua daqui por chamar renderChamados
// etc., que são deste mundo.

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { navigateTo });
