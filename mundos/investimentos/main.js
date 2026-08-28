// Mundo Investimentos — casca do mundo (nav + dashboard). Cobre a
// Solicitação (inv_solicitante) e o motor de aprovação (Etapa 4):
// controladoria_op, inv_aprovador (superintendente) e diretor.
import { temPapel } from '../../shared/acesso.js';
import { renderMeusPais } from './dashboard.js';
import { renderFilaControladoria, renderFilaAprovador, renderFilaDiretor } from './aprovacao.js';

export async function montarMundoInvestimentos(usuario) {
  document.getElementById('topbar-title').textContent = 'Investimentos';
  document.getElementById('topbar-actions').innerHTML = '';

  const [souSolicitante, souControladoria, souAprovador, souDiretor] = await Promise.all([
    temPapel('investimentos', 'inv_solicitante'),
    temPapel('investimentos', 'controladoria_op'),
    temPapel('investimentos', 'inv_aprovador'),
    temPapel('investimentos', 'diretor')
  ]);

  const papeis = [];
  if (souSolicitante) papeis.push('Solicitante');
  if (souControladoria) papeis.push('Controladoria Operacional');
  if (souAprovador) papeis.push('Superintendente');
  if (souDiretor) papeis.push('Diretor');

  document.getElementById('sidebar-nav').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">Investimentos</div>
      ${souSolicitante ? `
      <button class="nav-item" onclick="abrirMeusPais()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Meus PAIs
      </button>` : ''}
      ${souControladoria ? `
      <button class="nav-item" onclick="renderFilaControladoria()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Fila · Controladoria
      </button>` : ''}
      ${souAprovador ? `
      <button class="nav-item" onclick="renderFilaAprovador()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Fila · Superintendente
      </button>` : ''}
      ${souDiretor ? `
      <button class="nav-item" onclick="renderFilaDiretor()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Fila · Diretor
      </button>` : ''}
    </div>`;
  document.getElementById('user-role-display').textContent = papeis.join(' · ');

  // Primeira tela: prioriza a fila de aprovação sobre o dashboard do
  // solicitante quando a pessoa acumula os dois papéis — é o trabalho
  // pendente mais provável de precisar de atenção.
  if (souControladoria) renderFilaControladoria();
  else if (souAprovador) renderFilaAprovador();
  else if (souDiretor) renderFilaDiretor();
  else if (souSolicitante) renderMeusPais();
  else {
    document.getElementById('page-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚧</div>
        <div class="empty-title">Nenhuma tela disponível para o seu papel ainda</div>
        <div class="empty-desc">Fale com o administrador se você deveria ter acesso a alguma tela deste mundo.</div>
      </div>`;
  }
}

export function abrirMeusPais() {
  renderMeusPais();
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { abrirMeusPais });
