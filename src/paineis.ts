// Os dois painéis laterais: à esquerda a biblioteca (cenas, o que está na cena, modelos, falas, sons);
// à direita as propriedades do que está selecionado.

import { biblioteca, duracaoFala } from './arquivos';
import { cena, estado, guardarParaDesfazer, mudou, avisar } from './estado';
import { confirmar, el, limpar, pedirTexto, seg } from './dom';
import { itensDe } from './linha_tempo';
import { NOME_TIPO, type Ator, type Condicao, type Faixa, type Vec3 } from './modelo';
import { clipesDe, instancias } from './mundo';
import {
  adicionarAtor, adicionarCenario, adicionarFala, adicionarSom, ajustarDuracao, apagarAtor, apagarSelecionado,
  encadearFalas, novaCena,
} from './operacoes';
import { duracaoItem, falasDa, poseAtor, poseJogador } from './tocador';

let esquerda: HTMLElement;
let direita: HTMLElement;
let busca = '';
const abertos = new Set(['cenas', 'na_cena', 'modelos', 'falas', 'sons']);

export function criarPaineis(e: HTMLElement, d: HTMLElement): void { esquerda = e; direita = d; }

function secao(id: string, titulo: string, contagem: number | string, ...filhos: (Node | null)[]): HTMLElement {
  const det = el('details', { class: 'secao', open: abertos.has(id) },
    el('summary', {}, titulo, el('span', { class: 'contagem' }, String(contagem))), ...filhos);
  det.addEventListener('toggle', () => { if (det.open) abertos.add(id); else abertos.delete(id); });
  return det;
}

// ---------- esquerda ----------
export function desenharEsquerda(): void {
  const rolar = esquerda.scrollTop;
  limpar(esquerda);
  const p = estado.pacote;
  const c = cena();
  if (p) {
    esquerda.append(secao('cenas', 'Cenas', p.cenas.length,
      el('div', { class: 'lista' }, p.cenas.map((x) => el('button', {
        class: 'item-lista' + (x.id === estado.cenaId ? ' on' : ''),
        onclick: () => { estado.cenaId = x.id; estado.selecao = null; estado.atorSel = ''; estado.tempo = 0; avisar(); },
      }, el('span', { class: 'item-nome' }, x.nome), el('small', {}, seg(x.duracao))))),
      el('button', { class: 'bt mini', onclick: criarCena }, '+ Cena nova')));
  }
  if (c) {
    const item = (id: string, nome: string, cor: string, extra = '') => el('button', {
      class: 'item-lista' + (estado.atorSel === id && !estado.selecao ? ' on' : ''),
      onclick: () => { estado.atorSel = id; estado.selecao = null; avisar(); },
    }, el('span', { class: 'bolinha', style: `background:${cor}` }), el('span', { class: 'item-nome' }, nome), extra ? el('small', {}, extra) : null);
    esquerda.append(secao('na_cena', 'Na cena', c.atores.length + c.cenario.length + 1,
      el('div', { class: 'lista' },
        item('jogador', 'Jogador', '#8fd651', 'anel lima'),
        c.atores.map((a) => item(a.id, a.nome, a.cor, a.holograma ? 'holograma' : instancias.get(a.id)?.falta ? 'sem modelo' : '')),
        c.cenario.map((o) => item(o.id, o.id, '#4a6878', instancias.get(o.id)?.falta ? 'sem modelo' : 'cenário')))));
  }
  const modelos = [...biblioteca.modelos.keys()].sort();
  esquerda.append(secao('modelos', 'Modelos', modelos.length,
    modelos.length ? el('div', { class: 'lista' }, modelos.map((m) => el('div', { class: 'item-lista estatico' },
      el('span', { class: 'item-nome', title: m }, m),
      c ? el('button', { class: 'bt mini', title: 'Adicionar como ator (pode mover, animar e falar)', onclick: () => adicionarAtor(m) }, '+ ator') : null,
      c ? el('button', { class: 'bt mini', title: 'Adicionar ao cenário (fica parado)', onclick: () => adicionarCenario(m) }, '+ cenário') : null,
    ))) : el('p', { class: 'nota' }, 'Arraste arquivos .glb para cá.')));

  const falas = [...biblioteca.falas.values()].filter((f) => !busca || (f.id + ' ' + f.texto).toLowerCase().includes(busca.toLowerCase()));
  const usadas = new Set(c ? falasDa(c).map((b) => b.fala) : []);
  const campoBusca = el('input', { class: 'campo mini', type: 'search', placeholder: 'Procurar fala…', value: busca, 'aria-label': 'Procurar fala' });
  campoBusca.addEventListener('input', () => { busca = campoBusca.value; desenharEsquerda(); campoFoco(); });
  esquerda.append(secao('falas', 'Falas', biblioteca.falas.size,
    biblioteca.falas.size ? campoBusca : el('p', { class: 'nota' }, 'Arraste o ZIP da dublagem (do Estúdio) para cá.'),
    el('div', { class: 'lista falas' }, falas.slice(0, 200).map((f) => el('button', {
      class: 'item-lista' + (usadas.has(f.id) ? ' usada' : ''),
      title: `${f.texto}\n\nClique para colocar na linha do tempo, no instante da linha vermelha.`,
      onclick: () => adicionarFala(f.id),
    }, el('span', { class: 'item-nome' }, f.id), el('small', {}, seg(duracaoFala(f.id)))))),
  ));
  const sons = [...biblioteca.audios.keys()].filter((k) => !biblioteca.falas.has(k)).sort();
  esquerda.append(secao('sons', 'Sons e música', sons.length,
    sons.length ? el('div', { class: 'lista' }, sons.map((s) => el('button', { class: 'item-lista', onclick: () => adicionarSom(s) },
      el('span', { class: 'item-nome' }, s)))) : el('p', { class: 'nota' }, 'Ainda sem sons. Uma música que falta aparece como "espaço reservado" e a cena toca em silêncio.')));
  esquerda.scrollTop = rolar;
}
function campoFoco(): void {
  const c = esquerda.querySelector<HTMLInputElement>('input[type=search]');
  if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }
}

async function criarCena(): Promise<void> {
  const p = estado.pacote; if (!p) return;
  const nome = await pedirTexto('Cena nova', 'Nome da cena', 'Cena nova');
  if (!nome) return;
  guardarParaDesfazer();
  const c = novaCena();
  c.nome = nome;
  c.id = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cena';
  let n = 2; const base = c.id; while (p.cenas.some((x) => x.id === c.id)) c.id = `${base}_${n++}`;
  p.cenas.push(c);
  estado.cenaId = c.id; estado.tempo = 0; estado.selecao = null;
  mudou();
}

// ---------- campos ----------
let contador = 0;
type Mudar<T> = (v: T) => void;
/** Toda alteração passa por aqui: guarda para o Ctrl+Z, muda e redesenha. */
function alterar(f: () => void): void { guardarParaDesfazer(); f(); mudou(); }

function num(rotulo: string, valor: number, mudar: Mudar<number>, passo = 0.1, extra?: { min?: number; max?: number; unidade?: string }): HTMLElement {
  const id = 'c' + contador++;
  const inp = el('input', { id, class: 'campo num', type: 'number', step: String(passo), value: String(+valor.toFixed(3)), min: extra?.min, max: extra?.max });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value.replace(',', '.')); if (Number.isFinite(v)) alterar(() => mudar(v)); });
  return el('div', { class: 'campo-linha' }, el('label', { for: id, class: 'rotulo' }, rotulo), el('div', { class: 'com-unidade' }, inp, extra?.unidade ? el('span', {}, extra.unidade) : null));
}
function vec(rotulo: string, v: Vec3, mudar: Mudar<Vec3>): HTMLElement {
  const caixa = el('div', { class: 'vec' });
  ['x', 'y', 'z'].forEach((eixo, i) => {
    const inp = el('input', { class: 'campo num', type: 'number', step: '0.05', value: String(+v[i].toFixed(3)), 'aria-label': `${rotulo} ${eixo}`, title: eixo });
    inp.addEventListener('change', () => { const n = parseFloat(inp.value); if (!Number.isFinite(n)) return; const nv = [...v] as Vec3; nv[i] = n; alterar(() => mudar(nv)); });
    caixa.append(el('label', { class: 'eixo' }, eixo, inp));
  });
  return el('div', { class: 'campo-linha' }, el('span', { class: 'rotulo' }, rotulo), caixa);
}
function texto(rotulo: string, valor: string, mudar: Mudar<string>, dica?: string): HTMLElement {
  const id = 'c' + contador++;
  const inp = el('input', { id, class: 'campo', type: 'text', value: valor, title: dica });
  inp.addEventListener('change', () => alterar(() => mudar(inp.value.trim())));
  return el('div', { class: 'campo-linha' }, el('label', { for: id, class: 'rotulo' }, rotulo), inp);
}
function escolha(rotulo: string, valor: string, opcoes: [string, string][], mudar: Mudar<string>): HTMLElement {
  const id = 'c' + contador++;
  if (valor && !opcoes.some(([v]) => v === valor)) opcoes = [[valor, valor + ' (não encontrado)'], ...opcoes];
  const sel = el('select', { id, class: 'campo' }, opcoes.map(([v, n]) => el('option', { value: v, selected: v === valor }, n)));
  sel.addEventListener('change', () => alterar(() => mudar(sel.value)));
  return el('div', { class: 'campo-linha' }, el('label', { for: id, class: 'rotulo' }, rotulo), sel);
}
function marca(rotulo: string, valor: boolean, mudar: Mudar<boolean>, dica?: string): HTMLElement {
  const inp = el('input', { type: 'checkbox', checked: valor });
  inp.addEventListener('change', () => alterar(() => mudar(inp.checked)));
  return el('label', { class: 'marca', title: dica }, inp, rotulo);
}
function cor(rotulo: string, valor: string, mudar: Mudar<string>): HTMLElement {
  const id = 'c' + contador++;
  const inp = el('input', { id, type: 'color', value: valor, class: 'cor' });
  inp.addEventListener('change', () => alterar(() => mudar(inp.value)));
  return el('div', { class: 'campo-linha' }, el('label', { for: id, class: 'rotulo' }, rotulo), inp);
}
/** Lista de clipes do modelo (lida do .glb). */
function escolhaClipe(rotulo: string, valor: string, modelo: string, mudar: Mudar<string>, vazio?: string): HTMLElement {
  const caixa = el('div', {});
  const montar = (clipes: string[]) => {
    limpar(caixa);
    const op: [string, string][] = clipes.map((c) => [c, c]);
    if (vazio !== undefined) op.unshift(['', vazio]);
    caixa.append(clipes.length || vazio !== undefined ? escolha(rotulo, valor, op, mudar) : texto(rotulo, valor, mudar));
  };
  montar([]);
  void clipesDe(modelo).then(montar);
  return caixa;
}

function alvosDaCena(): [string, string][] {
  const c = cena(); if (!c) return [];
  return [...c.atores.map((a) => [a.id, a.nome] as [string, string]), ...c.cenario.map((o) => [o.id, o.id + ' (cenário)'] as [string, string])];
}
const fmtT = (t: number) => t.toFixed(2).replace('.', ',') + ' s';

// ---------- direita ----------
export function desenharDireita(): void {
  limpar(direita);
  const c = cena();
  if (!c) { direita.append(el('p', { class: 'nota' }, 'Nenhuma cena aberta.')); return; }
  const s = estado.selecao;
  const f = s ? c.faixas.find((x) => x.id === s.faixa) : undefined;
  if (f && s && s.indice >= 0 && itensDe(f)[s.indice]) direita.append(...painelItem(f, s.indice));
  else if (f) direita.append(...painelFaixa(f));
  else if (estado.atorSel === 'jogador') direita.append(...painelJogador());
  else if (estado.atorSel && c.atores.some((a) => a.id === estado.atorSel)) direita.append(...painelAtor(c.atores.find((a) => a.id === estado.atorSel)!));
  else if (estado.atorSel && c.cenario.some((o) => o.id === estado.atorSel)) direita.append(...painelCenario(estado.atorSel));
  else direita.append(...painelCena());
}

function titulo(tipo: string, nome: string, cor?: string): HTMLElement {
  return el('div', { class: 'prop-titulo' }, el('span', { class: 'rotulo' }, cor ? el('span', { class: 'bolinha', style: `background:${cor}` }) : null, ' ', tipo), el('h3', {}, nome));
}

function painelCena(): HTMLElement[] {
  const c = cena()!; const p = estado.pacote!;
  const notas = el('textarea', { class: 'campo', rows: 4, id: 'notas-cena' }, c.notas ?? '');
  notas.addEventListener('change', () => alterar(() => { c.notas = notas.value; }));
  return [
    titulo('Cena', c.nome),
    texto('Nome', c.nome, (v) => { c.nome = v || c.nome; }),
    texto('Identificador', c.id, (v) => { const novo = v.replace(/[^a-z0-9_]/gi, '_').toLowerCase(); if (novo && !p.cenas.some((x) => x.id === novo)) { c.id = novo; estado.cenaId = novo; } }, 'Nome do arquivo no jogo: dados/cenas/<id>.json'),
    num('Duração', c.duracao, (v) => { c.duracao = Math.max(1, v); }, 0.1, { min: 1, unidade: 's' }),
    el('button', { class: 'bt mini', onclick: ajustarDuracao, title: 'Termina meio segundo depois do último item' }, 'Ajustar ao último item'),
    cor('Cor do céu', c.fundo, (v) => { c.fundo = v; }),
    el('label', { for: 'notas-cena', class: 'rotulo' }, 'Notas'), notas,
    el('div', { class: 'prop-bts' },
      el('button', { class: 'bt mini', onclick: duplicarCena }, 'Duplicar cena'),
      el('button', { class: 'bt mini perigo', onclick: apagarCena }, 'Apagar cena')),
    el('p', { class: 'nota' }, 'Clique num bloco da linha do tempo ou num objeto da janela 3D para editar.'),
  ];
}
function duplicarCena(): void {
  const p = estado.pacote!, c = cena()!;
  alterar(() => {
    const n = JSON.parse(JSON.stringify(c)) as typeof c;
    n.id = c.id + '_copia'; n.nome = c.nome + ' (cópia)';
    while (p.cenas.some((x) => x.id === n.id)) n.id += '_2';
    p.cenas.push(n); estado.cenaId = n.id;
  });
}
async function apagarCena(): Promise<void> {
  const p = estado.pacote!, c = cena()!;
  if (!await confirmar('Apagar cena?', `A cena "${c.nome}" sai do pacote. Dá para desfazer com Ctrl+Z.`)) return;
  alterar(() => { p.cenas = p.cenas.filter((x) => x !== c); estado.cenaId = p.cenas[0]?.id ?? ''; estado.selecao = null; });
}

function painelJogador(): HTMLElement[] {
  const c = cena()!;
  const temMover = c.faixas.some((f) => f.tipo === 'mover' && f.alvo === 'jogador');
  const agora = poseJogador(c, estado.tempo);
  return [
    titulo('Jogador', 'Onde o jogador está', '#8fd651'),
    el('p', { class: 'nota' }, 'No Quest a câmera nunca é tomada: a cena só leva a plataforma onde o jogador está (como a nave no túnel). A cabeça e o andar são dele.'),
    vec('Começa em', c.jogador.pos, (v) => { c.jogador.pos = v; }),
    num('Virado para', c.jogador.rotY, (v) => { c.jogador.rotY = v; }, 5, { unidade: '°' }),
    temMover ? el('p', { class: 'nota' }, `Tem faixa de movimento: agora em ${agora.pos.map((n) => n.toFixed(2).replace('.', ',')).join(' · ')}.`) : null,
    el('p', { class: 'nota' }, 'Na janela 3D, clique no anel lima e use as setas para mover.'),
  ].filter(Boolean) as HTMLElement[];
}

function painelAtor(a: Ator): HTMLElement[] {
  const c = cena()!;
  const personagens = Object.entries(estado.pacote?.personagens ?? {}).map(([id, nome]) => [id, nome] as [string, string]);
  const temMover = c.faixas.some((f) => f.tipo === 'mover' && f.alvo === a.id);
  const pose = poseAtor(c, a, estado.tempo);
  return [
    titulo('Ator', a.nome, a.cor),
    texto('Nome', a.nome, (v) => { a.nome = v || a.nome; }),
    escolha('Modelo', a.modelo, [...biblioteca.modelos.keys()].sort().map((m) => [m, m]), (v) => { a.modelo = v; }),
    escolha('Personagem (falas)', a.personagem ?? '', [['', '— nenhum —'], ...personagens], (v) => { a.personagem = v || undefined; }),
    marca('Holograma', !!a.holograma, (v) => { a.holograma = v; }, 'Azulado e translúcido, brilha no ritmo da voz'),
    marca('Mexer ("falar") durante as falas dele', a.falarAutomatico !== false, (v) => { a.falarAutomatico = v; }),
    marca('Visível no começo', a.visivel, (v) => { a.visivel = v; }),
    escolhaClipe('Animação parada', a.animacao ?? '', a.modelo, (v) => { a.animacao = v || undefined; }, 'idle (padrão)'),
    cor('Cor na linha do tempo', a.cor, (v) => { a.cor = v; }),
    el('h4', { class: 'sub' }, temMover ? 'Posição (tem faixa de movimento)' : 'Posição inicial'),
    temMover
      ? el('p', { class: 'nota' }, `Agora: ${pose.pos.map((n) => n.toFixed(2).replace('.', ',')).join(' · ')}. Arraste na janela 3D para gravar um ponto-chave no instante da linha vermelha.`)
      : el('div', {}, vec('Posição', a.pos, (v) => { a.pos = v; }), num('Giro', a.rotY, (v) => { a.rotY = v; }, 5, { unidade: '°' }), num('Tamanho', a.escala, (v) => { a.escala = Math.max(0.01, v); }, 0.05)),
    el('div', { class: 'prop-bts' }, el('button', { class: 'bt mini perigo', onclick: () => void apagarAtor(a.id) }, 'Tirar da cena')),
  ];
}

function painelCenario(id: string): HTMLElement[] {
  const o = cena()!.cenario.find((x) => x.id === id)!;
  return [
    titulo('Cenário', o.id, '#4a6878'),
    escolha('Modelo', o.modelo, [...biblioteca.modelos.keys()].sort().map((m) => [m, m]), (v) => { o.modelo = v; }),
    vec('Posição', o.pos, (v) => { o.pos = v; }),
    num('Giro', o.rotY, (v) => { o.rotY = v; }, 5, { unidade: '°' }),
    num('Tamanho', o.escala, (v) => { o.escala = Math.max(0.01, v); }, 0.05),
    escolhaClipe('Animação em loop', o.animacao ?? '', o.modelo, (v) => { o.animacao = v || undefined; }, '— nenhuma —'),
    el('div', { class: 'prop-bts' }, el('button', { class: 'bt mini perigo', onclick: () => void apagarAtor(o.id) }, 'Tirar da cena')),
  ];
}

function painelFaixa(f: Faixa): HTMLElement[] {
  const c = cena()!;
  const out: HTMLElement[] = [
    titulo('Faixa · ' + NOME_TIPO[f.tipo], f.nome),
    texto('Nome', f.nome, (v) => { f.nome = v || f.nome; }),
    el('p', { class: 'nota' }, `${itensDe(f).length} item(ns). Dois cliques na pista criam um item novo.`),
  ];
  if (f.tipo === 'fala') out.push(...ajustesFalas());
  void c;
  return out;
}

function ajustesFalas(): HTMLElement[] {
  const inp = el('input', { class: 'campo num', type: 'number', step: '0.1', min: '0', value: '0.8', id: 'pausa-encadear' });
  return [
    el('h4', { class: 'sub' }, 'Ajustes rápidos'),
    el('div', { class: 'campo-linha' }, el('label', { for: 'pausa-encadear', class: 'rotulo' }, 'Pausa entre falas'), el('div', { class: 'com-unidade' }, inp, el('span', {}, 's'))),
    el('button', { class: 'bt mini', onclick: () => encadearFalas(Math.max(0, parseFloat(inp.value) || 0)) }, 'Encadear todas as falas'),
    el('p', { class: 'nota' }, 'Cada fala começa depois da anterior acabar. O que vem depois (hologramas, setas, eventos) anda junto.'),
  ];
}

function painelItem(f: Faixa, i: number): HTMLElement[] {
  const c = cena()!;
  const it = itensDe(f)[i];
  const dur = duracaoItem(f, i);
  const out: HTMLElement[] = [
    titulo(NOME_TIPO[f.tipo], f.nome),
    num('Começa', it.t, (v) => { it.t = Math.max(0, v); itensDe(f).sort((a, b) => a.t - b.t); estado.selecao = { faixa: f.id, indice: itensDe(f).indexOf(it) }; }, 0.05, { min: 0, unidade: 's' }),
  ];
  switch (f.tipo) {
    case 'mover': {
      const k = f.chaves[i];
      out.push(vec('Posição', k.pos, (v) => { k.pos = v; }), num('Giro', k.rotY, (v) => { k.rotY = v; }, 5, { unidade: '°' }), num('Tamanho', k.escala, (v) => { k.escala = Math.max(0.001, v); }, 0.05),
        escolha('Até o próximo ponto', k.curva ?? 'linear', [['linear', 'Velocidade constante'], ['suave', 'Suave (acelera e freia)']], (v) => { k.curva = v as 'linear' | 'suave'; }),
        el('p', { class: 'nota' }, 'Dica: arraste o objeto na janela 3D com a linha vermelha neste instante para mudar a posição.'));
      break;
    }
    case 'visivel': out.push(marca('Visível a partir daqui', f.chaves[i].visivel, (v) => { f.chaves[i].visivel = v; })); break;
    case 'animacao': {
      const b = f.blocos[i];
      const modelo = c.atores.find((a) => a.id === f.alvo)?.modelo ?? c.cenario.find((o) => o.id === f.alvo)?.modelo ?? '';
      out.push(escolhaClipe('Clipe', b.clipe, modelo, (v) => { b.clipe = v; }),
        num('Duração', b.dur, (v) => { b.dur = Math.max(0.05, v); }, 0.1, { min: 0.05, unidade: 's' }),
        marca('Repetir (loop)', b.loop, (v) => { b.loop = v; }));
      break;
    }
    case 'fala': {
      const b = f.blocos[i];
      const info = biblioteca.falas.get(b.fala);
      out.push(
        escolha('Fala', b.fala, [...biblioteca.falas.keys()].map((id) => [id, id]), (v) => { b.fala = v; }),
        el('p', { class: 'citacao' }, info?.texto ?? 'Fala sem texto no falas.json.'),
        el('p', { class: 'nota' }, `Duração ${fmtT(duracaoFala(b.fala))} (do áudio)${biblioteca.audios.has(b.fala) ? '' : ' · áudio não encontrado: arraste o ZIP da dublagem'}.`),
        escolha('Quem fala', b.ator ?? '', [['', 'Automático (pelo personagem)'], ...c.atores.map((a) => [a.id, a.nome] as [string, string])], (v) => { b.ator = v || undefined; }),
        ...ajustesFalas(),
      );
      break;
    }
    case 'som': {
      const b = f.blocos[i];
      const sons = [...biblioteca.audios.keys()].filter((k) => !biblioteca.falas.has(k));
      out.push(...[texto('Arquivo', b.arquivo, (v) => { b.arquivo = v; }, 'Nome sem extensão. Ex.: mus_tunel' + (sons.length ? `\nNa biblioteca: ${sons.join(', ')}` : '')),
        biblioteca.audios.has(b.arquivo) ? null : el('p', { class: 'nota alerta' }, 'Espaço reservado: o som ainda não existe, a cena toca em silêncio neste trecho.'),
        num('Duração', b.dur, (v) => { b.dur = Math.max(0.1, v); }, 0.1, { unidade: 's' }),
        num('Volume', b.volume, (v) => { b.volume = Math.min(1, Math.max(0, v)); }, 0.05, { min: 0, max: 1 }),
        marca('Repetir (loop)', b.loop, (v) => { b.loop = v; }),
        el('p', { class: 'nota' }, 'Arquivos que começam com "mus" são música: abaixam sozinhos enquanto alguém fala.'),
      ].filter(Boolean) as HTMLElement[]);
      break;
    }
    case 'seta': {
      const b = f.blocos[i];
      out.push(escolha('Aponta para', b.alvo, alvosDaCena(), (v) => { b.alvo = v; }), num('Duração', b.dur, (v) => { b.dur = Math.max(0.1, v); }, 0.1, { unidade: 's' }));
      break;
    }
    case 'aguardar': {
      const b = f.blocos[i];
      const cd = b.condicao;
      const trocar = (tipo: string) => {
        const txt = cd.texto;
        const j = poseJogador(c, b.t);
        b.condicao = tipo === 'chegar' ? { tipo: 'chegar', pos: [...j.pos] as Vec3, raio: 1, texto: txt }
          : tipo === 'olhar' ? { tipo: 'olhar', alvo: alvosDaCena()[0]?.[0] ?? '', angulo: 20, texto: txt }
            : { tipo: 'manual', texto: txt };
      };
      out.push(
        escolha('Espera até', cd.tipo, [['chegar', 'O jogador chegar a um lugar'], ['olhar', 'O jogador olhar para algo'], ['manual', 'O jogo avisar (botão, encaixe…)']], trocar),
        texto('O que o jogador faz', cd.texto, (v) => { cd.texto = v; }, 'Aparece no relógio e no botão "simular"'),
        ...condicaoCampos(cd),
        el('p', { class: 'nota' }, 'No Simular VR a cena segue sozinha quando a condição acontece. No Editar, aparece o botão "Simular" na janela 3D.'),
      );
      break;
    }
    case 'evento': {
      const b = f.blocos[i];
      out.push(texto('Nome do evento', b.nome, (v) => { b.nome = v.replace(/\s+/g, '_'); }, 'O jogo faz algo com este nome (ex.: mostrar_creditos)'),
        el('p', { class: 'nota' }, 'O editor só mostra um aviso; quem faz acontecer é o jogo.'));
      break;
    }
  }
  if (dur > 0 && f.tipo !== 'fala') out.push(el('p', { class: 'nota' }, `Termina em ${fmtT(it.t + dur)}.`));
  out.push(el('div', { class: 'prop-bts' }, el('button', { class: 'bt mini perigo', onclick: apagarSelecionado, title: 'Delete' }, 'Apagar item')));
  return out;
}

function condicaoCampos(cd: Condicao): HTMLElement[] {
  if (cd.tipo === 'chegar') return [vec('Lugar', cd.pos, (v) => { cd.pos = v; }), num('Raio', cd.raio, (v) => { cd.raio = Math.max(0.1, v); }, 0.1, { unidade: 'm' }),
    el('p', { class: 'nota' }, 'O anel amarelo na janela 3D mostra o lugar.')];
  if (cd.tipo === 'olhar') return [escolha('Para o quê', cd.alvo, alvosDaCena(), (v) => { cd.alvo = v; }), num('Folga do olhar', cd.angulo, (v) => { cd.angulo = Math.min(90, Math.max(2, v)); }, 1, { unidade: '°' })];
  return [];
}
