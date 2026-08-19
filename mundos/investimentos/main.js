// Mundo Investimentos — placeholder. As telas reais (solicitação, aprovação,
// composição, reserva, aumento, encerramento do PAI) chegam nas Etapas 3+.
// Existe aqui só para o seletor/alternador de mundos ter um destino real e
// não quebrar para quem já tem atribuição em `investimentos`.
export function montarMundoInvestimentos() {
  document.getElementById('sidebar-nav').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">Investimentos</div>
    </div>`;
  document.getElementById('topbar-title').textContent = 'Investimentos';
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('user-role-display').textContent = '';

  document.getElementById('page-content').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🚧</div>
      <div class="empty-title">Mundo Investimentos em construção</div>
      <div class="empty-desc">As telas de solicitação, aprovação e encerramento do PAI chegam nas próximas etapas.</div>
    </div>`;
}
