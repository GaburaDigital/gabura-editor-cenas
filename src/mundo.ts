// A janela 3D: Three.js com os modelos da cena, hologramas, marcador do jogador, seta holográfica,
// câmera livre (modo Editar) e primeira pessoa como no Quest (modo Simular VR).

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { biblioteca } from './arquivos';
import type { Cena, Vec3 } from './modelo';

export const ALTURA_OLHOS = 1.6;
export const VELOCIDADE_ANDAR = 1.4; // m/s, a mesma do jogo
const FOV_HORIZONTAL_QUEST = 96;     // graus (Quest 3S, por olho)

export interface Camada { clipe: string; tempo: number; peso: number; loop: boolean; }

export interface Instancia {
  id: string;
  modelo: string;
  holograma: boolean;
  raiz: THREE.Group;        // posição, giro e tamanho da cena
  mixer: THREE.AnimationMixer | null;
  clipes: Map<string, THREE.AnimationClip>;
  acoes: Map<string, THREE.AnimationAction>;
  brilho: THREE.MeshStandardMaterial[];
  falta: boolean;           // o .glb não está na biblioteca: mostra uma cápsula no lugar
  boca: OssoBoca[];         // ossos da boca guiados pela voz (vem de extras.gabura_fala do .glb)
}

/** Um osso da boca: fechado/aberto (modo envelope) ou o desenho do clipe "falar" vezes o volume (modo padrão). */
interface OssoBoca {
  no: THREE.Object3D;
  caminho: 'rotation' | 'translation' | 'scale';
  modo: 'envelope' | 'padrao';
  fechado: number[];
  aberto: number[];
  desenho: THREE.Interpolant | null;
  duracao: number;
}
interface InfoFala { boca?: { no: string; caminho: OssoBoca['caminho']; modo: OssoBoca['modo']; fechado: number[]; aberto: number[] }[] }
const PROP_TRILHA = { rotation: 'quaternion', translation: 'position', scale: 'scale' } as const;

function lerBoca(obj: THREE.Object3D, animacoes: THREE.AnimationClip[]): OssoBoca[] {
  const info = obj.userData.gabura_fala as InfoFala | undefined;
  if (!info?.boca) return [];
  const falar = animacoes.find((a) => a.name === 'falar');
  const out: OssoBoca[] = [];
  for (const b of info.boca) {
    const no = obj.getObjectByName(b.no);
    if (!no) continue;
    const trilha = falar?.tracks.find((t) => t.name === `${THREE.PropertyBinding.sanitizeNodeName(b.no)}.${PROP_TRILHA[b.caminho]}`);
    out.push({ no, caminho: b.caminho, modo: b.modo, fechado: b.fechado, aberto: b.aberto,
      desenho: b.modo === 'padrao' && trilha ? trilha.createInterpolant() : null, duracao: falar?.duration || 1 });
  }
  return out;
}

const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
function porNaBoca(o: OssoBoca, valor: ArrayLike<number>): void {
  if (o.caminho === 'rotation') o.no.quaternion.set(valor[0], valor[1], valor[2], valor[3]);
  else if (o.caminho === 'translation') o.no.position.set(valor[0], valor[1], valor[2]);
  else o.no.scale.set(valor[0], valor[1], valor[2]);
}
function misturar(o: OssoBoca, de: ArrayLike<number>, para: ArrayLike<number>, k: number): number[] {
  if (o.caminho === 'rotation') {
    qA.set(de[0], de[1], de[2], de[3]); qB.set(para[0], para[1], para[2], para[3]);
    qA.slerp(qB, k);
    return [qA.x, qA.y, qA.z, qA.w];
  }
  return [0, 1, 2].map((i) => de[i] + (para[i] - de[i]) * k);
}

// ---------- estado da janela ----------
let renderizador: THREE.WebGLRenderer;
let cena3d: THREE.Scene;
let camEditar: THREE.PerspectiveCamera;
let camSimular: THREE.PerspectiveCamera;
let orbita: OrbitControls;
let gizmo: TransformControls;
let caixa: HTMLElement;
let grade: THREE.GridHelper;
let sol: THREE.DirectionalLight;
let marcadorJogador: THREE.Group;
let seta: THREE.Group;
let anelChegar: THREE.Mesh;
let relogio: THREE.Group;
let telaRelogio: { canvas: HTMLCanvasElement; textura: THREE.CanvasTexture; texto: string };
export const instancias = new Map<string, Instancia>();
let assinaturaAtual = '';
export let leve = false;
let medidorFps: HTMLElement;

export const simulacao = {
  ativa: false,
  preso: false,          // mouse preso na janela (pointer lock)
  yaw: 0, pitch: 0,
  deslocamento: new THREE.Vector3(), // o quanto o jogador andou com WASD, em relação ao ponto da cena
  teclas: new Set<string>(),
  relogio: false,
};

export interface Ganchos {
  quadro: (dt: number) => void;
  selecionar: (id: string) => void;
  moveu: (id: string, pos: Vec3, rotY: number, escala: number) => void;
}
let ganchos: Ganchos;

// ---------- detecção de computador sem placa de vídeo ----------
function placaFraca(r: THREE.WebGLRenderer): boolean {
  const gl = r.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const nome = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /llvmpipe|swiftshader|software|mesa (dri )?intel|intel\(r\) (hd|uhd)|intel.*(hd|uhd|iris)|microsoft basic/i.test(nome);
}
export function nomePlaca(): string {
  const gl = renderizador.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

export function iniciarMundo(el: HTMLElement, g: Ganchos, forcarLeve: boolean | null): void {
  caixa = el; ganchos = g;
  renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  leve = forcarLeve ?? placaFraca(renderizador);
  renderizador.setPixelRatio(leve ? 0.75 : Math.min(devicePixelRatio, 2));
  renderizador.shadowMap.enabled = !leve;
  renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
  renderizador.outputColorSpace = THREE.SRGBColorSpace;
  renderizador.toneMapping = THREE.ACESFilmicToneMapping;
  el.append(renderizador.domElement);
  renderizador.domElement.tabIndex = 0;

  cena3d = new THREE.Scene();
  cena3d.background = new THREE.Color('#0a141c');
  // luz parecida com a da galeria e do jogo: céu + chão e um "sol" suave
  cena3d.add(new THREE.HemisphereLight('#cfeaff', '#1a2a33', 1.6));
  sol = new THREE.DirectionalLight('#ffffff', 1.8);
  sol.position.set(4, 8, 5);
  sol.castShadow = !leve;
  sol.shadow.mapSize.set(1024, 1024);
  Object.assign(sol.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 40 });
  cena3d.add(sol, sol.target);

  grade = new THREE.GridHelper(40, 40, '#2d5566', '#173040');
  (grade.material as THREE.Material).transparent = true;
  (grade.material as THREE.Material).opacity = 0.55;
  cena3d.add(grade);

  camEditar = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  camEditar.position.set(3.5, 3, 5);
  camSimular = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
  camSimular.rotation.order = 'YXZ';
  cena3d.add(camSimular);

  orbita = new OrbitControls(camEditar, renderizador.domElement);
  orbita.target.set(0, 1, 0);
  orbita.enableDamping = true;

  gizmo = new TransformControls(camEditar, renderizador.domElement);
  gizmo.setSize(0.8);
  gizmo.addEventListener('dragging-changed', (e) => {
    orbita.enabled = !e.value;
    if (!e.value && gizmo.object) {
      const o = gizmo.object;
      ganchos.moveu(String(o.userData.id), [o.position.x, o.position.y, o.position.z], THREE.MathUtils.radToDeg(o.rotation.y), o.scale.x);
    }
  });
  // o tamanho é sempre igual nos 3 eixos
  gizmo.addEventListener('objectChange', () => {
    const o = gizmo.object;
    if (o && gizmo.getMode() === 'scale') { const s = Math.max(0.02, o.scale.y); o.scale.setScalar(s); }
  });
  cena3d.add(gizmo.getHelper());

  marcadorJogador = criarMarcadorJogador();
  marcadorJogador.userData.id = 'jogador';
  cena3d.add(marcadorJogador);
  seta = criarSeta(); seta.visible = false; cena3d.add(seta);
  anelChegar = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  anelChegar.visible = false; cena3d.add(anelChegar);
  relogio = criarRelogio(); relogio.visible = false; camSimular.add(relogio);

  medidorFps = document.createElement('div');
  medidorFps.className = 'fps';
  el.append(medidorFps);

  ligarEntrada();
  new ResizeObserver(redimensionar).observe(el);
  redimensionar();

  let antes = performance.now(), quadros = 0, janela = 0;
  renderizador.setAnimationLoop(() => {
    const agora = performance.now();
    const dt = Math.min(0.1, (agora - antes) / 1000); antes = agora;
    quadros++; janela += dt;
    if (janela >= 0.5) { medidorFps.textContent = `${Math.round(quadros / janela)} qps${leve ? ' · leve' : ''}`; quadros = 0; janela = 0; }
    if (simulacao.ativa) andar(dt);
    ganchos.quadro(dt);
    orbita.update();
    renderizador.render(cena3d, simulacao.ativa ? camSimular : camEditar);
  });
}

export function trocarLeve(v: boolean): void {
  leve = v;
  renderizador.setPixelRatio(leve ? 0.75 : Math.min(devicePixelRatio, 2));
  renderizador.shadowMap.enabled = !leve;
  sol.castShadow = !leve;
  cena3d.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = !leve; o.receiveShadow = !leve; } });
  redimensionar();
}

function redimensionar(): void {
  const w = Math.max(1, caixa.clientWidth), h = Math.max(1, caixa.clientHeight);
  renderizador.setSize(w, h, false);
  renderizador.domElement.style.width = '100%';
  renderizador.domElement.style.height = '100%';
  camEditar.aspect = w / h; camEditar.updateProjectionMatrix();
  // mesmo campo de visão horizontal do Quest; o vertical sai da proporção da janela
  camSimular.aspect = w / h;
  camSimular.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV_HORIZONTAL_QUEST / 2)) / (w / h)));
  camSimular.updateProjectionMatrix();
}

// ---------- modelos ----------
const carregador = new GLTFLoader();
const cacheGltf = new Map<string, Promise<GLTF | null>>();
function gltf(nome: string): Promise<GLTF | null> {
  let p = cacheGltf.get(nome);
  if (!p) {
    const dados = biblioteca.modelos.get(nome);
    p = dados
      ? carregador.parseAsync(dados.slice(0), '').catch((e: unknown) => { console.warn('modelo com problema', nome, e); return null; })
      : Promise.resolve(null);
    if (dados) cacheGltf.set(nome, p);
  }
  return p;
}
/** Esquece os modelos já lidos (depois de importar uma versão nova de um .glb). */
export function esquecerModelos(): void { cacheGltf.clear(); assinaturaAtual = ''; }

function materialHolograma(m: THREE.Material): THREE.Material {
  const n = m.clone() as THREE.MeshStandardMaterial;
  if (n.color) n.color = new THREE.Color('#b8e6ff');
  n.transparent = true; n.opacity = 0.82;
  if (n.emissive) n.emissive = new THREE.Color('#123a48');
  return n;
}

/** Holograma suave como na galeria: cores e rosto visíveis, azulado, e um passo de profundidade
 *  antes, para cabelo e barba não mostrarem o que está atrás. */
function virarHolograma(obj: THREE.Object3D, brilho: THREE.MeshStandardMaterial[]): void {
  const prof = new THREE.MeshBasicMaterial({ colorWrite: false });
  const malhas: THREE.Mesh[] = [];
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) malhas.push(o as THREE.Mesh); });
  for (const o of malhas) {
    o.material = Array.isArray(o.material) ? o.material.map(materialHolograma) : materialHolograma(o.material);
    o.renderOrder = 2; o.castShadow = false;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { if ((mt as THREE.MeshStandardMaterial).emissive) brilho.push(mt as THREE.MeshStandardMaterial); });
    let d: THREE.Mesh;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      const s = o as THREE.SkinnedMesh;
      const sd = new THREE.SkinnedMesh(s.geometry, prof); sd.bind(s.skeleton, s.bindMatrix); d = sd;
    } else d = new THREE.Mesh(o.geometry, prof);
    d.position.copy(o.position); d.quaternion.copy(o.quaternion); d.scale.copy(o.scale);
    d.renderOrder = 1; d.frustumCulled = false; o.frustumCulled = false;
    o.parent?.add(d);
  }
}

function capsula(cor: string): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.9, 4, 12),
    new THREE.MeshStandardMaterial({ color: cor, transparent: true, opacity: 0.55 }));
  m.position.y = 0.7;
  return m;
}

interface Pedido { id: string; modelo: string; holograma: boolean; cor: string; }

/** Monta (ou reaproveita) os objetos da cena. Só remonta o que mudou de modelo. */
export async function montar(c: Cena): Promise<void> {
  cena3d.background = new THREE.Color(c.fundo);
  const pedidos: Pedido[] = [
    ...c.cenario.map((o) => ({ id: o.id, modelo: o.modelo, holograma: false, cor: '#4a6878' })),
    ...c.atores.map((a) => ({ id: a.id, modelo: a.modelo, holograma: !!a.holograma, cor: a.cor })),
  ];
  const assinatura = c.id + '|' + pedidos.map((p) => `${p.id}:${p.modelo}:${p.holograma}:${biblioteca.modelos.has(p.modelo)}`).join(',');
  if (assinatura === assinaturaAtual) return;
  assinaturaAtual = assinatura;
  const querIds = new Set(pedidos.map((p) => p.id));
  for (const [id, inst] of instancias) {
    const p = pedidos.find((x) => x.id === id);
    if (!querIds.has(id) || !p || p.modelo !== inst.modelo || p.holograma !== inst.holograma || inst.falta !== !biblioteca.modelos.has(p.modelo)) {
      if (gizmo.object === inst.raiz) gizmo.detach();
      cena3d.remove(inst.raiz); instancias.delete(id);
    }
  }
  for (const p of pedidos) {
    if (instancias.has(p.id)) continue;
    const raiz = new THREE.Group(); raiz.userData.id = p.id;
    const inst: Instancia = { id: p.id, modelo: p.modelo, holograma: p.holograma, raiz, mixer: null, clipes: new Map(), acoes: new Map(), brilho: [], falta: true, boca: [] };
    instancias.set(p.id, inst);
    cena3d.add(raiz);
    const g = await gltf(p.modelo);
    if (instancias.get(p.id) !== inst) continue; // a cena mudou enquanto o modelo carregava
    if (!g) { raiz.add(capsula(p.cor)); continue; }
    const obj = SkeletonUtils.clone(g.scene);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = !leve && !p.holograma; o.receiveShadow = !leve; } });
    if (p.holograma) virarHolograma(obj, inst.brilho);
    raiz.add(obj);
    inst.falta = false;
    inst.mixer = new THREE.AnimationMixer(obj);
    for (const cl of g.animations) inst.clipes.set(cl.name, cl);
    inst.boca = lerBoca(obj, g.animations);
  }
}

export function clipesDe(modelo: string): Promise<string[]> {
  return gltf(modelo).then((g) => (g ? g.animations.map((a) => a.name) : []));
}

/** Põe o objeto no lugar (vindo da linha do tempo). */
export function posicionar(id: string, pos: Vec3, rotY: number, escala: number, visivel: boolean): void {
  const inst = instancias.get(id);
  if (!inst) return;
  if (gizmo.dragging && gizmo.object === inst.raiz) return; // não briga com a mão do usuário
  inst.raiz.position.set(pos[0], pos[1], pos[2]);
  inst.raiz.rotation.y = THREE.MathUtils.degToRad(rotY);
  inst.raiz.scale.setScalar(escala);
  inst.raiz.visible = visivel;
}

/** Aplica as animações daquele instante (várias camadas, para as transições suaves entre clipes).
 *  boca: abertura pela voz; null = boca fechada (ou o que o clipe atual fizer com ela). */
export function animar(id: string, camadasBrutas: Camada[], boca: { abertura: number; tempo: number } | null = null): void {
  const inst = instancias.get(id);
  if (!inst?.mixer) return;
  // o mesmo clipe duas vezes (ex.: duas falas seguidas) soma os pesos
  const porClipe = new Map<string, Camada>();
  for (const c of camadasBrutas) {
    const ja = porClipe.get(c.clipe);
    if (ja) ja.peso += c.peso; else porClipe.set(c.clipe, { ...c });
  }
  const camadas = [...porClipe.values()];
  // boca fechada antes; se algum clipe (ex.: comemorar) mexer na boca, ele manda
  for (const o of inst.boca) porNaBoca(o, o.fechado);
  const usadas = new Set<string>();
  for (const cam of camadas) {
    const clipe = inst.clipes.get(cam.clipe);
    if (!clipe) continue;
    let a = inst.acoes.get(cam.clipe);
    if (!a) { a = inst.mixer.clipAction(clipe); a.play(); inst.acoes.set(cam.clipe, a); }
    a.enabled = true;
    a.setEffectiveWeight(cam.peso);
    const d = clipe.duration || 1;
    a.time = cam.loop ? ((cam.tempo % d) + d) % d : Math.min(Math.max(cam.tempo, 0), d);
    usadas.add(cam.clipe);
  }
  for (const [nome, a] of inst.acoes) if (!usadas.has(nome)) a.enabled = false;
  inst.mixer.update(0);
  if (!boca) return;
  for (const o of inst.boca) {
    if (o.modo === 'padrao' && o.desenho) {
      const d = o.duracao;
      const v = o.desenho.evaluate(((boca.tempo % d) + d) % d);
      porNaBoca(o, misturar(o, o.fechado, v, Math.pow(boca.abertura, 0.6)));
    } else porNaBoca(o, misturar(o, o.fechado, o.aberto, Math.pow(boca.abertura, 1.2)));
  }
}

/** O modelo tem boca guiada pela voz? */
export function temBocaPelaVoz(id: string): boolean { return (instancias.get(id)?.boca.length ?? 0) > 0; }

/** Brilho do holograma no ritmo da voz (nivel de 0 a 1). */
export function brilhar(id: string, nivel: number): void {
  const inst = instancias.get(id);
  if (inst) for (const m of inst.brilho) m.emissiveIntensity = 1 + 2.4 * nivel;
}

// ---------- jogador, seta e relógio ----------
function criarMarcadorJogador(): THREE.Group {
  const g = new THREE.Group();
  const lima = new THREE.MeshBasicMaterial({ color: '#8fd651' });
  const anel = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 24).rotateX(-Math.PI / 2), lima);
  anel.position.y = 0.03;
  const bico = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3).rotateX(-Math.PI / 2), lima);
  bico.position.set(0, 0.05, -0.45);
  // a "cabeça" na altura dos olhos, para ver de onde o jogador olha
  const olhos = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: '#8fd651', transparent: true, opacity: 0.5 }));
  olhos.position.y = ALTURA_OLHOS;
  const linha = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, ALTURA_OLHOS), new THREE.MeshBasicMaterial({ color: '#8fd651', transparent: true, opacity: 0.35 }));
  linha.position.y = ALTURA_OLHOS / 2;
  g.add(anel, bico, olhos, linha);
  return g;
}

function criarSeta(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#4fd6d0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 10).rotateX(Math.PI / 2), mat);
  haste.position.z = -0.08;
  const ponta = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 16).rotateX(-Math.PI / 2), mat);
  ponta.position.z = -0.3;
  g.add(haste, ponta);
  g.renderOrder = 5;
  return g;
}

function criarRelogio(): THREE.Group {
  const g = new THREE.Group();
  const pulseira = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 24), new THREE.MeshStandardMaterial({ color: '#183040' }));
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const textura = new THREE.CanvasTexture(canvas); textura.colorSpace = THREE.SRGBColorSpace;
  telaRelogio = { canvas, textura, texto: '' };
  const tela = new THREE.Mesh(new THREE.CircleGeometry(0.045, 32), new THREE.MeshBasicMaterial({ map: textura }));
  tela.position.z = 0.002;
  g.add(pulseira, tela);
  // canto de baixo à esquerda da visão, como quem levanta o pulso esquerdo
  g.position.set(-0.12, -0.11, -0.3);
  g.rotation.set(0.35, 0.35, 0);
  desenharRelogio('');
  return g;
}

function desenharRelogio(texto: string): void {
  if (telaRelogio.texto === texto && telaRelogio.textura.version > 0) return;
  telaRelogio.texto = texto;
  const ctx = telaRelogio.canvas.getContext('2d')!;
  ctx.fillStyle = '#0c1a24'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#4fd6d0'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#4fd6d0'; ctx.font = 'bold 34px Nunito, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('GABURA', 128, 70);
  ctx.fillStyle = '#e8f3f2'; ctx.font = 'bold 24px Nunito, sans-serif';
  const palavras = (texto || 'tudo certo').split(' ');
  const linhas: string[] = []; let l = '';
  for (const p of palavras) { if ((l + ' ' + p).trim().length > 14) { linhas.push(l.trim()); l = p; } else l += ' ' + p; }
  linhas.push(l.trim());
  linhas.slice(0, 4).forEach((x, i) => ctx.fillText(x, 128, 118 + i * 30));
  telaRelogio.textura.needsUpdate = true;
}

/** Onde o jogador está (ponto da cena + o que andou com WASD) e para onde está virado. */
export function lugarDoJogador(base: Vec3, rotY: number): void {
  const r = THREE.MathUtils.degToRad(rotY);
  const desl = simulacao.deslocamento.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), r);
  const x = base[0] + desl.x, z = base[2] + desl.z;
  marcadorJogador.position.set(x, base[1], z);
  marcadorJogador.rotation.y = r + (simulacao.ativa ? simulacao.yaw : 0);
  marcadorJogador.visible = !simulacao.ativa;
  if (simulacao.ativa) {
    camSimular.position.set(x, base[1] + ALTURA_OLHOS, z);
    camSimular.rotation.set(simulacao.pitch, r + simulacao.yaw, 0);
  }
}
export function posicaoJogador(): THREE.Vector3 { return marcadorJogador.position.clone(); }
export function olharDoJogador(): { origem: THREE.Vector3; direcao: THREE.Vector3 } {
  if (simulacao.ativa) return { origem: camSimular.getWorldPosition(new THREE.Vector3()), direcao: camSimular.getWorldDirection(new THREE.Vector3()) };
  const origem = marcadorJogador.position.clone().add(new THREE.Vector3(0, ALTURA_OLHOS, 0));
  return { origem, direcao: new THREE.Vector3(0, 0, -1).applyQuaternion(marcadorJogador.quaternion) };
}
/** Posição de qualquer coisa da cena pelo id (ator ou objeto do cenário), no meio dela. */
export function posicaoDe(id: string): THREE.Vector3 | null {
  const inst = instancias.get(id);
  if (!inst) return null;
  const caixaObj = new THREE.Box3().setFromObject(inst.raiz);
  return caixaObj.isEmpty() ? inst.raiz.getWorldPosition(new THREE.Vector3()) : caixaObj.getCenter(new THREE.Vector3());
}

/** Mostra a seta holográfica apontando para um alvo (ou esconde, com null). */
export function apontar(alvo: string | null, tempo: number): void {
  const destino = alvo ? posicaoDe(alvo) : null;
  if (!destino) { seta.visible = false; return; }
  const { origem, direcao } = olharDoJogador();
  // fica um pouco à frente e abaixo dos olhos, no caminho do olhar
  const plano = new THREE.Vector3(direcao.x, 0, direcao.z).normalize();
  const p = origem.clone().addScaledVector(plano, 0.7).add(new THREE.Vector3(0, -0.35 + Math.sin(tempo * 4) * 0.02, 0));
  seta.position.copy(p);
  seta.lookAt(destino);
  const pulso = 1 + Math.sin(tempo * 6) * 0.08;
  seta.scale.setScalar(pulso);
  seta.visible = true;
}

export function mostrarChegar(pos: Vec3 | null, raio = 1): void {
  if (!pos) { anelChegar.visible = false; return; }
  anelChegar.position.set(pos[0], pos[1] + 0.02, pos[2]);
  anelChegar.scale.setScalar(raio);
  anelChegar.visible = true;
}

export function textoRelogio(texto: string): void { desenharRelogio(texto); }

// ---------- seleção e gizmo ----------
export type ModoGizmo = 'translate' | 'rotate' | 'scale';
export function selecionar3d(id: string | null, modo: ModoGizmo, permitir: boolean): void {
  const alvo = id === 'jogador' ? marcadorJogador : id ? instancias.get(id)?.raiz : undefined;
  if (!alvo || !permitir || simulacao.ativa) { gizmo.detach(); return; }
  if (gizmo.object !== alvo) gizmo.attach(alvo);
  gizmo.setMode(modo);
  gizmo.showX = modo !== 'rotate'; gizmo.showZ = modo !== 'rotate';
  gizmo.showY = true;
  if (modo === 'scale') { gizmo.showX = false; gizmo.showZ = false; }
}
export function gizmoArrastando(): boolean { return gizmo.dragging; }

/** Centraliza a câmera livre num ponto. */
export function focar(p: THREE.Vector3, distancia = 2.2): void {
  const desl = camEditar.position.clone().sub(orbita.target).setLength(distancia);
  orbita.target.copy(p);
  camEditar.position.copy(p).add(desl);
}
/** Câmera livre atrás e acima do jogador, olhando para a frente dele (como na galeria). */
export function enquadrarJogador(): void {
  const p = marcadorJogador.position;
  const atras = new THREE.Vector3(2.2, 2.4, 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), marcadorJogador.rotation.y);
  orbita.target.set(p.x, p.y + 1.4, p.z);
  camEditar.position.copy(p).add(atras);
}
export function seguirComCamera(delta: THREE.Vector3): void {
  orbita.target.add(delta); camEditar.position.add(delta);
}

// ---------- entrada: clique para escolher, primeira pessoa no Simular ----------
function ligarEntrada(): void {
  const tela = renderizador.domElement;
  let baixo: { x: number; y: number } | null = null;
  tela.addEventListener('pointerdown', (e) => { baixo = { x: e.clientX, y: e.clientY }; });
  tela.addEventListener('pointerup', (e) => {
    if (!baixo || simulacao.ativa || gizmo.dragging) return;
    if (Math.hypot(e.clientX - baixo.x, e.clientY - baixo.y) > 4) return; // foi arrasto de câmera
    const r = tela.getBoundingClientRect();
    const ponto = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const raio = new THREE.Raycaster(); raio.setFromCamera(ponto, camEditar);
    const alvos = [marcadorJogador, ...[...instancias.values()].map((i) => i.raiz)].filter((o) => o.visible);
    const hit = raio.intersectObjects(alvos, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && o.userData.id === undefined) o = o.parent;
    ganchos.selecionar(o ? String(o.userData.id) : '');
  });

  // Simular VR: clique na janela prende o mouse; Esc solta (o próprio Chrome faz isso)
  tela.addEventListener('click', () => {
    if (simulacao.ativa && !simulacao.preso) void tela.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    simulacao.preso = document.pointerLockElement === tela;
    caixa.classList.toggle('preso', simulacao.preso);
    if (!simulacao.preso) simulacao.teclas.clear();
  });
  document.addEventListener('mousemove', (e) => {
    if (!simulacao.preso) return;
    simulacao.yaw -= e.movementX * 0.0022;
    simulacao.pitch = THREE.MathUtils.clamp(simulacao.pitch - e.movementY * 0.0022, -1.4, 1.4);
  });
  window.addEventListener('keydown', (e) => {
    if (!simulacao.ativa || (e.target as HTMLElement).closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && document.pointerLockElement) { document.exitPointerLock(); return; }
    if (['w', 'a', 's', 'd'].includes(k)) { simulacao.teclas.add(k); e.preventDefault(); }
    if (k === 'r' && !e.ctrlKey && !e.metaKey) { simulacao.relogio = !simulacao.relogio; relogio.visible = simulacao.relogio; }
  });
  window.addEventListener('keyup', (e) => simulacao.teclas.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => simulacao.teclas.clear());
}

function andar(dt: number): void {
  const t = simulacao.teclas;
  const frente = (t.has('w') ? 1 : 0) - (t.has('s') ? 1 : 0);
  const lado = (t.has('d') ? 1 : 0) - (t.has('a') ? 1 : 0);
  if (!frente && !lado) return;
  // anda na direção em que a cabeça aponta (só no chão), em relação ao giro da cena
  const v = new THREE.Vector3(lado, 0, -frente).normalize().multiplyScalar(VELOCIDADE_ANDAR * dt);
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), simulacao.yaw);
  simulacao.deslocamento.add(v);
}

export function entrarSimular(rotYCena: number): void {
  simulacao.ativa = true;
  simulacao.yaw = 0; simulacao.pitch = 0;
  simulacao.deslocamento.set(0, 0, 0);
  void rotYCena;
  gizmo.detach();
  relogio.visible = simulacao.relogio;
  caixa.classList.add('simulando');
}
export function sairSimular(): void {
  simulacao.ativa = false;
  if (document.pointerLockElement) document.exitPointerLock();
  simulacao.teclas.clear();
  simulacao.deslocamento.set(0, 0, 0);
  caixa.classList.remove('simulando');
}
export function telaDoMundo(): HTMLCanvasElement { return renderizador.domElement; }
