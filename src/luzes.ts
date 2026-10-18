// Iluminação de teste: três modos (sem sombras, jogo no Quest, detalhado), luz colorida de cada sala
// que acende com a missão, sombra redonda embaixo dos personagens e os pontos de luz à mostra.
// Só para ver e testar: as luzes vêm do pacote de cenas (campo "iluminacao") e não são editadas aqui.
//
// Analogia Godot: é como ter um WorldEnvironment + OmniLight3D por sala, e trocar entre um
// preset "Mobile" (sem sombras, poucas luzes) e um "Forward+" (sombras e todas as luzes).

import * as THREE from 'three';
import type { Iluminacao, LuzSala, ModoLuz, Pacote } from './modelo';

export const NOME_MODO: Record<ModoLuz, string> = {
  sem_sombras: 'Sem sombras (tudo iluminado)',
  jogo: 'Jogo no Quest (leve)',
  detalhado: 'Detalhado (sombras)',
};
export const DESCRICAO_MODO: Record<ModoLuz, string> = {
  sem_sombras: 'Só a luz geral, sem sombras e sem luzes coloridas. É o mais leve de todos.',
  jogo: 'Luz geral + as 2 luzes coloridas mais perto do jogador. Sem mapa de sombras. É o modo previsto para o jogo no Quest 3S.',
  detalhado: 'Luz do teto com sombras + todas as luzes coloridas. Pesado para o Quest: serve para comparar o visual.',
};

/** Quantas luzes coloridas o modo "jogo" usa ao mesmo tempo (fixo, para o Quest não recompilar os materiais). */
const VAGAS_JOGO = 2;
/** Tempo para a luz acender depois do evento (s). */
const ACENDER = 1.2;

interface Estado {
  modo: ModoLuz;
  sombraRedonda: boolean;
  mostrarPontos: boolean;
}
export const opcoes: Estado = { modo: 'jogo', sombraRedonda: true, mostrarPontos: false };

let cena3d: THREE.Scene;
let renderizador: THREE.WebGLRenderer;
let ceu: THREE.HemisphereLight;
let sol: THREE.DirectionalLight;
let grupoLuzes: THREE.Group;
let grupoPontos: THREE.Group;
let grupoSombras: THREE.Group;
let luzesAtivas: THREE.PointLight[] = [];
let ilum: Iluminacao | null = null;
let assinatura = '';
const sombras = new Map<string, THREE.Mesh>();
let texturaSombra: THREE.Texture;
/** O que está aceso agora (0 a 1) e quais luzes estão em uso, para o painel. */
export const situacao = { acesas: new Map<string, number>(), emUso: new Set<string>() };

export function iniciarLuzes(c: THREE.Scene, r: THREE.WebGLRenderer, h: THREE.HemisphereLight, s: THREE.DirectionalLight): void {
  cena3d = c; renderizador = r; ceu = h; sol = s;
  grupoLuzes = new THREE.Group(); grupoLuzes.name = 'luzes_das_salas';
  grupoPontos = new THREE.Group(); grupoPontos.name = 'pontos_de_luz';
  grupoSombras = new THREE.Group(); grupoSombras.name = 'sombras_redondas';
  cena3d.add(grupoLuzes, grupoPontos, grupoSombras);
  texturaSombra = criarTexturaSombra();
  aplicarModo();
}

/** Luz geral de cada modo, quando o pacote não diz outra coisa. */
const GERAL_PADRAO: Record<ModoLuz, { ceu: number; sol: number }> = {
  sem_sombras: { ceu: 2.2, sol: 1.2 },
  jogo: { ceu: 1.5, sol: 0.9 },
  detalhado: { ceu: 0.9, sol: 2.4 },
};

export function definirModo(m: ModoLuz): void { opcoes.modo = m; aplicarModo(); }
export function definirSombraRedonda(v: boolean): void { opcoes.sombraRedonda = v; grupoSombras.visible = v; }
export function definirMostrarPontos(v: boolean): void { opcoes.mostrarPontos = v; grupoPontos.visible = v; }

function aplicarModo(): void {
  const m = opcoes.modo;
  const g = ilum?.geral?.[m] ?? GERAL_PADRAO[m];
  ceu.intensity = g.ceu;
  sol.intensity = g.sol;
  const comSombra = m === 'detalhado';
  renderizador.shadowMap.enabled = comSombra;
  sol.castShadow = comSombra;
  // no detalhado o "sol" é a luz do teto: bem de cima (uns 25° inclinado), para as paredes não jogarem sombras compridas
  sol.position.set(4, 10, 3);
  // a quantidade de luzes só muda quando o modo muda (o Three recompila os materiais uma vez)
  for (const l of luzesAtivas) grupoLuzes.remove(l);
  const n = m === 'sem_sombras' ? 0 : m === 'jogo' ? VAGAS_JOGO : (ilum?.luzes.length ?? 0);
  luzesAtivas = [...Array(n)].map(() => { const l = new THREE.PointLight('#ffffff', 0, 10, 2); l.castShadow = false; grupoLuzes.add(l); return l; });
  grupoSombras.visible = opcoes.sombraRedonda;
  grupoPontos.visible = opcoes.mostrarPontos;
}

/** Lê o campo "iluminacao" do pacote (quando muda) e refaz os marcadores dos pontos de luz. */
export function usarPacote(p: Pacote | null): void {
  const nova = p?.iluminacao ?? null;
  const a = JSON.stringify(nova);
  if (a === assinatura) return;
  assinatura = a; ilum = nova;
  grupoPontos.clear();
  for (const l of ilum?.luzes ?? []) grupoPontos.add(marcadorDaLuz(l));
  aplicarModo();
}

function marcadorDaLuz(l: LuzSala): THREE.Group {
  const g = new THREE.Group(); g.userData.luz = l.id; g.userData.naoEscolher = true;
  const cor = new THREE.Color(l.cor);
  const nucleo = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: cor, depthTest: false, transparent: true }));
  nucleo.renderOrder = 30; nucleo.name = 'nucleo';
  // alcance: anel facetado no chão, até onde a luz chega (some no alcance)
  const alcance = new THREE.Mesh(new THREE.RingGeometry(l.alcance - 0.06, l.alcance, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  alcance.name = 'alcance'; alcance.position.y = -l.pos[1] + 0.04;
  // linha até o chão e um anel facetado no chão, para ver onde a luz fica na planta
  const altura = l.pos[1];
  const linha = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, altura, 6), new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.5, depthWrite: false }));
  linha.position.y = -altura / 2;
  const anel = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  anel.position.y = -altura + 0.03;
  g.add(nucleo, alcance, linha, anel);
  g.position.set(l.pos[0], l.pos[1], l.pos[2]);
  return g;
}

/** Em que instante (cena e tempo) cada evento acontece, para saber se a luz já acendeu. */
function quandoAcende(p: Pacote, evento: string): { cena: number; t: number } | null {
  for (let i = 0; i < p.cenas.length; i++)
    for (const f of p.cenas[i].faixas) if (f.tipo === 'evento') for (const b of f.blocos) if (b.nome === evento) return { cena: i, t: b.t };
  return null;
}

/**
 * A cada quadro: quanto cada luz está acesa (as cenas seguem a ordem do jogo; o que acendeu
 * numa cena anterior já está aceso), quais luzes ocupam as vagas e onde ficam as sombras redondas.
 */
export function atualizarLuzes(p: Pacote | null, cenaId: string, t: number, olho: THREE.Vector3,
  personagens: { id: string; raiz: THREE.Object3D; raio: number }[]): void {
  usarPacote(p);
  const lista = ilum?.luzes ?? [];
  const ci = p ? p.cenas.findIndex((c) => c.id === cenaId) : -1;
  situacao.acesas.clear(); situacao.emUso.clear();
  const forca = lista.map((l) => {
    let v = 1;
    if (l.acende_evento && p) {
      const q = quandoAcende(p, l.acende_evento);
      if (q) v = q.cena < ci ? 1 : q.cena > ci ? 0 : THREE.MathUtils.clamp((t - q.t) / ACENDER, 0, 1);
    }
    const apagada = l.apagada ?? 0;
    const f = apagada + (1 - apagada) * v;
    situacao.acesas.set(l.id, v);
    return f;
  });
  // vagas: no "jogo" ficam as luzes acesas mais perto do jogador; no "detalhado", todas
  let ordem = lista.map((_, i) => i).filter((i) => forca[i] > 0.001);
  if (opcoes.modo === 'jogo') ordem.sort((a, b) => dist(lista[a], olho) - dist(lista[b], olho));
  ordem = ordem.slice(0, luzesAtivas.length);
  luzesAtivas.forEach((pl, k) => {
    const i = ordem[k];
    if (i === undefined) { pl.intensity = 0; return; }
    const l = lista[i];
    pl.position.set(l.pos[0], l.pos[1], l.pos[2]);
    pl.color.set(l.cor); pl.distance = l.alcance; pl.decay = 1; // queda suave (estilo desenho), some no alcance
    pl.intensity = l.intensidade * forca[i];
    situacao.emUso.add(l.id);
  });
  // marcadores: aceso = cheio; apagado = transparente; em uso agora = maior
  for (const g of grupoPontos.children) {
    const id = g.userData.luz as string;
    const nucleo = g.getObjectByName('nucleo') as THREE.Mesh;
    (nucleo.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.7 * (situacao.acesas.get(id) ?? 1);
    nucleo.scale.setScalar(situacao.emUso.has(id) ? 1.4 : 0.8);
    ((g.getObjectByName('alcance') as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = situacao.emUso.has(id) ? 0.55 : 0.12;
  }
  // a câmera de sombra do detalhado anda junto com o jogador (12 m em volta)
  if (opcoes.modo === 'detalhado') {
    sol.target.position.set(olho.x, 0, olho.z);
    sol.position.set(olho.x + 4, 10, olho.z + 3);
    sol.target.updateMatrixWorld();
  }
  atualizarSombrasRedondas(personagens);
}

const dist = (l: LuzSala, o: THREE.Vector3) => Math.hypot(l.pos[0] - o.x, l.pos[1] - o.y, l.pos[2] - o.z);

// ---------- sombra redonda (blob) ----------
function criarTexturaSombra(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Uma "sombra" escura embaixo de cada personagem: custa quase nada e ajuda a ver onde ele pisa. */
function atualizarSombrasRedondas(lista: { id: string; raiz: THREE.Object3D; raio: number }[]): void {
  const vistos = new Set<string>();
  for (const p of lista) {
    let s = sombras.get(p.id);
    if (!s) {
      s = new THREE.Mesh(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: texturaSombra, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      s.renderOrder = 3; s.userData.naoEscolher = true;
      grupoSombras.add(s); sombras.set(p.id, s);
    }
    vistos.add(p.id);
    const w = new THREE.Vector3(); p.raiz.getWorldPosition(w);
    // só no chão: quem está no ar (pulando alto, voando) não ganha sombra
    const noChao = p.raiz.visible && w.y < 0.6;
    s.visible = noChao;
    if (!noChao) continue;
    const alto = Math.max(0, w.y);
    s.position.set(w.x, 0.012, w.z);
    s.scale.setScalar(p.raio * (1 - alto * 0.5));
    (s.material as THREE.MeshBasicMaterial).opacity = 1 - alto;
  }
  for (const [id, s] of sombras) if (!vistos.has(id)) { grupoSombras.remove(s); sombras.delete(id); }
}

/** Resumo do custo do quadro, para o medidor no canto da janela 3D. */
export function custo(): string {
  const i = renderizador.info.render;
  const n = luzesAtivas.filter((l) => l.intensity > 0).length;
  return `${n} luz${n === 1 ? '' : 'es'} colorida${n === 1 ? '' : 's'} · sombras ${opcoes.modo === 'detalhado' ? 'sim' : 'não'} · ${i.calls} desenhos · ${(i.triangles / 1000).toFixed(0)} mil triângulos`;
}

/** Para os testes automáticos. */
export function _diagnostico(): Record<string, unknown> {
  return { sombrasLigadas: renderizador.shadowMap.enabled, solFazSombra: sol.castShadow, temMapa: !!sol.shadow.map, sol: sol.intensity, ceu: ceu.intensity,
    pos: sol.position.toArray(), alvo: sol.target.position.toArray(), alvoNaCena: !!sol.target.parent };
}
