// ═══════════════════════════════════════════════════
// ANO-CALENDÁRIO (mundo Investimentos)
//
// Regra única: só o ano vigente e o próximo (vigente + 1) são
// selecionáveis, calculados pela data do sistema — nunca lista longa.
// O <option> mostra e grava sempre "YYYY" puro (sem sufixo); a dica de
// qual é o vigente/entressafra é texto auxiliar renderizado à parte.
// ═══════════════════════════════════════════════════

export function anoVigente() {
  return new Date().getFullYear();
}

export function anosValidosPai() {
  const atual = anoVigente();
  return [atual, atual + 1];
}

export function anoValido(ano) {
  return anosValidosPai().includes(Number(ano));
}

export function renderOpcoesAno(anoSelecionado) {
  return anosValidosPai()
    .map(a => `<option value="${a}" ${a === anoSelecionado ? 'selected' : ''}>${a}</option>`)
    .join('');
}

// Texto auxiliar exibido ao lado do seletor — nunca dentro do valor do ano.
export function dicaAno(ano) {
  const atual = anoVigente();
  if (Number(ano) === atual) return 'ano vigente';
  if (Number(ano) === atual + 1) return 'disponível (entressafra)';
  return '';
}
