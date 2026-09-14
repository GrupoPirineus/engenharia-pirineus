import { temPapel, isMaster } from '../../shared/acesso.js';

// ═══════════════════════════════════════════════════
// AJUDA DO MUNDO INVESTIMENTOS (Etapa 17)
//
// Manual por perfil, mesmo conteúdo/ordem do documento "Manual do Sistema
// — Fluxo de Aprovação de Investimento (PAI)" já existente neste projeto,
// só com o capítulo da Controladoria Contábil atualizado para a regra de
// saldo da Etapa 15 (a versão em PDF ainda descreve a regra antiga, em
// que todo saldo — positivo ou negativo — voltava ao bolo).
//
// Ao abrir, resolve quais papéis o usuário logado tem no mundo
// investimentos (temPapel — já retorna true para master automaticamente,
// via is_master() OR ... na função SQL) e destaca essas seções com a
// badge "Seu papel"; as demais continuam acessíveis pelo índice.
// ═══════════════════════════════════════════════════

const SECOES = [
  {
    id: 'acesso', numero: 1, titulo: 'Acesso ao sistema', kicker: 'Todos os usuários', papel: null,
    resumo: 'Como entrar, escolher o mundo e recuperar a senha.',
    corpo: `
      <h4>1.1 Entrar</h4>
      <ol>
        <li>Acesse o endereço do portal no navegador.</li>
        <li>Entre com e-mail e senha, ou pelo botão <strong>Entrar com Google</strong> (conta @grupopirineus.com.br).</li>
        <li>No primeiro acesso, a conta fica <strong>pendente</strong> até o administrador liberar e definir suas atribuições. Você recebe um e-mail quando o acesso é liberado.</li>
      </ol>
      <h4>1.2 Escolher o mundo</h4>
      <p>Após entrar, escolha entre <strong>Chamados</strong> e <strong>Investimentos</strong> (aparecem só os mundos a que você tem acesso). Dentro de um mundo, use o alternador no topo da barra lateral para trocar sem sair.</p>
      <h4>1.3 Recuperar senha</h4>
      <p>Na tela de login, use "Esqueceu a senha?" para receber um link de redefinição por e-mail. Não se aplica a quem entra pelo Google.</p>`
  },
  {
    id: 'solicitante', numero: 2, titulo: 'Solicitante', kicker: 'Perfil · Solicitante', papel: 'inv_solicitante',
    resumo: 'Quem abre o pedido de investimento (PAI) e acompanha até a formalização e o encerramento.',
    corpo: `
      <h4>2.1 Abrir um novo PAI</h4>
      <ol>
        <li>No mundo Investimentos, clique em <strong>Meus PAIs → Novo PAI</strong>.</li>
        <li>Confira empresa e área, escolha o ano-calendário (vigente ou o próximo, para a entressafra) e o tipo de investimento.</li>
        <li>Informe o valor total do investimento. O sistema mostra o saldo do bolo da sua área e avisa se não houver saldo suficiente.</li>
        <li>Em <strong>Linhas do plano</strong>, distribua de quais linhas do bolo sai a verba — a soma precisa igualar o valor total, e nenhuma linha pode passar do seu saldo livre.</li>
        <li>Em <strong>Composição</strong>, lance como o valor será gasto (item + valor). A soma também precisa fechar com o valor total.</li>
        <li>Anexe os documentos obrigatórios e clique em <strong>Enviar à Controladoria</strong>.</li>
      </ol>
      <div class="ajuda-nota">O número do bem de cada item é preenchido só no encerramento, pela Controladoria Contábil — você não precisa informar na abertura.</div>
      <h4>2.2 Quando falta saldo — pedir aumento de verba</h4>
      <p>Se o valor total estourar o teto da área, aparece o botão <strong>Solicitar aumento de verba</strong>. Ele abre um pedido já preenchido com o contexto do PAI: confirme empresa/área e ano, confira o valor remanescente (calculado sozinho) e escreva a justificativa.</p>
      <p>O aumento passa por uma alçada própria (Controladoria Operacional → Superintendente → Diretor da área → Diretor CEO). Aprovado, a verba entra no bolo e você retoma o PAI.</p>
      <h4>2.3 Acompanhar e concluir</h4>
      <ul>
        <li>Em <strong>Meus PAIs</strong> você vê a situação de cada pedido; a aba "Aumentos de Verba" mostra os pedidos de aumento.</li>
        <li>Se um PAI for <strong>devolvido para ajuste</strong>, corrija e reenvie — ele recomeça na Controladoria Operacional.</li>
        <li>Quando a obra/compra terminar, abra o PAI e clique em <strong>Indicar conclusão</strong> para enviá-lo ao encerramento pela Controladoria Contábil.</li>
        <li>Você recebe e-mail a cada passo (crítica, aprovações, formalização, encerramento).</li>
      </ul>`
  },
  {
    id: 'controladoria_op', numero: 3, titulo: 'Controladoria Operacional', kicker: 'Perfil · Controladoria Operacional', papel: 'controladoria_op',
    resumo: 'Guardiã do processo: sobe o plano anual, critica os PAIs (e os aumentos de verba), formaliza a abertura e mantém o bolo de verba.',
    corpo: `
      <h4>3.1 Subir o Plano de Investimento</h4>
      <ol>
        <li>Abra <strong>Plano de Investimento</strong>, escolha empresa e ano-calendário (abre o plano existente ou cria um novo em rascunho).</li>
        <li>Adicione as linhas do bolo: setor, descrição e valor. O resumo por área mostra o bolo somado por superintendência.</li>
        <li>Clique em <strong>Publicar plano</strong> para passar de rascunho a aprovado — só planos aprovados ficam disponíveis para os PAIs.</li>
      </ol>
      <div class="ajuda-nota">Depois de publicado, uma linha em vigor não é editada em valor/descrição: para mudar, cancele a linha (se não tiver reserva) e crie outra, sem estourar o teto congelado da área. Aumentos entram pelo fluxo próprio de aumento de verba.</div>
      <h4>3.2 Criticar o PAI (e o aumento de verba)</h4>
      <ol>
        <li>Em <strong>Aprovações</strong>, aba "Controladoria Operacional", abra o PAI ou o aumento da fila.</li>
        <li>Confira dados, valores e anexos. <strong>Aprove</strong> para seguir ao superintendente, ou <strong>Devolva p/ ajuste</strong> (com observação) ao solicitante. Nesta etapa não há a opção Reprovar.</li>
      </ol>
      <h4>3.3 Formalizar (após todas as aprovações)</h4>
      <ol>
        <li>O PAI volta para a Controladoria Operacional em situação de formalização.</li>
        <li>Abra o centro de custo no Minerion e registre o <strong>código MRP</strong> no PAI.</li>
        <li>Informe a <strong>previsão de conclusão</strong> da obra.</li>
        <li>Clique em <strong>Formalizar</strong> para baixar a verba no bolo. O solicitante é avisado por e-mail; um PDF oficial pode ser gerado.</li>
      </ol>`
  },
  {
    id: 'superintendente', numero: 4, titulo: 'Superintendente da área (aprovador)', kicker: 'Perfil · Superintendente', papel: 'inv_aprovador',
    resumo: 'Segunda alçada: análise técnica e financeira do PAI (e do aumento de verba) da sua área.',
    corpo: `
      <ol>
        <li>Em <strong>Aprovações</strong>, aba "Superintendente", você vê os PAIs (e aumentos) das áreas/unidades pelas quais responde.</li>
        <li>Abra o pedido, avalie e escolha: <strong>Aprovar</strong> (segue ao Diretor da área), <strong>Devolver p/ ajuste</strong> ou <strong>Reprovar</strong> (com observação obrigatória).</li>
      </ol>
      <div class="ajuda-nota">Um superintendente pode responder por mais de uma área/unidade — a fila reúne todas em que você é o responsável.</div>`
  },
  {
    id: 'diretor', numero: 5, titulo: 'Diretor da área', kicker: 'Perfil · Diretor', papel: 'diretor',
    resumo: 'Terceira alçada: homologa o PAI já criticado e aprovado pelo superintendente.',
    corpo: `
      <ol>
        <li>Em <strong>Aprovações</strong>, aba "Diretor da Área", abra o PAI da sua área.</li>
        <li><strong>Aprove</strong> para enviar à formalização, ou <strong>Devolva/Reprove</strong> com observação.</li>
        <li>No aumento de verba, sua aprovação segue ao Diretor CEO — exceto quando você já é o Diretor CEO da área, caso em que a mesma aprovação encerra a alçada.</li>
      </ol>`
  },
  {
    id: 'diretor_ceo', numero: 6, titulo: 'Diretor CEO', kicker: 'Perfil · Diretor CEO', papel: 'diretor_ceo',
    resumo: 'Última alçada do aumento de verba. Não participa do fluxo do PAI comum.',
    corpo: `
      <ol>
        <li>Em <strong>Aprovações</strong>, aba "Diretor CEO", abra o pedido de aumento.</li>
        <li><strong>Aprove</strong> para elevar o teto da área (a verba entra no bolo como uma linha de aumento), ou devolva/reprove.</li>
      </ol>
      <div class="ajuda-nota">Quando o Diretor da área e o Diretor CEO são a mesma pessoa, o sistema colapsa os dois passos: uma só aprovação cobre ambos.</div>`
  },
  {
    id: 'contabil', numero: 7, titulo: 'Controladoria Contábil', kicker: 'Perfil · Controladoria Contábil', papel: 'controladoria_contabil',
    resumo: 'Encerra o PAI concluído e imobiliza o bem.',
    corpo: `
      <ol>
        <li>Em <strong>Aprovações</strong>, aba "Controladoria Contábil", abra o PAI que o solicitante indicou como concluído.</li>
        <li>Informe o <strong>número do bem</strong> de cada item (para imobilizar).</li>
        <li>Informe o <strong>valor final realizado</strong>; o sistema calcula o saldo apurado (aprovado − realizado).</li>
        <li>Clique em <strong>Confirmar encerramento</strong>.</li>
      </ol>
      <div class="ajuda-nota ajuda-nota-destaque">
        <strong>Regra de saldo (vigente desde a Etapa 15):</strong>
        <ul style="margin:6px 0 0;padding-left:18px">
          <li><strong>Saldo negativo</strong> (realizado maior que o aprovado, excedente) — desconta do bolo da área, numa linha de devolução que soma com encerramentos anteriores.</li>
          <li><strong>Saldo positivo</strong> (sobra) — <strong>não volta mais ao bolo</strong>. Fica só registrado no PAI como informação: a sobra vai para o caixa da empresa.</li>
        </ul>
      </div>`
  },
  {
    id: 'admin', numero: 8, titulo: 'Administrador (master)', kicker: 'Perfil · Administrador', papel: 'master',
    resumo: 'Configura o sistema e libera acessos. Não participa dos fluxos de aprovação nem abre PAIs.',
    corpo: `
      <h4>8.1 Usuários (Administração → Usuários)</h4>
      <ul>
        <li>Liberar cadastros pendentes e definir as atribuições de cada pessoa: mundo · papel · empresa · área (uma linha por acesso; a pessoa pode ter várias).</li>
        <li><strong>Bloquear/Liberar</strong> usuários; <strong>Excluir usuário</strong> quando não há nenhum registro vinculado (PAI, aumento etc.) — se houver, o sistema pede para bloquear em vez de excluir.</li>
      </ul>
      <h4>8.2 Áreas e Diretorias (Administração → Áreas e Diretorias)</h4>
      <ul>
        <li><strong>Áreas</strong>: responsável de cada área.</li>
        <li><strong>Diretorias</strong>: diretor de cada diretoria.</li>
        <li><strong>Vínculo Setor → Área</strong>: o mesmo setor pode cair em áreas diferentes conforme a unidade.</li>
        <li><strong>Conferência</strong>: mostra lacunas na cadeia de alçada por unidade e setor.</li>
      </ul>
      <h4>8.3 Unidades e Setores (Administração → Unidades e Setores)</h4>
      <ul>
        <li><strong>Unidades</strong> (empresas): criar, editar, ativar/desativar.</li>
        <li><strong>Setores</strong>: cadastro global; <strong>Setores por unidade</strong>: quais setores cada unidade tem.</li>
        <li><strong>Tipos de Investimento</strong>: lista configurável usada na solicitação do PAI.</li>
      </ul>`
  },
  {
    id: 'apendice', numero: 9, titulo: 'Apêndice: situações do PAI e e-mails', kicker: 'Apêndice', papel: null,
    resumo: 'Referência rápida das situações do PAI e dos e-mails automáticos do sistema.',
    corpo: `
      <h4>9.1 Situações do PAI</h4>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Situação</th><th>O que significa</th></tr></thead>
        <tbody>
          <tr><td><strong>Rascunho</strong></td><td>Ainda não enviado — só o próprio solicitante vê.</td></tr>
          <tr><td><strong>Em crítica</strong></td><td>Na Controladoria Operacional, aguardando conferência.</td></tr>
          <tr><td><strong>Aguardando alçada</strong></td><td>Com o superintendente ou o diretor da área.</td></tr>
          <tr><td><strong>Aprovado / Formalização</strong></td><td>Aprovado por todas as alçadas; Controladoria abrindo no Minerion e baixando a verba.</td></tr>
          <tr><td><strong>Formalizado / Em execução</strong></td><td>Investimento aberto; execução liberada.</td></tr>
          <tr><td><strong>Conclusão indicada</strong></td><td>Solicitante indicou o fim; aguardando encerramento contábil.</td></tr>
          <tr><td><strong>Encerrado</strong></td><td>Bem imobilizado; saldo negativo debitado do bolo, saldo positivo enviado ao caixa da empresa (Etapa 15).</td></tr>
          <tr><td><strong>Devolvido</strong></td><td>Voltou ao solicitante para ajuste.</td></tr>
          <tr><td><strong>Reprovado</strong></td><td>Recusado; a verba reservada volta ao bolo.</td></tr>
        </tbody>
      </table>
      </div>
      <h4 style="margin-top:20px">9.2 E-mails automáticos</h4>
      <p>O sistema envia um e-mail a cada evento: ao aprovador quando um pedido entra na sua fila; ao solicitante a cada passo concluído e nos desfechos (devolução, reprovação, formalização, encerramento); ao master em novos cadastros; ao usuário quando o acesso é liberado; e à Controladoria Contábil quando a previsão de conclusão se aproxima ou vence.</p>`
  }
];

let papeisUsuario = null; // { [secaoId]: boolean }

export async function renderAjuda() {
  document.getElementById('topbar-title').textContent = 'Ajuda';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const papeisNoMundo = [...new Set(SECOES.map(s => s.papel).filter(p => p && p !== 'master'))];
  const [resultados, souMaster] = await Promise.all([
    Promise.all(papeisNoMundo.map(p => temPapel('investimentos', p))),
    isMaster()
  ]);

  papeisUsuario = {};
  papeisNoMundo.forEach((p, i) => { papeisUsuario[p] = resultados[i]; });
  papeisUsuario.master = souMaster;

  montarTela();
}

// Só seções ligadas a um papel real (2-8) recebem o destaque "Seu papel" —
// Acesso (1) e Apêndice (9) são referência geral, sempre neutras no índice.
function secaoEhMinha(secao) {
  if (!secao.papel) return false;
  return !!papeisUsuario[secao.papel];
}

function montarTela() {
  const page = document.getElementById('page-content');
  const minhasSecoes = SECOES.filter(s => s.papel && secaoEhMinha(s));

  page.innerHTML = `
    <div style="margin-bottom:16px">
      <h2 style="font-size:22px;margin:0 0 4px">Ajuda · Manual do Sistema PAI</h2>
      <p class="text-sm text-muted" style="margin:0">Guia de uso por perfil do mundo Investimentos.</p>
    </div>

    ${minhasSecoes.length ? `
    <div class="text-xs text-muted" style="margin-bottom:8px">SEU(S) PAPEL(IS) NESTE MUNDO</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px">
      ${minhasSecoes.map(s => `<button type="button" class="chip-toggle active" onclick="onIrParaSecaoAjuda('${s.id}')">${s.titulo}</button>`).join('')}
    </div>` : ''}

    <div class="form-section" style="margin-bottom:20px">
      <div class="form-section-title">Índice</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${SECOES.map(s => `<button type="button" class="chip-toggle ${secaoEhMinha(s) ? 'active' : ''}" onclick="onIrParaSecaoAjuda('${s.id}')">${s.numero}. ${s.titulo}</button>`).join('')}
      </div>
    </div>

    <div id="ajuda-conteudo" style="display:flex;flex-direction:column;gap:20px">
      ${SECOES.map(s => renderSecao(s)).join('')}
    </div>`;
}

function renderSecao(secao) {
  const minha = secaoEhMinha(secao);
  return `
    <div class="table-card" id="ajuda-secao-${secao.id}" style="${minha ? 'border-left:3px solid var(--accent)' : ''}">
      <div class="table-header">
        <div>
          <div class="text-xs" style="color:var(--accent);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px">${secao.kicker}</div>
          <div class="table-title">${secao.numero}. ${secao.titulo}</div>
        </div>
        ${minha ? '<span class="badge badge-success">Seu papel</span>' : ''}
      </div>
      <div style="padding:16px 20px">
        <p class="text-sm text-muted" style="margin-top:0">${secao.resumo}</p>
        <div class="ajuda-corpo">${secao.corpo}</div>
      </div>
    </div>`;
}

export function onIrParaSecaoAjuda(id) {
  document.getElementById(`ajuda-secao-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { renderAjuda, onIrParaSecaoAjuda });
