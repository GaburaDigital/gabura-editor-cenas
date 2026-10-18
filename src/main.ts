// Editor de Cenas Gabura: monta a tela, liga a janela 3D, a linha do tempo e os painéis,
// e toca a cena (modo Editar e modo Simular VR).

import '@fontsource/baloo-2/700.css';
import '@fontsource/baloo-2/800.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './estilo.css';
import * as THREE from 'three';
import { biblioteca, carregarBiblioteca, contextoAudio, importar, lerConfig, limparBiblioteca, prepararFalas, salvarConfig } from './arquivos';
import { aoMudar, avisar, cena, desfazerUltimo, estado, guardarParaDesfazer, mudou, refazerUltimo } from './estado';
import { abrirJanela, aviso, baixar, confirmar, el, limpar } from './dom';
import { criarLinhaTempo, desenharLinhaTempo, itensDe, moverCabeca, mudarZoom } from './linha_tempo';
import type { BlocoAguardar, Pacote } from './modelo';
import * as mundo from './mundo';
import { apagarFaixa, apagarSelecionado, gravarPosicao, janelaNovaFaixa, novaCena, novoItem } from './operacoes';
import { criarPaineis, desenharDireita, desenharEsquerda } from './paineis';
import * as tocador from './tocador';

// ---------- tela ----------
const app = document.getElementById('app')!;
limpar(app);

const selCena = el('select', { class: 'campo sel-cena', 'aria-label': 'Cena aberta' });
selCena.addEventListener('change', () => { parar(); estado.cenaId = selCena.value; estado.tempo = 0; estado.selecao = null; estado.atorSel = ''; avisar(); });
const btEditar = el('button', { class: 'aba on', type: 'button', onclick: () => trocarModo('editar') }, 'Editar');
const btSimular = el('button', { class: 'aba', type: 'button', onclick: () => trocarModo('simular'), title: 'Primeira pessoa, como no Quest' }, 'Simular VR');
const btInicio = el('button', { class: 'bt icone', type: 'button', title: 'Voltar ao começo (Home)', onclick: () => buscar(0) }, '⏮');
const btTocar = el('button', { class: 'bt lima tocar', type: 'button', title: 'Tocar / pausar (Espaço)', onclick: () => alternar() }, '▶ Tocar');
const relogioTxt = el('span', { class: 'relogio-tempo', 'aria-live': 'off' }, '00:00,0');
const btDesfazer = el('button', { class: 'bt icone', type: 'button', title: 'Desfazer (Ctrl+Z)', onclick: () => desfazerUltimo() }, '↶');
const btRefazer = el('button', { class: 'bt icone', type: 'button', title: 'Refazer (Ctrl+Y)', onclick: () => refazerUltimo() }, '↷');
const btAbrir = el('button', { class: 'bt', type: 'button', onclick: () => escolherArquivos(), title: 'Pacote de cenas (.json ou .zip), modelos (.glb), ZIP da dublagem, sons' }, 'Abrir arquivos');
const btExportar = el('button', { class: 'bt lima', type: 'button', onclick: () => exportar() }, 'Exportar cenas');
const btEventos = el('button', { class: 'bt', type: 'button', title: 'Falas que tocam quando algo acontece no jogo (sem hora marcada)', onclick: () => abrirFalasPorEvento() }, 'Falas por evento');
const btAjustes = el('button', { class: 'bt icone', type: 'button', title: 'Ajustes', onclick: () => abrirAjustes() }, '⚙');

const barra = el('header', { class: 'barra' },
  el('div', { class: 'marca' }, 'Editor de Cenas ', el('span', {}, 'Gabura')),
  selCena,
  el('div', { class: 'abas' }, btEditar, btSimular),
  el('div', { class: 'transporte' }, btInicio, btTocar, relogioTxt),
  el('div', { class: 'acoes' }, btDesfazer, btRefazer, btEventos, btAbrir, btExportar, btAjustes));

const esquerda = el('aside', { class: 'painel esq', 'aria-label': 'Biblioteca' });
const direita = el('aside', { class: 'painel dir', 'aria-label': 'Propriedades' });
const janela3d = el('div', { class: 'janela3d' });
const legenda = el('div', { class: 'legenda', hidden: true });
const caixaAguardar = el('div', { class: 'aguardar', hidden: true });
const dicaSimular = el('div', { class: 'dica-simular', hidden: true },
  el('strong', {}, 'Clique na janela para olhar com o mouse.'),
  el('span', {}, el('kbd', {}, 'W'), el('kbd', {}, 'A'), el('kbd', {}, 'S'), el('kbd', {}, 'D'), ' anda · ', el('kbd', {}, 'Espaço'), ' toca/pausa · ', el('kbd', {}, 'R'), ' relógio · ', el('kbd', {}, 'C'), ' atravessar paredes · ', el('kbd', {}, 'P'), ' abrir/fechar portas · ', el('kbd', {}, 'Esc'), ' solta o mouse'));
const avisoEvento = el('div', { class: 'evento-3d', hidden: true });
const gizmoModos = el('div', { class: 'gizmo-modos' });
const seguirCam = el('input', { type: 'checkbox', checked: true });
const vazio = el('div', { class: 'boas-vindas', hidden: true },
  el('h2', {}, 'Comece arrastando os arquivos para cá'),
  el('p', {}, 'O pacote de cenas (', el('code', {}, 'cenas_nave.json'), ' ou o ZIP que o Claude mandar), os modelos ', el('code', {}, '.glb'), ' e o ZIP da dublagem do Estúdio.'),
  el('p', { class: 'nota' }, 'Fica tudo guardado neste navegador e funciona sem internet.'));
janela3d.append(legenda, caixaAguardar, dicaSimular, avisoEvento, gizmoModos, vazio,
  el('label', { class: 'seguir-cam', title: 'A câmera livre anda junto com o jogador (tocando ou indo a outro instante)' }, seguirCam, 'câmera segue o jogador'));
const linhaTempo = el('section', { class: 'linha-tempo', 'aria-label': 'Linha do tempo' });
const zoomMenos = el('button', { class: 'bt mini', type: 'button', title: 'Afastar (Ctrl + roda do mouse)', onclick: () => mudarZoom(estado.zoom / 1.4) }, '−');
const zoomMais = el('button', { class: 'bt mini', type: 'button', title: 'Aproximar (Ctrl + roda do mouse)', onclick: () => mudarZoom(estado.zoom * 1.4) }, '+');
const cabLinha = el('div', { class: 'lt-cab' },
  el('span', { class: 'rotulo' }, 'Linha do tempo'),
  el('span', { class: 'nota' }, 'Clique na régua para ir a um instante · arraste blocos · ', el('kbd', {}, 'Shift'), ' + arrastar empurra o resto · dois cliques criam'),
  el('span', { class: 'zoom' }, 'zoom ', zoomMenos, zoomMais));
const corpoLinha = el('div', { class: 'lt-corpo' });
linhaTempo.append(cabLinha, corpoLinha);

const rodape = el('footer', { class: 'rodape' },
  el('span', {}, `versão ${__VERSAO_APP__}`),
  el('button', { class: 'bt mini', type: 'button', onclick: () => void procurarAtualizacao() }, 'Procurar atualização'),
  el('span', { class: 'estado-offline' }, ''),
  el('span', { class: 'atalhos' }, el('kbd', {}, 'Espaço'), ' tocar · ', el('kbd', {}, '←'), el('kbd', {}, '→'), ' passo · ', el('kbd', {}, 'Del'), ' apagar · ', el('kbd', {}, 'Ctrl+Z'), ' desfazer · ', el('kbd', {}, 'F'), ' focar'));

app.append(barra, el('main', { class: 'area' }, esquerda, el('section', { class: 'centro' }, janela3d), direita), linhaTempo, rodape);

let modoGizmo: mundo.ModoGizmo = 'translate';
function desenharGizmoModos(): void {
  limpar(gizmoModos);
  if (estado.modo !== 'editar') return;
  const op: [mundo.ModoGizmo, string, string][] = [['translate', 'Mover', 'G'], ['rotate', 'Girar', 'T'], ['scale', 'Tamanho', 'Y']];
  for (const [m, n, k] of op) gizmoModos.append(el('button', { class: 'bt mini' + (modoGizmo === m ? ' on' : ''), type: 'button', title: `${n} (${k})`, onclick: () => { modoGizmo = m; desenharGizmoModos(); atualizarGizmo(); } }, n));
}

// ---------- tocar ----------
let ctxBase = 0;      // instante do relógio do áudio em que tBase acontece
let tBase = 0;
let tAnterior = 0;
let deltaJogador: THREE.Vector3 | null = null;

function tocar(): void {
  const c = cena(); if (!c) return;
  if (estado.aguardando) return;
  if (estado.tempo >= c.duracao - 0.01) buscar(0);
  contextoAudio();
  estado.tocando = true;
  tBase = estado.tempo; tAnterior = estado.tempo;
  ctxBase = tocador.tocarSom(c, tBase);
  deltaJogador = null;
  btTocar.textContent = '⏸ Pausar';
  atualizarGizmo();
}
function parar(): void {
  estado.tocando = false;
  tocador.pararSom();
  btTocar.textContent = '▶ Tocar';
  atualizarGizmo();
}
function alternar(): void {
  if (estado.aguardando) { liberarAguardar(); return; }
  if (estado.tocando) parar(); else tocar();
}

/** Vai a um instante. Os "aguardar" depois dele voltam a valer. */
function buscar(t: number): void {
  const c = cena(); if (!c) return;
  const estava = estado.tocando;
  if (estava) parar();
  estado.tempo = Math.min(Math.max(0, t), c.duracao);
  estado.aguardando = null;
  for (const k of [...estado.liberados]) if (parseFloat(k.split('@')[1]) >= estado.tempo - 1e-6) estado.liberados.delete(k);
  if (estava) tocar();
  avisar('tempo');
}

function aguardosDa(): { b: BlocoAguardar; faixa: string; indice: number }[] {
  const c = cena(); if (!c) return [];
  return c.faixas.flatMap((f) => (f.tipo === 'aguardar' ? f.blocos.map((b, indice) => ({ b, faixa: f.id, indice })) : []));
}
const chaveAguardar = (faixa: string, t: number) => `${faixa}@${t}`;

function liberarAguardar(): void {
  const a = estado.aguardando; if (!a) return;
  const c = cena(); if (!c) return;
  const f = c.faixas.find((x) => x.id === a.faixa);
  const b = f && f.tipo === 'aguardar' ? f.blocos[a.indice] : null;
  if (b) estado.liberados.add(chaveAguardar(a.faixa, b.t));
  estado.aguardando = null;
  caixaAguardar.hidden = true;
  tocar();
}

function mostrarAguardar(texto: string): void {
  limpar(caixaAguardar);
  caixaAguardar.append(el('span', { class: 'rotulo' }, 'Aguardando o jogador'), el('strong', {}, texto),
    el('button', { class: 'bt lima', type: 'button', onclick: () => liberarAguardar() }, 'Simular: ' + (texto || 'seguir')),
    estado.modo === 'simular' ? el('small', {}, 'ou faça isso andando pela cena') : '');
  caixaAguardar.hidden = false;
}

let eventoTimer = 0;
function mostrarEvento(nome: string): void {
  avisoEvento.textContent = '⚑ evento: ' + nome;
  avisoEvento.hidden = false;
  window.clearTimeout(eventoTimer);
  eventoTimer = window.setTimeout(() => { avisoEvento.hidden = true; }, 2500);
}

const fmtRelogio = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0').replace('.', ',')}`;
};

/** A cada quadro: avança o tempo e põe tudo no lugar. */
function quadro(): void {
  const c = cena();
  if (!c) return;
  if (estado.tocando) {
    const ctx = contextoAudio();
    let t = tBase + (ctx.currentTime - ctxBase);
    if (t < tBase) t = tBase; // o som ainda não começou (atraso de 50 ms)
    // eventos e aguardar que ficaram para trás neste quadro
    for (const f of c.faixas) if (f.tipo === 'evento') for (const b of f.blocos) if (b.t > tAnterior && b.t <= t) mostrarEvento(b.nome);
    const parada = aguardosDa().find(({ b, faixa }) => b.t >= tAnterior - 1e-6 && b.t <= t && !estado.liberados.has(chaveAguardar(faixa, b.t)));
    if (parada) {
      t = parada.b.t;
      parar();
      estado.aguardando = { texto: parada.b.condicao.texto, faixa: parada.faixa, indice: parada.indice };
      mostrarAguardar(parada.b.condicao.texto);
    }
    if (t >= c.duracao) { t = c.duracao; parar(); }
    estado.tempo = t; tAnterior = t;
  }
  aplicar(c, estado.tempo);
  if (estado.aguardando && estado.modo === 'simular') verificarCondicao();
  relogioTxt.textContent = `${fmtRelogio(estado.tempo)} / ${fmtRelogio(c.duracao)}`;
  moverCabeca(estado.tocando);
}

const ultimoJogador = new THREE.Vector3();
function aplicar(c: NonNullable<ReturnType<typeof cena>>, t: number): void {
  for (const o of c.cenario) {
    mundo.posicionar(o.id, o.pos, o.rotY, o.escala, true, o.rotX ?? 0);
    const inst = mundo.instancias.get(o.id);
    if (inst && o.animacao) mundo.animar(o.id, [{ clipe: o.animacao, tempo: t, peso: 1, loop: true }]);
  }
  const ativas = tocador.falasAtivas(c, t);
  // Gabu_IA no relógio: no Simular só aparece com o pulso levantado (R); no Editar aparece sempre
  const olhandoRelogio = estado.modo !== 'simular' || mundo.simulacao.relogio;
  const falando = new Map<string, number>();
  for (const b of ativas) { const a = tocador.atorDaFala(c, b); if (a) falando.set(a.id, tocador.nivelVoz(b.fala, t - b.t)); }
  for (const a of c.atores) {
    const p = tocador.poseAtor(c, a, t);
    const vis = tocador.visivelEm(c, a, t);
    mundo.posicionar(a.id, p.pos, p.rotY, p.escala, vis, a.rotX ?? 0);
    if (a.relogio) mundo.colocarNoRelogio(a.id, p.escala, vis && olhandoRelogio);
    const inst = mundo.instancias.get(a.id);
    if (inst && vis) mundo.animar(a.id, tocador.camadasEm(c, a, t, [...inst.clipes.keys()]), inst.boca.length ? tocador.bocaEm(c, a, t) : null);
    if (a.holograma) mundo.brilhar(a.id, falando.get(a.id) ?? 0);
  }
  const j = tocador.poseJogador(c, t);
  mundo.lugarDoJogador(j.pos, j.rotY);
  const pj = mundo.posicaoJogador();
  if (estado.modo === 'editar' && seguirCam.checked && deltaJogador) mundo.seguirComCamera(pj.clone().sub(ultimoJogador));
  deltaJogador = pj; ultimoJogador.copy(pj);
  mundo.apontar(tocador.setaEm(c, t), performance.now() / 1000);
  const leg = tocador.legendaEm(c, estado.pacote?.personagens ?? {}, t);
  if (leg) { legenda.replaceChildren(el('strong', {}, leg.quem + ': '), leg.texto); legenda.hidden = false; } else legenda.hidden = true;
  tocador.abaixarMusica(ativas.length > 0);
  mundo.textoRelogio(estado.aguardando?.texto ?? (leg ? leg.quem + ' falando' : ''));
  const relogioFalando = ativas.some((b) => tocador.atorDaFala(c, b)?.relogio);
  tocador.volumeDoRelogio(olhandoRelogio);
  mundo.piscarRelogio(relogioFalando && !olhandoRelogio);
  mundo.mostrarCaminhos(c.caminhos ?? [], estado.modo === 'editar');
  // anel amarelo do "chegar" selecionado
  const s = estado.selecao; const f = s ? c.faixas.find((x) => x.id === s.faixa) : undefined;
  const sel = f && f.tipo === 'aguardar' && s ? f.blocos[s.indice] : undefined;
  const ag = estado.aguardando ? aguardosDa().find((x) => x.faixa === estado.aguardando!.faixa && x.indice === estado.aguardando!.indice)?.b : undefined;
  const cd = (ag ?? sel)?.condicao;
  mundo.mostrarChegar(cd?.tipo === 'chegar' ? cd.pos : null, cd?.tipo === 'chegar' ? cd.raio : 1);
}

/** No Simular VR, a cena segue sozinha quando o jogador faz o que o "aguardar" pede. */
function verificarCondicao(): void {
  const a = estado.aguardando; if (!a) return;
  const b = aguardosDa().find((x) => x.faixa === a.faixa && x.indice === a.indice)?.b;
  if (!b) return;
  const cd = b.condicao;
  if (cd.tipo === 'chegar') {
    const p = mundo.posicaoJogador();
    if (Math.hypot(p.x - cd.pos[0], p.z - cd.pos[2]) <= cd.raio) liberarAguardar();
  } else if (cd.tipo === 'olhar') {
    const alvo = mundo.posicaoDe(cd.alvo);
    if (!alvo) return;
    const { origem, direcao } = mundo.olharDoJogador();
    const ang = THREE.MathUtils.radToDeg(direcao.angleTo(alvo.sub(origem).normalize()));
    if (ang <= cd.angulo) liberarAguardar();
  } else if (cd.tipo === 'relogio') {
    if (mundo.simulacao.relogio) liberarAguardar();
  }
}

// ---------- modos ----------
function trocarModo(m: 'editar' | 'simular'): void {
  if (estado.modo === m) return;
  estado.modo = m;
  btEditar.classList.toggle('on', m === 'editar');
  btSimular.classList.toggle('on', m === 'simular');
  const c = cena();
  if (m === 'simular') { mundo.entrarSimular(c ? tocador.poseJogador(c, estado.tempo).rotY : 0); dicaSimular.hidden = false; }
  else { mundo.sairSimular(); dicaSimular.hidden = true; }
  if (estado.aguardando) mostrarAguardar(estado.aguardando.texto);
  desenharGizmoModos();
  atualizarGizmo();
  mundo.telaDoMundo().focus();
}

function atualizarGizmo(): void {
  const id = estado.selecao ? (() => {
    const c = cena(); const f = c?.faixas.find((x) => x.id === estado.selecao!.faixa);
    return f && 'alvo' in f ? f.alvo : estado.atorSel;
  })() : estado.atorSel;
  mundo.selecionar3d(id || null, modoGizmo, estado.modo === 'editar' && !estado.tocando);
}

// ---------- desenhar tudo ----------
let montando = Promise.resolve();
let enquadrada = '';
function desenharTudo(): void {
  const p = estado.pacote;
  limpar(selCena);
  for (const c of p?.cenas ?? []) selCena.append(el('option', { value: c.id, selected: c.id === estado.cenaId }, c.nome));
  btDesfazer.disabled = false;
  desenharEsquerda();
  desenharDireita();
  desenharLinhaTempo();
  const c = cena();
  vazio.hidden = !!(c && (c.atores.length || c.cenario.length || biblioteca.modelos.size));
  if (c) montando = montando.then(() => mundo.montar(c)).then(() => {
    atualizarGizmo(); desenharEsquerda();
    if (enquadrada !== c.id) { enquadrada = c.id; aplicar(c, estado.tempo); mundo.enquadrarJogador(); }
  });
}

aoMudar((oQue) => {
  if (oQue === 'tempo') { moverCabeca(false); if (!estado.tocando) desenharDireita(); return; }
  desenharTudo();
});

// ---------- arquivos ----------
async function receber(arquivos: File[]): Promise<void> {
  if (!arquivos.length) return;
  aviso('Lendo arquivos…');
  try {
    const r = await importar(arquivos);
    mundo.esquecerModelos();
    if (r.pacote) {
      const temCenas = !!estado.pacote?.cenas.some((c) => c.atores.length || c.faixas.length);
      if (!temCenas || await confirmar('Abrir o pacote de cenas?', `"${r.pacote.projeto}" tem ${r.pacote.cenas.length} cena(s) e substitui as cenas abertas agora. Exporte antes se quiser guardar as atuais.`, 'Abrir pacote', false)) {
        parar();
        guardarParaDesfazer();
        estado.pacote = r.pacote;
        estado.cenaId = r.pacote.cenas[0]?.id ?? '';
        estado.tempo = 0; estado.selecao = null; estado.atorSel = ''; estado.liberados.clear(); estado.aguardando = null;
        mudou();
      }
    }
    const partes = [r.modelos && `${r.modelos} modelo(s)`, r.audios && `${r.audios} áudio(s)`, r.falas && `${r.falas} falas no roteiro`, r.pacote && 'pacote de cenas'].filter(Boolean);
    aviso(partes.length ? 'Recebido: ' + partes.join(', ') + '.' : 'Nenhum arquivo que o editor use.', partes.length ? 'ok' : 'erro');
    if (r.ignorados.length) console.info('Arquivos ignorados:', r.ignorados);
    await prepararAudio();
    desenharTudo();
  } catch (e) {
    console.error(e);
    aviso('Não deu para ler: ' + (e instanceof Error ? e.message : String(e)), 'erro');
  }
}

async function prepararAudio(): Promise<void> {
  const c = cena(); if (!c) return;
  const ids = [...tocador.falasDa(c).map((b) => b.fala), ...c.faixas.flatMap((f) => (f.tipo === 'som' ? f.blocos.map((b) => b.arquivo) : []))];
  await prepararFalas(ids.filter((id) => biblioteca.audios.has(id)));
}

function escolherArquivos(): void {
  const inp = el('input', { type: 'file', multiple: true, accept: '.zip,.json,.glb,.ogg,.wav,.mp3', style: 'display:none' });
  inp.addEventListener('change', () => { void receber([...(inp.files ?? [])]); inp.remove(); });
  document.body.append(inp);
  inp.click();
}

const camadaSoltar = el('div', { class: 'soltar', hidden: true }, el('p', {}, 'Solte para abrir no editor'));
document.body.append(camadaSoltar);
let arrastos = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { arrastos++; camadaSoltar.hidden = false; } });
window.addEventListener('dragleave', () => { arrastos = Math.max(0, arrastos - 1); if (!arrastos) camadaSoltar.hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); arrastos = 0; camadaSoltar.hidden = true;
  void receber([...(e.dataTransfer?.files ?? [])]);
});

function exportar(): void {
  const p = estado.pacote; if (!p) return;
  const nome = 'cenas_' + (p.projeto || 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^nave_do_gaburaverso$/, 'nave') + '.json';
  baixar(JSON.stringify(p, null, 2), nome, 'application/json');
  aviso(`Exportado ${nome}. Mande este arquivo para o Claude.`, 'ok');
}

// ---------- ajustes, atualização e cache ----------
async function abrirAjustes(): Promise<void> {
  const forcar = await lerConfig<boolean | null>('modo_leve');
  const sel = el('select', { class: 'campo', id: 'aj-leve' },
    el('option', { value: 'auto', selected: forcar === null || forcar === undefined }, 'Automático'),
    el('option', { value: 'sim', selected: forcar === true }, 'Ligado (notebook sem placa de vídeo)'),
    el('option', { value: 'nao', selected: forcar === false }, 'Desligado (qualidade cheia)'));
  sel.addEventListener('change', () => {
    const v = sel.value === 'auto' ? null : sel.value === 'sim';
    void salvarConfig('modo_leve', v);
    if (v !== null) mundo.trocarLeve(v);
    else aviso('Automático vale na próxima vez que abrir o editor.', 'info');
  });
  const nomeProj = el('input', { class: 'campo', id: 'aj-proj', value: estado.pacote?.projeto ?? '' });
  nomeProj.addEventListener('change', () => { if (estado.pacote) { guardarParaDesfazer(); estado.pacote.projeto = nomeProj.value.trim() || estado.pacote.projeto; mudou(); } });
  const corpo = el('div', { class: 'modal-corpo' },
    el('h3', {}, 'Ajustes'),
    el('div', { class: 'campo-linha' }, el('label', { for: 'aj-proj', class: 'rotulo' }, 'Projeto'), nomeProj),
    el('div', { class: 'campo-linha' }, el('label', { for: 'aj-leve', class: 'rotulo' }, 'Modo leve'), sel),
    el('p', { class: 'nota' }, `Placa de vídeo: ${mundo.nomePlaca()}. Modo leve agora: ${mundo.leve ? 'ligado' : 'desligado'}.`),
    el('p', { class: 'nota' }, `Guardados neste navegador: ${biblioteca.modelos.size} modelo(s), ${biblioteca.audios.size} áudio(s), ${biblioteca.falas.size} falas.`),
    el('div', { class: 'modal-bts esquerda' },
      el('button', { class: 'bt', type: 'button', onclick: () => { j.fechar(); void procurarAtualizacao(); } }, 'Procurar atualização'),
      el('button', { class: 'bt', type: 'button', onclick: () => { j.fechar(); void limparCacheDoApp(); } }, 'Limpar cache do app'),
      el('button', { class: 'bt perigo', type: 'button', onclick: () => { j.fechar(); void esquecerArquivos(); } }, 'Apagar arquivos guardados')),
    el('div', { class: 'modal-bts' }, el('button', { class: 'bt lima', type: 'button', onclick: () => j.fechar() }, 'Fechar')));
  const j = abrirJanela(corpo);
}

async function esquecerArquivos(): Promise<void> {
  if (!await confirmar('Apagar os arquivos guardados?', 'Saem do navegador os modelos, falas e sons que você arrastou. As cenas continuam. Depois é só arrastar os arquivos de novo.')) return;
  await limparBiblioteca();
  mundo.esquecerModelos();
  desenharTudo();
  aviso('Arquivos apagados do navegador.', 'ok');
}

let registro: ServiceWorkerRegistration | null = null;
const estadoOffline = rodape.querySelector<HTMLElement>('.estado-offline')!;
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').then(async (reg) => {
    registro = reg;
    await navigator.serviceWorker.ready;
    estadoOffline.textContent = 'pronto para usar sem internet';
    reg.addEventListener('updatefound', () => { estadoOffline.textContent = 'baixando versão nova…'; });
  }).catch(() => { estadoOffline.textContent = 'modo offline indisponível'; });
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregou) return;
    recarregou = true;
    location.reload();
  });
}

async function procurarAtualizacao(): Promise<void> {
  if (!registro) { location.reload(); return; }
  aviso('Procurando atualização…', 'info');
  try {
    await registro.update();
    const nova = registro.installing ?? registro.waiting;
    if (nova) { nova.postMessage('pular-espera'); aviso('Versão nova encontrada. Recarregando…', 'ok'); }
    else aviso('Você já está na versão mais nova.', 'ok');
  } catch { aviso('Sem internet agora: continue usando a versão guardada.', 'erro'); }
}

/** Apaga só a cópia do app guardada para uso offline. Cenas e arquivos NÃO são apagados. */
async function limparCacheDoApp(): Promise<void> {
  const ok = await confirmar('Limpar o cache do app?', 'O editor será baixado de novo da internet. Suas cenas e os arquivos que você arrastou continuam guardados neste computador.', 'Limpar e recarregar', false);
  if (!ok) return;
  for (const r of await navigator.serviceWorker?.getRegistrations?.() ?? []) await r.unregister();
  for (const n of await caches.keys()) await caches.delete(n);
  location.reload();
}

// ---------- teclado ----------
window.addEventListener('keydown', (e) => {
  const alvo = e.target as HTMLElement;
  if (alvo.closest('input, textarea, select, .modal')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const c = cena();
  if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); desfazerUltimo(); return; }
  if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); refazerUltimo(); return; }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); exportar(); return; }
  if (e.key === ' ') { e.preventDefault(); alternar(); return; }
  if (e.key === 'Enter' && estado.aguardando) { e.preventDefault(); liberarAguardar(); return; }
  if (e.key === 'Home') { e.preventDefault(); buscar(0); return; }
  if (e.key === 'End' && c) { e.preventDefault(); buscar(c.duracao); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const passo = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
    buscar(Math.round((estado.tempo + passo) * 100) / 100);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (estado.selecao && estado.selecao.indice >= 0) { e.preventDefault(); apagarSelecionado(); } return; }
  if (estado.modo !== 'editar') return;
  const k = e.key.toLowerCase();
  if (k === 'g' || k === 't' || k === 'y') { modoGizmo = k === 'g' ? 'translate' : k === 't' ? 'rotate' : 'scale'; desenharGizmoModos(); atualizarGizmo(); }
  if (k === 'f') {
    const id = estado.atorSel;
    const p = id === 'jogador' ? mundo.posicaoJogador().add(new THREE.Vector3(0, 1, 0)) : id ? mundo.posicaoDe(id) : null;
    if (p) mundo.focar(p);
  }
});
// o espaço não "clica" no último botão apertado
window.addEventListener('keyup', (e) => { if (e.key === ' ' && (e.target as HTMLElement).tagName === 'BUTTON') e.preventDefault(); });

// ---------- início ----------
async function iniciar(): Promise<void> {
  await carregarBiblioteca();
  let p = await lerConfig<Pacote>('pacote');
  if (!p) p = { versao_formato: 1, projeto: 'Nave do Gaburaverso', personagens: {}, cenas: [novaCena()] };
  estado.pacote = p;
  estado.cenaId = (await lerConfig<string>('cena_aberta')) ?? p.cenas[0]?.id ?? '';
  if (!cena()) estado.cenaId = p.cenas[0]?.id ?? '';
  const leve = await lerConfig<boolean | null>('modo_leve');
  janela3d.addEventListener('portas', (e) => aviso((e as CustomEvent<boolean>).detail ? 'Portas abertas: dá para passar.' : 'Portas fechadas: seguram como parede (P abre).', 'info'));
  janela3d.addEventListener('colisao', (e) => aviso((e as CustomEvent<boolean>).detail ? 'Paredes seguram o jogador.' : 'Atravessando paredes (C liga de novo).', 'info'));
  mundo.iniciarMundo(janela3d, {
    quadro,
    selecionar: (id) => {
      if (estado.modo !== 'editar') return;
      estado.atorSel = id; estado.selecao = null; avisar();
    },
    moveu: (id, pos, rotY, escala) => gravarPosicao(id, pos, rotY, escala),
  }, leve ?? null);
  criarPaineis(esquerda, direita);
  criarLinhaTempo(corpoLinha, {
    buscar,
    novoItem,
    novaFaixa: janelaNovaFaixa,
    apagarFaixa: (f) => void apagarFaixa(f),
  });
  let cenaAntes = estado.cenaId;
  aoMudar(() => {
    void salvarConfig('cena_aberta', estado.cenaId);
    atualizarGizmo();
    if (estado.cenaId !== cenaAntes) { cenaAntes = estado.cenaId; parar(); estado.aguardando = null; caixaAguardar.hidden = true; estado.liberados.clear(); void prepararAudio().then(() => desenharTudo()); }
  });
  desenharGizmoModos();
  desenharTudo();
  await prepararAudio();
  desenharTudo();
  // para os testes automáticos
  (window as unknown as Record<string, unknown>).__editor = { estado, buscar, tocar, parar, trocarModo, liberarAguardar, itensDe, mundo, gravarPosicao };
}
void iniciar().catch((e) => {
  console.error(e);
  app.append(el('p', { class: 'carregando' }, 'O editor não abriu: ' + (e instanceof Error ? e.message : String(e))));
});

/** Lista das falas por evento (as que não têm hora marcada numa cena), por sala, com botão para ouvir. */
const MODOS_EVENTO = { sorteio: 'sorteia uma (sem repetir a anterior)', sequencia: 'uma depois da outra', uma_vez: 'toca uma vez só' } as const;
function abrirFalasPorEvento(): void {
  const lista = estado.pacote?.falas_por_evento ?? [];
  const nomes = estado.pacote?.personagens ?? {};
  const salas = [...new Set(lista.map((e) => e.sala))];
  const corpo = el('div', { class: 'modal-corpo eventos' },
    el('h3', {}, 'Falas por evento'),
    el('p', { class: 'nota' }, 'Estas falas não ficam na linha do tempo: o jogo toca quando o gatilho acontece. Clique em ▶ para ouvir.'),
    lista.length ? null : el('p', {}, 'Este pacote ainda não tem falas por evento.'),
    ...salas.map((sala) => el('section', { class: 'evento-sala' },
      el('h4', {}, sala),
      ...lista.filter((e) => e.sala === sala).map((e) => el('div', { class: 'evento-item' },
        el('div', { class: 'evento-topo' }, el('strong', {}, e.quando), el('span', { class: 'nota' }, ` · ${MODOS_EVENTO[e.modo] ?? e.modo} · `, el('code', {}, e.id))),
        e.nota ? el('p', { class: 'nota' }, e.nota) : null,
        ...e.falas.map((id) => {
          const info = biblioteca.falas.get(id);
          const quem = nomes[info?.personagem ?? e.ator ?? ''] ?? info?.personagem ?? e.ator ?? '';
          const bt = el('button', { class: 'bt mini', type: 'button', title: 'Ouvir', onclick: () => { if (!tocador.ouvirFala(id)) aviso('O áudio desta fala não está no editor (arraste o ZIP da dublagem).', 'info'); } }, '▶');
          return el('div', { class: 'evento-fala' }, bt, el('span', {}, el('strong', {}, quem ? quem + ': ' : ''), info?.texto ?? id),
            el('span', { class: 'nota' }, info ? ` ${info.duracao.toFixed(1).replace('.', ',')} s` : ' (sem áudio)'));
        }))))),
    el('div', { class: 'modal-bts' }, el('button', { class: 'bt lima', type: 'button', onclick: () => j.fechar() }, 'Fechar')));
  const j = abrirJanela(corpo);
}
