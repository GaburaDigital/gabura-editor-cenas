// A linha do tempo (como o AnimationPlayer da Godot): uma pista por faixa, blocos e pontos-chave
// que você arrasta. Shift + arrastar empurra junto tudo o que vem depois, em todas as faixas.

import { biblioteca } from './arquivos';
import { cena, estado, guardarParaDesfazer, mudou, avisar } from './estado';
import { COR_FAIXA, NOME_TIPO, type Cena, type Faixa, type Pacote } from './modelo';
import { duracaoItem, somFalta } from './tocador';
import { el, limpar } from './dom';

const LARGURA_NOMES = 190;
const PASSO = 0.05; // ímã de 0,05 s (segure Alt para soltar livre)

export interface AcoesLinhaTempo { buscar(t: number): void; novoItem(f: Faixa, t: number): void; novaFaixa(): void; apagarFaixa(f: Faixa): void; }

let raiz: HTMLElement;
let rolagem: HTMLElement;
let cabeca: HTMLElement;
let acoes: AcoesLinhaTempo;

export function itensDe(f: Faixa): { t: number }[] {
  return 'chaves' in f ? f.chaves : f.blocos;
}

export function criarLinhaTempo(container: HTMLElement, a: AcoesLinhaTempo): void {
  raiz = container; acoes = a;
  rolagem = el('div', { class: 'lt-rolagem' });
  raiz.append(rolagem);
  rolagem.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = rolagem.getBoundingClientRect();
    const tMouse = (e.clientX - r.left - LARGURA_NOMES + rolagem.scrollLeft) / estado.zoom;
    mudarZoom(estado.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
    rolagem.scrollLeft = tMouse * estado.zoom - (e.clientX - r.left - LARGURA_NOMES);
  }, { passive: false });
}

export function mudarZoom(z: number): void {
  estado.zoom = Math.min(240, Math.max(4, z));
  desenharLinhaTempo();
}

const fmt = (t: number) => t.toFixed(1).replace('.', ',');

function rotulo(f: Faixa, i: number): string {
  switch (f.tipo) {
    case 'mover': return '';
    case 'visivel': return f.chaves[i].visivel ? 'mostra' : 'esconde';
    case 'animacao': return f.blocos[i].clipe + (f.blocos[i].loop ? ' ↻' : '');
    case 'fala': { const id = f.blocos[i].fala; const info = biblioteca.falas.get(id); return info ? `${id} · ${info.texto}` : id; }
    case 'som': return f.blocos[i].arquivo + (somFalta(f.blocos[i].arquivo) ? ' (espaço reservado)' : '');
    case 'seta': return '➜ ' + f.blocos[i].alvo;
    case 'aguardar': return '⏸ ' + (f.blocos[i].condicao.texto || f.blocos[i].condicao.tipo);
    case 'evento': return '⚑ ' + f.blocos[i].nome;
  }
}

function nomeAlvo(c: Cena, id: string): string {
  if (id === 'jogador') return 'Jogador';
  return c.atores.find((a) => a.id === id)?.nome ?? c.cenario.find((o) => o.id === id)?.id ?? id;
}

export function desenharLinhaTempo(): void {
  const c = cena();
  const rolX = rolagem.scrollLeft, rolY = rolagem.scrollTop;
  limpar(rolagem);
  if (!c) { rolagem.append(el('p', { class: 'nota lt-vazia' }, 'Abra ou crie uma cena para ver a linha do tempo.')); return; }
  const largura = Math.max(c.duracao + 4, 10) * estado.zoom;
  const conteudo = el('div', { class: 'lt-conteudo', style: `width:${LARGURA_NOMES + largura}px` });

  // régua
  const regua = el('div', { class: 'lt-linha lt-linha-regua' },
    el('div', { class: 'lt-nome lt-nome-regua' },
      el('button', { class: 'bt mini', title: 'Adicionar faixa', onclick: () => acoes.novaFaixa() }, '+ Faixa')));
  const pistaRegua = el('div', { class: 'lt-pista lt-regua', style: `width:${largura}px` });
  const passoMarca = estado.zoom >= 60 ? 1 : estado.zoom >= 20 ? 5 : estado.zoom >= 8 ? 10 : 30;
  for (let s = 0; s <= c.duracao + 4; s += passoMarca) {
    pistaRegua.append(el('span', { class: 'lt-marca', style: `left:${s * estado.zoom}px` }, String(s)));
  }
  pistaRegua.append(el('div', { class: 'lt-fim', style: `left:${c.duracao * estado.zoom}px`, title: 'Fim da cena' }));
  arrastarTempo(pistaRegua);
  regua.append(pistaRegua);
  conteudo.append(regua);

  for (const f of c.faixas) conteudo.append(linhaFaixa(c, f, largura));

  cabeca = el('div', { class: 'lt-cabeca' });
  conteudo.append(cabeca);
  rolagem.append(conteudo);
  rolagem.scrollLeft = rolX; rolagem.scrollTop = rolY;
  moverCabeca(false);
}

function linhaFaixa(c: Cena, f: Faixa, largura: number): HTMLElement {
  const cor = COR_FAIXA[f.tipo];
  const alvo = 'alvo' in f ? ` · ${nomeAlvo(c, f.alvo)}` : '';
  const nome = el('div', { class: 'lt-nome', title: `${NOME_TIPO[f.tipo]}${alvo}\nDuplo clique na pista para adicionar` },
    el('span', { class: 'bolinha', style: `background:${cor}` }),
    el('span', { class: 'lt-nome-texto' }, f.nome || NOME_TIPO[f.tipo]),
    el('button', { class: 'lt-x', title: 'Apagar faixa', onclick: () => acoes.apagarFaixa(f) }, '×'));
  nome.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.lt-x')) return;
    estado.selecao = { faixa: f.id, indice: -1 };
    if ('alvo' in f && f.alvo) estado.atorSel = f.alvo;
    avisar();
  });
  if (estado.selecao?.faixa === f.id && estado.selecao.indice === -1) nome.classList.add('on');

  const pista = el('div', { class: 'lt-pista', style: `width:${largura}px` });
  pista.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.lt-item')) return;
    const r = pista.getBoundingClientRect();
    acoes.novoItem(f, ima((e.clientX - r.left) / estado.zoom, e.altKey));
  });
  const lista = itensDe(f);
  // trechos de movimento entre os pontos-chave
  if (f.tipo === 'mover') {
    for (let i = 0; i < f.chaves.length - 1; i++) {
      const a = f.chaves[i], b = f.chaves[i + 1];
      pista.append(el('div', { class: 'lt-trecho' + (a.curva === 'suave' ? ' suave' : ''), style: `left:${a.t * estado.zoom}px;width:${(b.t - a.t) * estado.zoom}px;background:${cor}` }));
    }
  }
  lista.forEach((item, i) => {
    const dur = duracaoItem(f, i);
    const sel = estado.selecao?.faixa === f.id && estado.selecao.indice === i;
    const ponto = dur === 0;
    const falta = (f.tipo === 'fala' && !biblioteca.audios.has(f.blocos[i].fala)) || (f.tipo === 'som' && somFalta(f.blocos[i].arquivo));
    const div = el('div', {
      class: `lt-item ${ponto ? 'ponto' : 'bloco'} ${sel ? 'on' : ''} ${falta ? 'falta' : ''} tipo-${f.tipo}`,
      style: `left:${item.t * estado.zoom}px;${ponto ? '' : `width:${Math.max(4, dur * estado.zoom)}px;`}--cor:${cor}`,
      title: `${rotulo(f, i) || NOME_TIPO[f.tipo]}\n${fmt(item.t)} s${ponto ? '' : ` → ${fmt(item.t + dur)} s (${fmt(dur)} s)`}\nArraste para mudar · Shift + arrastar empurra o resto da cena`,
    });
    if (ponto) div.append(el('span', { class: 'lt-losango' }));
    const txt = rotulo(f, i);
    if (txt) div.append(el('span', { class: 'lt-rotulo' }, txt));
    if (!ponto && f.tipo !== 'fala') {
      const alca = el('span', { class: 'lt-alca', title: 'Arraste para mudar a duração' });
      alca.addEventListener('pointerdown', (e) => { e.stopPropagation(); redimensionar(e, f, i); });
      div.append(alca);
    }
    div.addEventListener('pointerdown', (e) => arrastarItem(e, f, i));
    pista.append(div);
  });
  return el('div', { class: 'lt-linha' }, nome, pista);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ima = (t: number, livre: boolean) => Math.max(0, livre ? +t.toFixed(3) : Math.round(t / PASSO) * PASSO);

/** Clique ou arraste na régua para ir a um instante. */
function arrastarTempo(pista: HTMLElement): void {
  pista.addEventListener('pointerdown', (e) => {
    const r = pista.getBoundingClientRect();
    const ir = (x: number) => acoes.buscar(Math.max(0, (x - r.left) / estado.zoom));
    ir(e.clientX);
    const mover = (ev: PointerEvent) => ir(ev.clientX);
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  });
}

/** Arrasta um bloco ou ponto. Com Shift, tudo o que começa depois dele (em todas as faixas) vai junto. */
function arrastarItem(e: PointerEvent, f: Faixa, i: number): void {
  if (e.button !== 0) return;
  e.preventDefault();
  estado.selecao = { faixa: f.id, indice: i };
  if ('alvo' in f && f.alvo) estado.atorSel = f.alvo;
  const c = cena()!;
  const original = JSON.parse(JSON.stringify(estado.pacote)) as Pacote;
  const tInicial = itensDe(f)[i].t;
  const empurrar = e.shiftKey;
  const x0 = e.clientX;
  let mexeu = false;
  avisar();
  const mover = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (!mexeu && Math.abs(dx) < 3) return;
    if (!mexeu) { guardarParaDesfazer(); mexeu = true; }
    const delta = ima(tInicial + dx / estado.zoom, ev.altKey) - tInicial;
    const cOrig = original.cenas.find((x) => x.id === c.id)!;
    c.faixas.forEach((fx, fi) => {
      const lo = itensDe(cOrig.faixas[fi]);
      const la = itensDe(fx);
      la.forEach((it, ii) => {
        const t0 = lo[ii].t;
        if (fx.id === f.id && ii === i) it.t = r3(Math.max(0, t0 + delta));
        else if (empurrar && t0 >= tInicial - 1e-6) it.t = r3(Math.max(0, t0 + delta));
      });
    });
    if (empurrar && delta > 0) c.duracao = r3(Math.max(cOrig.duracao, cOrig.duracao + delta));
    avisar();
  };
  const soltar = () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    if (!mexeu) { acoes.buscar(estado.tempo); return; }
    const alvoObj = itensDe(f)[i];
    for (const fx of c.faixas) itensDe(fx).sort((a, b) => a.t - b.t);
    estado.selecao = { faixa: f.id, indice: itensDe(f).indexOf(alvoObj) };
    mudou();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
}

function redimensionar(e: PointerEvent, f: Faixa, i: number): void {
  e.preventDefault();
  const bloco = (f as Extract<Faixa, { blocos: { dur: number }[] }>).blocos[i] as { t: number; dur: number };
  const d0 = bloco.dur, x0 = e.clientX;
  let mexeu = false;
  const mover = (ev: PointerEvent) => {
    if (!mexeu) { guardarParaDesfazer(); mexeu = true; }
    bloco.dur = r3(Math.max(0.1, ima(d0 + (ev.clientX - x0) / estado.zoom, ev.altKey)));
    avisar();
  };
  const soltar = () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    if (mexeu) mudou();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
}

/** Move só a linha vermelha do tempo (barato: roda a cada quadro). */
export function moverCabeca(seguir: boolean): void {
  if (!cabeca) return;
  const x = LARGURA_NOMES + estado.tempo * estado.zoom;
  cabeca.style.left = `${x}px`;
  if (seguir) {
    const vis = rolagem.clientWidth - LARGURA_NOMES;
    const rel = estado.tempo * estado.zoom - rolagem.scrollLeft;
    if (rel > vis - 40 || rel < 0) rolagem.scrollLeft = Math.max(0, estado.tempo * estado.zoom - 60);
  }
}
