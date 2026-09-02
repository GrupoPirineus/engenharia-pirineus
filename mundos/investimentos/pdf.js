import { sb } from '../../shared/supabase.js';
import { toast, fmtDate } from '../../shared/ui.js';
import { fmtMoeda, TIPO_INVESTIMENTO_LABELS } from './dashboard.js';

// ═══════════════════════════════════════════════════
// PDF OFICIAL DO PAI E DO AUMENTO DE VERBA (Etapa 11)
// Mesmo padrão de mundos/chamados/chamado-detalhe.js (imprimirChamado):
// window.open + HTML com CSS de impressão + window.print() — sem
// biblioteca nova, Chamados também não usa nenhuma.
// ═══════════════════════════════════════════════════

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

const CSS_IMPRESSAO = `
  body { font-family: Arial, sans-serif; color: #0f2233; padding: 32px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  h1 { font-size: 20px; color: #1a9e9e; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #4a6478; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #d0dde8; padding-bottom: 6px; margin: 20px 0 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #1a9e9e; padding-bottom: 16px; }
  .codigo { font-family: monospace; color: #1a9e9e; font-size: 12px; margin-bottom: 4px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #f0f4f7; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .item label { font-size: 10px; color: #8aa0b0; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 2px; }
  .item span { font-size: 13px; font-weight: 500; }
  .desc { background: #f8fafc; border: 1px solid #d0dde8; border-radius: 6px; padding: 12px; line-height: 1.6; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f0f4f7; padding: 8px 10px; text-align: left; font-size: 11px; color: #4a6478; text-transform: uppercase; }
  td { padding: 8px 10px; border-bottom: 1px solid #e8f0f5; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; background: #e8f8f8; color: #1a9e9e; }
  .assinaturas { margin-top: 12px; }
  .assinatura-linha { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #d0dde8; font-size: 12px; }
  .assinatura-aviso { margin-top: 10px; font-size: 11px; color: #8aa0b0; font-style: italic; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #d0dde8; font-size: 11px; color: #8aa0b0; display: flex; justify-content: space-between; }
  @media print { body { padding: 16px; } }
`;

function documentoHtml(titulo, corpoHtml) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8"><title>${titulo}</title>
    <style>${CSS_IMPRESSAO}</style>
  </head><body>${corpoHtml}</body></html>`;
}

// window.open pode voltar null se o navegador bloquear o pop-up — nesse
// caso, em vez de travar sem feedback, avisa e imprime pela própria
// página via um iframe oculto (não depende de permissão de pop-up).
function abrirJanelaImpressao(titulo, corpoHtml) {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(documentoHtml(titulo, corpoHtml));
    win.document.close();
    setTimeout(() => win.print(), 500);
    return;
  }

  toast('Pop-up bloqueado pelo navegador — imprimindo por aqui mesmo. Para abrir em nova aba da próxima vez, permita pop-ups para este site.', 'error');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(documentoHtml(titulo, corpoHtml));
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 500);
}

// Bloco de aprovações eletrônicas — deixa explícito que não é assinatura
// manuscrita, com data/hora de cada uma (historico_pai/passos_* já têm
// isso registrado desde a Etapa 4/7).
function renderAssinaturas(linhas) {
  return `
    <h2>Aprovações Eletrônicas</h2>
    <div class="assinaturas">
      ${linhas.map(l => `
        <div class="assinatura-linha">
          <span><strong>${l.papel}</strong> — ${l.nome || '—'}</span>
          <span>${l.data ? fmtDateTime(l.data) : 'pendente'}</span>
        </div>`).join('')}
    </div>
    <div class="assinatura-aviso">Aprovações eletrônicas registradas no Sistema de Gestão de Engenharia — não são assinaturas manuscritas. Data/hora conforme registro do sistema.</div>`;
}

export async function imprimirPai(paiId) {
  const [{ data: pai, error }, { data: itens }, { data: vinculos }, { data: passos }] = await Promise.all([
    sb.from('pais').select('*, empresas(nome), setores(nome), solicitante:solicitante_id(nome)').eq('id', paiId).single(),
    sb.from('itens_pai').select('*').eq('pai_id', paiId).order('ordem'),
    sb.from('vinculos_verba').select('*, linhas_plano(descricao)').eq('pai_id', paiId),
    sb.from('passos_aprovacao').select('*, usuario:responsavel_id(nome)').eq('pai_id', paiId).eq('decisao', 'aprovado').order('ordem')
  ]);
  if (error || !pai) { toast('Erro ao carregar PAI para impressão: ' + (error?.message || ''), 'error'); return; }

  // Primeiro passo aprovado de cada etapa — a cadeia Solicitante ->
  // Controladoria -> Superintendente -> Diretor (a reentrada em
  // controladoria_op para formalização não entra nesse bloco de
  // assinaturas; o código MRP já registra que ela aconteceu).
  const passoPorEtapa = {};
  (passos || []).forEach(p => { if (!passoPorEtapa[p.etapa]) passoPorEtapa[p.etapa] = p; });

  const assinaturas = [
    { papel: 'Solicitante', nome: pai.solicitante?.nome, data: pai.enviado_em },
    { papel: 'Controladoria Operacional', nome: passoPorEtapa.controladoria_op?.usuario?.nome, data: passoPorEtapa.controladoria_op?.decidido_em },
    { papel: 'Superintendente', nome: passoPorEtapa.aprovador?.usuario?.nome, data: passoPorEtapa.aprovador?.decidido_em },
    { papel: 'Diretor da Área', nome: passoPorEtapa.diretor?.usuario?.nome, data: passoPorEtapa.diretor?.decidido_em }
  ];

  const encerrado = pai.status === 'encerrado';

  const corpo = `
    <div class="header">
      <div>
        <div class="codigo">${pai.numero || '—'}</div>
        <h1>${pai.titulo}</h1>
        <span class="badge">PAI · Investimentos</span>
      </div>
      <div style="text-align:right;font-size:11px;color:#8aa0b0">
        <div><strong>Grupo Pirineus</strong></div>
        <div>Emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
    </div>

    <h2>Informações do PAI</h2>
    <div class="grid">
      <div class="item"><label>Empresa</label><span>${pai.empresas?.nome || '—'}</span></div>
      <div class="item"><label>Setor</label><span>${pai.setores?.nome || '—'}</span></div>
      <div class="item"><label>Tipo</label><span>${TIPO_INVESTIMENTO_LABELS[pai.tipo] || pai.tipo || '—'}</span></div>
      <div class="item"><label>Valor Total</label><span>${fmtMoeda(pai.valor_total)}</span></div>
      <div class="item"><label>Ano</label><span>${pai.ano_calendario}</span></div>
      <div class="item"><label>Código MRP</label><span>${pai.mrp_codigo || '—'}</span></div>
      <div class="item"><label>Previsão de Conclusão</label><span>${fmtDate(pai.previsao_conclusao) || '—'}</span></div>
      ${encerrado ? `<div class="item"><label>Saldo Apurado</label><span>${fmtMoeda(Math.abs(pai.saldo_final))} ${pai.saldo_final >= 0 ? '(sobra)' : '(excedente)'}</span></div>` : ''}
    </div>

    <h2>Descrição</h2>
    <div class="desc">${pai.descricao}</div>

    <h2>Composição</h2>
    <table><thead><tr><th>Aplicação</th>${encerrado ? '<th>Nº do Bem</th>' : ''}<th>Valor</th></tr></thead><tbody>
      ${(itens || []).map(i => `<tr><td>${i.aplicacao}</td>${encerrado ? `<td>${i.numero_bem || '—'}</td>` : ''}<td>${fmtMoeda(i.valor)}</td></tr>`).join('')}
    </tbody></table>

    <h2>Linhas do Bolo Consumidas</h2>
    <table><thead><tr><th>Linha</th><th>Valor</th></tr></thead><tbody>
      ${(vinculos || []).map(v => `<tr><td>${v.linhas_plano?.descricao || '—'}</td><td>${fmtMoeda(v.valor)}</td></tr>`).join('')}
    </tbody></table>

    ${renderAssinaturas(assinaturas)}

    <div class="footer">
      <span>Sistema de Gestão de Engenharia — Grupo Pirineus</span>
      <span>${pai.numero || '—'}</span>
    </div>`;

  abrirJanelaImpressao(`${pai.numero || 'PAI'} — ${pai.titulo}`, corpo);
}

export async function imprimirAumento(aumentoId) {
  const [{ data: aum, error }, { data: passos }] = await Promise.all([
    sb.from('aumentos_verba').select('*, empresas(nome), setores(nome), solicitante:solicitante_id(nome)').eq('id', aumentoId).single(),
    sb.from('passos_aumento').select('*, usuario:responsavel_id(nome)').eq('aumento_id', aumentoId).eq('decisao', 'aprovado').order('ordem')
  ]);
  if (error || !aum) { toast('Erro ao carregar aumento para impressão: ' + (error?.message || ''), 'error'); return; }

  const passoPorEtapa = {};
  (passos || []).forEach(p => { if (!passoPorEtapa[p.etapa]) passoPorEtapa[p.etapa] = p; });

  // Caso colapsado (Diretor da área também é Diretor CEO): não existe
  // passo diretor_ceo — a própria aprovação do Diretor da área já fechou
  // o fluxo, então repete essa mesma assinatura aqui, com a ressalva.
  const diretorCeoPasso = passoPorEtapa.diretor_ceo || (aum.status === 'aprovado' ? passoPorEtapa.diretor : null);
  const colapsou = !passoPorEtapa.diretor_ceo && !!diretorCeoPasso;

  const valorInvestimento = aum.valor_investimento;
  const remanescente = valorInvestimento != null ? valorInvestimento - aum.valor : null;

  const assinaturas = [
    { papel: 'Superintendente', nome: passoPorEtapa.aprovador?.usuario?.nome, data: passoPorEtapa.aprovador?.decidido_em },
    { papel: 'Diretor da Área', nome: passoPorEtapa.diretor?.usuario?.nome, data: passoPorEtapa.diretor?.decidido_em },
    { papel: colapsou ? 'Diretor CEO (acumulando o papel de Diretor da área)' : 'Diretor CEO', nome: diretorCeoPasso?.usuario?.nome, data: diretorCeoPasso?.decidido_em }
  ];

  const corpo = `
    <div class="header">
      <div>
        <div class="codigo">${aum.numero || '—'}</div>
        <h1>Autorização para Aumento de Verba de Investimento</h1>
        <span class="badge">Aumento de Verba</span>
      </div>
      <div style="text-align:right;font-size:11px;color:#8aa0b0">
        <div><strong>Grupo Pirineus</strong></div>
        <div>Emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
      </div>
    </div>

    <h2>Dados do Pedido</h2>
    <div class="grid">
      <div class="item"><label>Empresa</label><span>${aum.empresas?.nome || '—'}</span></div>
      <div class="item"><label>Setor</label><span>${aum.setores?.nome || '—'}</span></div>
      <div class="item"><label>Ano</label><span>${aum.ano_calendario}</span></div>
      <div class="item"><label>Tipo de Investimento</label><span>${TIPO_INVESTIMENTO_LABELS[aum.tipo] || aum.tipo || '—'}</span></div>
      <div class="item"><label>Solicitante</label><span>${aum.solicitante?.nome || '—'}</span></div>
      <div class="item"><label>Enviado em</label><span>${fmtDate(aum.criado_em)}</span></div>
    </div>

    <h2>Valores</h2>
    <div class="grid">
      <div class="item"><label>Valor do Investimento</label><span>${valorInvestimento != null ? fmtMoeda(valorInvestimento) : '—'}</span></div>
      <div class="item"><label>Valor Remanescente</label><span>${remanescente != null ? fmtMoeda(remanescente) : '—'}</span></div>
      <div class="item"><label>Aumento Necessário</label><span>${fmtMoeda(aum.valor)}</span></div>
    </div>

    <h2>Justificativa</h2>
    <div class="desc">${aum.justificativa}</div>

    ${renderAssinaturas(assinaturas)}

    <div class="footer">
      <span>Sistema de Gestão de Engenharia — Grupo Pirineus</span>
      <span>${aum.numero || '—'}</span>
    </div>`;

  abrirJanelaImpressao(`${aum.numero || 'Aumento'} — Aumento de Verba`, corpo);
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { imprimirPai, imprimirAumento });
