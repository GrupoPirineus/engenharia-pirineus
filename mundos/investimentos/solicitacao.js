import { sb } from '../../shared/supabase.js';
import { toast } from '../../shared/ui.js';
import { carregarAtribuicoes } from '../../shared/acesso.js';
import { currentUser } from './auth.js';
import { renderMeusPais, fmtMoeda, TIPO_INVESTIMENTO_LABELS } from './dashboard.js';
import { iniciarEtapaControladoria } from './aprovacao.js';

// Bucket reaproveitado do mundo Chamados (mesmo Supabase Storage do projeto),
// com prefixo próprio para não colidir com os anexos de chamado.
const BUCKET_ANEXOS = 'anexos-chamados';
const LABELS_ANEXO = { a3: 'A3 do projeto *', viabilidade: 'Estudo de viabilidade *', orcamento: 'Orçamento (opcional)' };

let estado = null; // construído a cada abertura da tela — ver abrirNovoPai()

function anoVigente() { return new Date().getFullYear(); }
function numOrZero(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// ═══════════════════════════════════════════════════
// ESCOPO DO SOLICITANTE (empresa × área a partir das atribuições)
// ═══════════════════════════════════════════════════
async function resolverEscoposSolicitante() {
  const atribuicoes = await carregarAtribuicoes(currentUser.id);
  const relevantes = atribuicoes.filter(a => a.mundo === 'investimentos' && a.papel === 'inv_solicitante');
  const escopos = [];

  for (const a of relevantes) {
    if (!a.empresa_id) {
      // Escopo global (empresa "todas") não é um caso de uso esperado para
      // inv_solicitante — abrir um PAI exige uma empresa concreta.
      console.warn('Atribuição inv_solicitante sem empresa definida; ignorada nesta tela.', a);
      continue;
    }
    if (a.setor_id) {
      escopos.push({ empresaId: a.empresa_id, empresaNome: a.empresas?.nome || '—', setorId: a.setor_id, setorNome: a.setores?.nome || '—' });
    } else {
      // setor "todos": expande para todas as áreas da empresa.
      const { data: rel } = await sb.from('empresa_setores').select('setores(id,nome)').eq('empresa_id', a.empresa_id);
      (rel || []).forEach(r => escopos.push({ empresaId: a.empresa_id, empresaNome: a.empresas?.nome || '—', setorId: r.setores.id, setorNome: r.setores.nome }));
    }
  }

  const vistos = new Set();
  return escopos.filter(e => {
    const chave = `${e.empresaId}·${e.setorId}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// ═══════════════════════════════════════════════════
// ABERTURA DA TELA
// ═══════════════════════════════════════════════════
export async function abrirNovoPai(paiId) {
  document.getElementById('topbar-title').textContent = 'Novo PAI';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const escopos = await resolverEscoposSolicitante();
  if (!escopos.length) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-title">Sem área de investimento atribuída</div>
        <div class="empty-desc">Fale com o administrador para liberar seu acesso de solicitante numa empresa/área.</div>
      </div>`;
    return;
  }

  estado = {
    paiId: null,
    planoId: null,
    statusOriginal: null, // null (novo) | 'rascunho' | 'devolvido' — define o de_status do histórico ao enviar
    escopoIdx: 0,
    escopos,
    ano: anoVigente(),
    tipo: 'obra',
    titulo: '',
    descricao: '',
    linhas: [],
    itens: [{ aplicacao: '', valor: 0 }],
    anexos: { a3: null, viabilidade: null, orcamento: null },
    anexosExistentes: { a3: null, viabilidade: null, orcamento: null }, // já enviados num ciclo anterior (reenvio após devolução)
    vinculosIniciais: {}, // linha_id -> valor, de um ciclo anterior (reenvio após devolução)
  };

  if (paiId) {
    const { data: pai, error } = await sb.from('pais').select('*')
      .eq('id', paiId).eq('solicitante_id', currentUser.id).in('status', ['rascunho', 'devolvido']).single();
    if (!error && pai) {
      estado.paiId = pai.id;
      estado.statusOriginal = pai.status;
      estado.ano = pai.ano_calendario;
      estado.tipo = pai.tipo;
      estado.titulo = pai.titulo || '';
      estado.descricao = pai.descricao || '';
      const idx = escopos.findIndex(e => e.empresaId === pai.empresa_id && e.setorId === pai.setor_id);
      if (idx >= 0) estado.escopoIdx = idx;

      if (pai.status === 'devolvido') {
        // Reenvio: traz de volta a composição, os vínculos e os anexos do envio anterior.
        const [{ data: itens }, { data: vinculos }, { data: anexos }] = await Promise.all([
          sb.from('itens_pai').select('*').eq('pai_id', pai.id).order('ordem'),
          sb.from('vinculos_verba').select('*').eq('pai_id', pai.id),
          sb.from('anexos_pai').select('*').eq('pai_id', pai.id)
        ]);
        if (itens?.length) estado.itens = itens.map(i => ({ aplicacao: i.aplicacao, valor: i.valor }));
        (vinculos || []).forEach(v => { estado.vinculosIniciais[v.linha_id] = v.valor; });
        (anexos || []).forEach(a => { if (a.tipo in estado.anexosExistentes) estado.anexosExistentes[a.tipo] = a; });
      }
    }
  }

  await carregarLinhas();
  estado.linhas.forEach(l => { if (!l.usar && estado.vinculosIniciais[l.linhaId]) l.usar = estado.vinculosIniciais[l.linhaId]; });
  render();
}

async function carregarLinhas() {
  const esc = estado.escopos[estado.escopoIdx];
  const { data, error } = await sb.from('saldo_linhas').select('*')
    .eq('empresa_id', esc.empresaId).eq('setor_id', esc.setorId).eq('ano_calendario', estado.ano)
    .order('descricao');

  if (error) { toast('Erro ao carregar linhas do plano: ' + error.message, 'error'); estado.linhas = []; estado.planoId = null; return; }

  const usoAnterior = {};
  estado.linhas.forEach(l => { usoAnterior[l.linhaId] = l.usar; });
  estado.linhas = (data || []).map(l => ({
    linhaId: l.linha_id, descricao: l.descricao, aprovado: l.aprovado, reservado: l.reservado,
    livre: l.livre, usar: usoAnterior[l.linha_id] || 0
  }));
  // Um plano é por empresa+ano (sem escopo de área), então toda linha da
  // consulta acima compartilha o mesmo plano_id — basta pegar da primeira.
  estado.planoId = data && data.length ? data[0].plano_id : null;
}

// ═══════════════════════════════════════════════════
// CÁLCULO DERIVADO (checklist, somas, saldo)
// ═══════════════════════════════════════════════════
function calcular() {
  const totalUsar = estado.linhas.reduce((a, l) => a + numOrZero(l.usar), 0);
  const totalComposicao = estado.itens.reduce((a, i) => a + numOrZero(i.valor), 0);
  const estouraLinha = estado.linhas.some(l => numOrZero(l.usar) > l.livre + 1e-9);
  const somaAprovado = estado.linhas.reduce((a, l) => a + numOrZero(l.aprovado), 0);
  const somaReservado = estado.linhas.reduce((a, l) => a + numOrZero(l.reservado), 0);
  const somaLivre = estado.linhas.reduce((a, l) => a + numOrZero(l.livre), 0);
  const livreApos = somaLivre - totalUsar;
  const semSaldo = totalUsar > somaLivre + 1e-9;
  const somaBate = totalUsar > 0 && Math.abs(totalComposicao - totalUsar) < 0.01;
  const itensOk = estado.itens.length > 0 && estado.itens.every(i => i.aplicacao.trim() && numOrZero(i.valor) > 0);
  const temDescricao = estado.titulo.trim().length > 0 && estado.descricao.trim().length > 0;
  const temAnexos = !!((estado.anexos.a3 || estado.anexosExistentes.a3) && (estado.anexos.viabilidade || estado.anexosExistentes.viabilidade));

  const checks = [
    { ok: temDescricao, texto: 'Título e descrição preenchidos' },
    { ok: totalUsar > 0 && !estouraLinha, texto: estouraLinha ? 'Uma linha usa mais que o livre' : 'Verba vinculada dentro do livre' },
    { ok: !semSaldo, texto: semSaldo ? 'Falta saldo na área — precisa de aumento de verba' : 'Saldo da área suficiente' },
    { ok: somaBate, texto: somaBate ? 'Composição fecha com a verba vinculada' : `Soma ${fmtMoeda(totalComposicao)} ≠ verba ${fmtMoeda(totalUsar)}` },
    { ok: itensOk, texto: 'Todos os itens têm aplicação e valor' },
    { ok: temAnexos, texto: 'A3 e estudo de viabilidade anexados' },
  ];

  return {
    totalUsar, totalComposicao, estouraLinha, somaAprovado, somaReservado, somaLivre, livreApos,
    semSaldo, somaBate, itensOk, temDescricao, temAnexos, checks, bloqueado: checks.some(c => !c.ok)
  };
}

// ═══════════════════════════════════════════════════
// RENDER (montagem completa — chamado na abertura e em trocas de contexto)
// ═══════════════════════════════════════════════════
function render() {
  const esc = estado.escopos[estado.escopoIdx];
  const c = calcular();
  const anoAtual = anoVigente();

  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">
      <div>
        <button class="btn btn-secondary btn-sm" onclick="renderMeusPais()" style="margin-bottom:12px">← Meus PAIs</button>
        <div class="text-xs" style="color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Rascunho · o nº é gerado no envio</div>
        <h2 style="font-size:24px;margin:0">Novo PAI</h2>
      </div>
      <div class="text-sm text-muted">${currentUser.nome} · Solicitante · ${esc.empresaNome} · ${esc.setorNome}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:32px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:24px">

        <div class="form-section">
          <div class="form-section-title">Contexto</div>
          <div class="form-row">
            ${estado.escopos.length > 1 ? `
            <div class="field"><label>Empresa / Área</label>
              <select id="pai-escopo" onchange="onEscopoChange(this.value)">
                ${estado.escopos.map((e, i) => `<option value="${i}" ${i === estado.escopoIdx ? 'selected' : ''}>${e.empresaNome} · ${e.setorNome}</option>`).join('')}
              </select>
            </div>` : `
            <div class="field"><label>Empresa</label><input value="${esc.empresaNome}" disabled></div>
            <div class="field"><label>Área</label><input value="${esc.setorNome}" disabled></div>`}
          </div>
          <div class="form-row">
            <div class="field"><label>Ano-calendário do plano</label>
              <select id="pai-ano" onchange="onAnoChange(this.value)">
                <option value="${anoAtual}" ${estado.ano === anoAtual ? 'selected' : ''}>${anoAtual} · vigente</option>
                <option value="${anoAtual + 1}" ${estado.ano === anoAtual + 1 ? 'selected' : ''}>${anoAtual + 1} · disponível (entressafra)</option>
              </select>
            </div>
            <div class="field"><label>Tipo de investimento</label>
              <select id="pai-tipo" onchange="onTipoChange(this.value)">
                ${Object.entries(TIPO_INVESTIMENTO_LABELS).map(([k, v]) => `<option value="${k}" ${estado.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field">
            <label>Título *</label>
            <input type="text" id="pai-titulo" value="${estado.titulo}" oninput="onTituloInput(this.value)" placeholder="ex.: Correia transportadora da britagem">
          </div>
          <div class="field">
            <label>Descrição *</label>
            <textarea id="pai-descricao" rows="3" oninput="onDescricaoInput(this.value)" placeholder="Detalhe o investimento: o que é, por que é necessário, impacto esperado...">${estado.descricao}</textarea>
          </div>
        </div>

        <div class="form-section">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px">
            <div class="form-section-title" style="margin-bottom:0">Linhas do plano · o bolo de ${estado.ano}</div>
            <div class="text-xs text-muted">só linhas da sua área e do ano selecionado</div>
          </div>
          ${estado.linhas.length === 0 ? `
          <div class="empty-state" style="padding:24px">
            <div class="empty-icon" style="font-size:24px">📭</div>
            <div class="empty-desc">Nenhuma linha aprovada para esta área em ${estado.ano}.</div>
          </div>` : `
          <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Linha aprovada</th><th class="text-right">Livre</th><th style="width:150px">Usar deste PAI</th></tr></thead>
            <tbody id="linhas-tbody">${renderLinhasBolo()}</tbody>
          </table>
          </div>
          <div id="linha-aviso" class="text-xs" style="color:var(--red);margin-top:6px">${c.estouraLinha ? 'Reduza o valor: alguma linha está sendo usada acima do saldo livre.' : ''}</div>`}
        </div>

        <div class="form-section">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px">
            <div class="form-section-title" style="margin-bottom:0">Composição do valor</div>
            <div id="soma-status" class="text-sm" style="color:${c.somaBate ? 'var(--green)' : 'var(--red)'}">${textoSomaStatus(c)}</div>
          </div>
          <div style="overflow-x:auto">
          <table>
            <thead><tr><th style="width:36px">#</th><th>Aplicação</th><th class="text-right" style="width:160px">Valor</th><th style="width:36px"></th></tr></thead>
            <tbody id="itens-tbody">${renderLinhasItens()}</tbody>
          </table>
          </div>
          <div style="margin-top:10px"><button class="btn btn-secondary btn-sm" onclick="onAddItem()">+ Adicionar item</button></div>
          <div class="text-xs text-muted" style="margin-top:8px">O número do bem de cada item é preenchido no encerramento, pela Controladoria Contábil.</div>
        </div>

        <div class="form-section">
          <div class="form-section-title">Anexos</div>
          <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
            ${renderBotaoAnexo('a3')}
            ${renderBotaoAnexo('viabilidade')}
            ${renderBotaoAnexo('orcamento')}
          </div>
          <div class="text-xs text-muted" style="margin-top:8px">A3 do projeto e estudo de viabilidade são obrigatórios em todo PAI. Orçamentos são aproximados, para dimensionar a verba.</div>
        </div>

      </div>

      <div style="position:sticky;top:24px;display:flex;flex-direction:column;gap:16px">
        <div class="chart-card">
          <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Verba da minha área · ${estado.ano}</div>
          <div id="barra-verba" style="height:12px;border-radius:4px;background:var(--surface2);overflow:hidden;display:flex;margin-bottom:12px">${renderBarraVerba(c)}</div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
            <div style="display:flex;justify-content:space-between"><span class="text-muted">Aprovado</span><span id="res-aprovado">${fmtMoeda(c.somaAprovado)}</span></div>
            <div style="display:flex;justify-content:space-between"><span class="text-muted">Reservado (outros PAIs)</span><span id="res-reservado">${fmtMoeda(c.somaReservado)}</span></div>
            <div style="display:flex;justify-content:space-between;color:var(--accent)"><span>Este PAI</span><span id="res-este-pai">${fmtMoeda(c.totalUsar)}</span></div>
            <div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--border);padding-top:6px"><span>Livre após envio</span><span id="res-livre-apos" style="color:${c.livreApos < 0 ? 'var(--red)' : 'var(--green)'}">${fmtMoeda(c.livreApos)}</span></div>
          </div>
        </div>

        <div class="chart-card">
          <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Valor do PAI</div>
          <div id="valor-pai" style="font-size:28px;font-weight:700">${fmtMoeda(c.totalUsar)}</div>
          <div class="text-xs text-muted">reserva de verba válida por 30 dias após o envio</div>
        </div>

        <div class="chart-card">
          <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Antes de enviar</div>
          <div id="checklist" style="display:flex;flex-direction:column;gap:8px">${renderChecklist(c)}</div>
          ${!estado.planoId ? `<div class="text-xs" style="color:var(--red);margin-top:10px">Nenhum plano carregado para ${estado.escopos[estado.escopoIdx].empresaNome} em ${estado.ano} ainda — fale com a Controladoria Operacional.</div>` : ''}
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
            <button class="btn btn-primary btn-full" id="btn-enviar" ${(c.bloqueado || !estado.planoId) ? 'disabled' : ''} onclick="onEnviarPai()">Enviar à Controladoria</button>
            <button class="btn btn-ghost btn-full" id="btn-rascunho" ${!estado.planoId ? 'disabled' : ''} onclick="onSalvarRascunho()">Salvar rascunho</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ─── fragmentos reutilizados pelo render() e pelas atualizações parciais ───
function textoSomaStatus(c) {
  return c.somaBate ? `soma ${fmtMoeda(c.totalComposicao)} = verba vinculada ✓` : `soma ${fmtMoeda(c.totalComposicao)} ≠ verba ${fmtMoeda(c.totalUsar)}`;
}

function renderLinhasBolo() {
  return estado.linhas.map((l, i) => `
    <tr>
      <td>${l.descricao}</td>
      <td class="text-right text-muted">${fmtMoeda(l.livre)}</td>
      <td><input type="number" min="0" step="0.01" id="linha-usar-${i}" value="${l.usar || ''}" placeholder="0"
        oninput="onLinhaUsarInput(${i}, this.value)" style="border-color:${numOrZero(l.usar) > l.livre ? 'var(--red)' : 'var(--border)'}"></td>
    </tr>`).join('');
}

function renderLinhasItens() {
  return estado.itens.map((it, i) => `
    <tr>
      <td class="text-muted">${i + 1}</td>
      <td><input type="text" id="item-aplicacao-${i}" value="${it.aplicacao}" oninput="onItemAplicacaoInput(${i}, this.value)" placeholder="ex.: Correia 800mm"></td>
      <td><input type="number" min="0" step="0.01" id="item-valor-${i}" value="${it.valor || ''}" placeholder="0" oninput="onItemValorInput(${i}, this.value)"></td>
      <td><button class="btn btn-ghost btn-sm" onclick="onRemoveItem(${i})" title="Remover">✕</button></td>
    </tr>`).join('');
}

function renderBotaoAnexo(chave) {
  const arquivo = estado.anexos[chave];
  const existente = estado.anexosExistentes[chave];
  const on = !!(arquivo || existente);
  const rotulo = arquivo ? '✓ ' + arquivo.name : existente ? '✓ ' + existente.nome_arquivo + ' (enviado antes — clique para substituir)' : '📎 ' + LABELS_ANEXO[chave];
  return `
    <div>
      <input type="file" id="anexo-input-${chave}" style="display:none" onchange="onAnexoSelecionado('${chave}', this.files[0])">
      <button type="button" class="btn btn-secondary btn-full" id="anexo-btn-${chave}" onclick="document.getElementById('anexo-input-${chave}').click()"
        style="justify-content:flex-start;border-color:${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent-dim)' : 'var(--surface)'}">
        ${rotulo}
      </button>
    </div>`;
}

function renderBarraVerba(c) {
  const total = c.somaAprovado || 1;
  const pctReservado = Math.max(0, Math.min(100, (c.somaReservado / total) * 100));
  const pctEstePai = Math.max(0, Math.min(100 - pctReservado, (c.totalUsar / total) * 100));
  return `<div style="width:${pctReservado}%;background:var(--border2)"></div><div style="width:${pctEstePai}%;background:var(--accent)"></div>`;
}

function renderChecklist(c) {
  return c.checks.map(ck => `
    <div style="display:flex;gap:8px;align-items:flex-start;font-size:13px">
      <span style="color:${ck.ok ? 'var(--green)' : 'var(--text3)'};font-weight:700">${ck.ok ? '✓' : '○'}</span>
      <span>${ck.texto}</span>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════
// ATUALIZAÇÃO PARCIAL (sem re-render — preserva o foco de quem está digitando)
// ═══════════════════════════════════════════════════
function setTexto(id, texto) { const el = document.getElementById(id); if (el) el.textContent = texto; }

function atualizar() {
  const c = calcular();

  estado.linhas.forEach((l, i) => {
    const input = document.getElementById(`linha-usar-${i}`);
    if (input) input.style.borderColor = numOrZero(l.usar) > l.livre ? 'var(--red)' : 'var(--border)';
  });
  const aviso = document.getElementById('linha-aviso');
  if (aviso) aviso.textContent = c.estouraLinha ? 'Reduza o valor: alguma linha está sendo usada acima do saldo livre.' : '';

  const somaStatus = document.getElementById('soma-status');
  if (somaStatus) { somaStatus.textContent = textoSomaStatus(c); somaStatus.style.color = c.somaBate ? 'var(--green)' : 'var(--red)'; }

  const barra = document.getElementById('barra-verba');
  if (barra) barra.innerHTML = renderBarraVerba(c);

  setTexto('res-aprovado', fmtMoeda(c.somaAprovado));
  setTexto('res-reservado', fmtMoeda(c.somaReservado));
  setTexto('res-este-pai', fmtMoeda(c.totalUsar));
  const livreEl = document.getElementById('res-livre-apos');
  if (livreEl) { livreEl.textContent = fmtMoeda(c.livreApos); livreEl.style.color = c.livreApos < 0 ? 'var(--red)' : 'var(--green)'; }

  setTexto('valor-pai', fmtMoeda(c.totalUsar));

  const checklist = document.getElementById('checklist');
  if (checklist) checklist.innerHTML = renderChecklist(c);

  const btn = document.getElementById('btn-enviar');
  if (btn) btn.disabled = c.bloqueado || !estado.planoId;

  return c;
}

// ═══════════════════════════════════════════════════
// HANDLERS DE CAMPO
// ═══════════════════════════════════════════════════
function onEscopoChange(valor) { estado.escopoIdx = parseInt(valor, 10); carregarLinhas().then(render); }
function onAnoChange(valor) { estado.ano = parseInt(valor, 10); carregarLinhas().then(render); }
function onTipoChange(valor) { estado.tipo = valor; }
function onTituloInput(valor) { estado.titulo = valor; atualizar(); }
function onDescricaoInput(valor) { estado.descricao = valor; atualizar(); }
function onLinhaUsarInput(i, valor) { estado.linhas[i].usar = numOrZero(valor); atualizar(); }
function onItemAplicacaoInput(i, valor) { estado.itens[i].aplicacao = valor; atualizar(); }
function onItemValorInput(i, valor) { estado.itens[i].valor = numOrZero(valor); atualizar(); }

function onAddItem() {
  estado.itens.push({ aplicacao: '', valor: 0 });
  document.getElementById('itens-tbody').innerHTML = renderLinhasItens();
  atualizar();
}
function onRemoveItem(i) {
  estado.itens.splice(i, 1);
  document.getElementById('itens-tbody').innerHTML = renderLinhasItens();
  atualizar();
}

function onAnexoSelecionado(chave, file) {
  estado.anexos[chave] = file || null;
  const btn = document.getElementById(`anexo-btn-${chave}`);
  if (btn) {
    const on = !!file;
    btn.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
    btn.style.background = on ? 'var(--accent-dim)' : 'var(--surface)';
    btn.textContent = on ? '✓ ' + file.name : '📎 ' + LABELS_ANEXO[chave];
  }
  atualizar();
}

// ═══════════════════════════════════════════════════
// SALVAR RASCUNHO / ENVIAR
// ═══════════════════════════════════════════════════
async function onSalvarRascunho() {
  if (!estado.planoId) { toast('Nenhum plano carregado para esta empresa/ano ainda', 'error'); return; }
  const esc = estado.escopos[estado.escopoIdx];
  const payload = {
    plano_id: estado.planoId, empresa_id: esc.empresaId, setor_id: esc.setorId, ano_calendario: estado.ano,
    tipo: estado.tipo, titulo: estado.titulo, descricao: estado.descricao, solicitante_id: currentUser.id, status: 'rascunho'
  };

  let error;
  if (estado.paiId) {
    ({ error } = await sb.from('pais').update(payload).eq('id', estado.paiId));
  } else {
    const resp = await sb.from('pais').insert(payload).select('id').single();
    error = resp.error;
    if (!error) estado.paiId = resp.data.id;
  }

  if (error) { toast('Erro ao salvar rascunho: ' + error.message, 'error'); return; }
  toast('Rascunho salvo');
}

async function onEnviarPai() {
  const c = calcular();
  if (c.bloqueado) { toast('Complete os itens do checklist antes de enviar', 'error'); return; }
  if (!estado.planoId) { toast('Nenhum plano carregado para esta empresa/ano ainda', 'error'); return; }

  const esc = estado.escopos[estado.escopoIdx];
  const reenvio = estado.statusOriginal === 'devolvido';

  // Reenvio após devolução: é o mesmo PAI, mantém o número já emitido —
  // só um PAI novo (ou um rascunho sem número ainda) gera um número novo.
  let numero;
  if (reenvio) {
    const { data: paiAtual, error: erroPaiAtual } = await sb.from('pais').select('numero').eq('id', estado.paiId).single();
    if (erroPaiAtual) { toast('Erro ao carregar número do PAI: ' + erroPaiAtual.message, 'error'); return; }
    numero = paiAtual.numero;
  } else {
    const { data: numeroGerado, error: erroNumero } = await sb.rpc('gerar_numero_pai', { p_ano: estado.ano });
    if (erroNumero) { toast('Erro ao gerar número do PAI: ' + erroNumero.message, 'error'); return; }
    numero = numeroGerado;
  }

  const agora = new Date();
  const reservaExpira = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const statusAnterior = estado.statusOriginal; // null (novo) | 'rascunho' | 'devolvido'

  const payload = {
    numero, plano_id: estado.planoId, empresa_id: esc.empresaId, setor_id: esc.setorId, ano_calendario: estado.ano,
    tipo: estado.tipo, titulo: estado.titulo, descricao: estado.descricao, solicitante_id: currentUser.id,
    status: 'em_critica', valor_total: c.totalUsar,
    enviado_em: agora.toISOString(), reserva_expira_em: reservaExpira.toISOString()
  };

  let paiId = estado.paiId;
  let erroPai;
  if (paiId) {
    ({ error: erroPai } = await sb.from('pais').update(payload).eq('id', paiId));
  } else {
    const resp = await sb.from('pais').insert(payload).select('id').single();
    erroPai = resp.error;
    if (!erroPai) paiId = resp.data.id;
  }
  if (erroPai) { toast('Erro ao enviar PAI: ' + erroPai.message, 'error'); return; }

  // Reenvio após devolução: a composição e os vínculos do ciclo anterior são
  // substituídos pelos atuais (o solicitante pode ter ajustado quantidades/itens).
  if (reenvio) {
    await sb.from('vinculos_verba').delete().eq('pai_id', paiId);
    await sb.from('itens_pai').delete().eq('pai_id', paiId);
  }

  const vinculos = estado.linhas.filter(l => numOrZero(l.usar) > 0).map(l => ({ pai_id: paiId, linha_id: l.linhaId, valor: l.usar }));
  const { error: erroVinculos } = await sb.from('vinculos_verba').insert(vinculos);
  if (erroVinculos) { toast('PAI criado, mas houve erro ao vincular verba: ' + erroVinculos.message, 'error'); return; }

  const itens = estado.itens.map((it, idx) => ({ pai_id: paiId, aplicacao: it.aplicacao, valor: it.valor, ordem: idx + 1 }));
  const { error: erroItens } = await sb.from('itens_pai').insert(itens);
  if (erroItens) toast('PAI criado, mas houve erro ao gravar itens: ' + erroItens.message, 'error');

  const falhasAnexo = [];
  for (const [tipo, file] of Object.entries(estado.anexos)) {
    if (!file) continue;
    // Substituindo um anexo já enviado num ciclo anterior: remove o antigo primeiro.
    const antigo = estado.anexosExistentes[tipo];
    if (antigo) {
      await sb.storage.from(BUCKET_ANEXOS).remove([antigo.storage_path]);
      await sb.from('anexos_pai').delete().eq('id', antigo.id);
    }
    const path = `pai/${paiId}/${Date.now()}_${file.name}`;
    const { error: erroUpload } = await sb.storage.from(BUCKET_ANEXOS).upload(path, file);
    if (erroUpload) { falhasAnexo.push(`${file.name}: ${erroUpload.message}`); continue; }
    const { error: erroAnexo } = await sb.from('anexos_pai').insert({ pai_id: paiId, nome_arquivo: file.name, storage_path: path, tipo, enviado_por: currentUser.id, enviado_em: agora.toISOString() });
    if (erroAnexo) falhasAnexo.push(`${file.name}: ${erroAnexo.message}`);
  }

  await sb.from('historico_pai').insert({
    pai_id: paiId, usuario_id: currentUser.id, de_status: statusAnterior, para_status: 'em_critica',
    observacao: reenvio ? 'PAI ajustado e reenviado à Controladoria' : 'PAI enviado à Controladoria', criado_em: agora.toISOString()
  });
  await iniciarEtapaControladoria(paiId);

  if (falhasAnexo.length) toast(`PAI ${numero} enviado, mas houve erro no(s) anexo(s): ` + falhasAnexo.join(' | '), 'error');
  else toast(`PAI ${numero} enviado com sucesso! Verba reservada por 30 dias.`);

  renderMeusPais();
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  abrirNovoPai, onEscopoChange, onAnoChange, onTipoChange, onTituloInput, onDescricaoInput,
  onLinhaUsarInput, onItemAplicacaoInput, onItemValorInput, onAddItem, onRemoveItem,
  onAnexoSelecionado, onSalvarRascunho, onEnviarPai
});
