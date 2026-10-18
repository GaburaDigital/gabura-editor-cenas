// Formato das cenas (o arquivo que vai e volta entre você e o Claude, e que o jogo lê).
// Não depende de engine: guarda só nomes de modelos, clipes, falas e tempos.

export type Vec3 = [number, number, number];

/** Um objeto do cenário (não muda durante a cena, só pode tocar uma animação em loop). */
export interface ObjetoCenario {
  id: string;
  modelo: string;          // nome do arquivo .glb
  pos: Vec3;
  rotY: number;            // graus
  rotX?: number;           // graus, inclinação fixa (ex.: cyberdeck deitado na mesa); aplicada depois do rotY
  escala: number;
  animacao?: string;       // clipe em loop (ex.: "correr" do túnel)
  alemDoPortal?: boolean;  // só aparece através da "janela" do portal (planeta-cubo e estrelas do outro lado)
}

/** Um ator: personagem ou objeto que a cena move, anima, mostra e esconde. */
export interface Ator {
  id: string;
  nome: string;
  modelo: string;
  cor: string;
  personagem?: string;     // id do personagem nas falas (ex.: "metalgabutron")
  holograma?: boolean;     // material de holograma (azulado e translúcido)
  falarAutomatico?: boolean; // durante a fala dele, toca o clipe "falar" sozinho
  pos: Vec3;
  rotY: number;
  rotX?: number;           // graus, inclinação fixa (não muda com a faixa de movimento)
  escala: number;
  visivel: boolean;        // no começo da cena
  animacao?: string;       // clipe inicial em loop
  relogio?: boolean;       // fica no relógio do pulso (Gabu_IA): só aparece quando o jogador olha o relógio;
                           // sem olhar, a voz fica mais baixa e a tela do relógio pisca
}

/** Linha no chão que mostra um caminho possível (ex.: clones correndo para os esconderijos). Só aparece no editor. */
export interface Caminho { id: string; nome: string; cor?: string; pontos: Vec3[]; }

/** Falas que não têm hora marcada: tocam quando algo acontece no jogo (pegar, errar, ficar parado...). */
export interface FalaPorEvento {
  id: string;              // nome do evento no jogo (ex.: treino_captura)
  sala: string;            // onde vale (ex.: treinamento, ou "qualquer")
  quando: string;          // o gatilho, em português
  falas: string[];         // ids da dublagem
  modo: 'sorteio' | 'sequencia' | 'uma_vez'; // sorteio sem repetir a anterior; sequência (dica 1, dica 2); toca uma vez só
  ator?: string;           // quem fala (id do personagem)
  nota?: string;
}

/** Ponto-chave de movimento. "curva" diz como ir DESTE ponto até o próximo:
 *  linear = velocidade constante (jogador andando); suave = acelera e freia (holograma surgindo). */
export interface ChaveMover { t: number; pos: Vec3; rotY: number; escala: number; curva?: 'linear' | 'suave'; }
export interface BlocoAnimacao { t: number; dur: number; clipe: string; loop: boolean; }
/** respiros: trechos sem voz, em segundos desde o começo da fala ([início, fim]).
 *  Sem o campo, o editor acha sozinho pela curva de volume; com o campo, vale o que o autor ajustou. */
export interface BlocoFala { t: number; fala: string; ator?: string; respiros?: [number, number][]; }
export interface BlocoSom { t: number; dur: number; arquivo: string; volume: number; loop: boolean; }
export interface ChaveVisivel { t: number; visivel: boolean; }
export interface BlocoSeta { t: number; dur: number; alvo: string; }
export type Condicao =
  | { tipo: 'chegar'; pos: Vec3; raio: number; texto: string }
  | { tipo: 'olhar'; alvo: string; angulo: number; texto: string }
  | { tipo: 'relogio'; texto: string }   // levantar o pulso e olhar o relógio (R no Simular VR)
  | { tipo: 'manual'; texto: string };
export interface BlocoAguardar { t: number; condicao: Condicao; }
export interface BlocoEvento { t: number; nome: string; }

interface FaixaBase { id: string; nome: string; }
export type Faixa =
  | (FaixaBase & { tipo: 'mover'; alvo: string; chaves: ChaveMover[] })
  | (FaixaBase & { tipo: 'animacao'; alvo: string; blocos: BlocoAnimacao[] })
  | (FaixaBase & { tipo: 'fala'; blocos: BlocoFala[] })
  | (FaixaBase & { tipo: 'som'; blocos: BlocoSom[] })
  | (FaixaBase & { tipo: 'visivel'; alvo: string; chaves: ChaveVisivel[] })
  | (FaixaBase & { tipo: 'seta'; blocos: BlocoSeta[] })
  | (FaixaBase & { tipo: 'aguardar'; blocos: BlocoAguardar[] })
  | (FaixaBase & { tipo: 'evento'; blocos: BlocoEvento[] });

export type TipoFaixa = Faixa['tipo'];

export interface Jogador { pos: Vec3; rotY: number; }

export interface Cena {
  id: string;
  nome: string;
  duracao: number;
  fundo: string;           // cor do céu
  jogador: Jogador;
  cenario: ObjetoCenario[];
  atores: Ator[];
  faixas: Faixa[];
  caminhos?: Caminho[];
  notas?: string;
}

export interface Pacote {
  versao_formato: 1;
  projeto: string;
  personagens: Record<string, string>; // id → nome mostrado na legenda
  cenas: Cena[];
  falas_por_evento?: FalaPorEvento[];
  /** Luzes de teste (18/10): só vistas e testadas no editor; o jogo usa as mesmas. */
  iluminacao?: Iluminacao;
  /** Mesa de som (18/10): volume de cada som e de cada grupo; o jogo usa os mesmos valores. */
  mixagem?: Mixagem;
}

export type GrupoSom = 'musica' | 'efeitos' | 'vozes';
export interface SomMix {
  /** Volume do arquivo (0 a 1). Regra do autor: trilha 15–20%, efeitos 35–50% (menos se for agudo). */
  volume: number;
  grupo: GrupoSom;
  /** Quando toca no jogo (só para lembrar). */
  descricao?: string;
}
/** Som de objeto que toca quando um evento da cena acontece (o jogo faz o mesmo). */
export interface SomPorEvento { evento: string; som: string; atraso?: number; loop?: boolean }
export interface Mixagem {
  /** Volume geral de cada grupo (no jogo, o jogador muda pelo menu: Música, Efeitos, Vozes). */
  grupos: Record<GrupoSom, number>;
  /** Quanto a música fica enquanto alguém fala (0,5 = metade). */
  abaixar_musica: number;
  sons: Record<string, SomMix>;
  por_evento: SomPorEvento[];
}

export type ModoLuz = 'sem_sombras' | 'jogo' | 'detalhado';

/** Luz colorida de uma sala (ponto de luz). Acende quando o evento acontece (ex.: acender_luz_ponte). */
export interface LuzSala {
  id: string;
  nome: string;
  pos: Vec3;
  cor: string;
  /** Força da luz acesa (como a "energy" de uma OmniLight3D da Godot; queda suave, linear com a distância). */
  intensidade: number;
  /** Até onde a luz chega (m). */
  alcance: number;
  /** Evento que acende a luz; sem ele, fica sempre acesa. */
  acende_evento?: string;
  /** Quanto fica acesa antes do evento (0 = apagada, 0,2 = fraquinha). */
  apagada?: number;
  /** Cor antes do evento (sem ela, a mesma cor da missão). */
  cor_apagada?: string;
}

export interface Iluminacao {
  /** Modo que o editor abre e que o jogo usa no Quest. */
  modo_padrao: ModoLuz;
  /** Força da luz geral (céu/chão) e da luz do teto em cada modo. */
  geral?: Record<ModoLuz, { ceu: number; sol: number }>;
  luzes: LuzSala[];
  notas?: string;
}

/** Itens "pontuais" ou com duração de qualquer faixa, para a linha do tempo tratar todos igual. */
export interface ItemFaixa { t: number; dur: number; rotulo: string; }

export const COR_FAIXA: Record<TipoFaixa, string> = {
  mover: '#8fd651', animacao: '#b9c2c8', fala: '#4fd6d0', som: '#8a5cf0',
  visivel: '#ffd166', seta: '#4fd6d0', aguardar: '#ffd166', evento: '#ff7a6b',
};

export const NOME_TIPO: Record<TipoFaixa, string> = {
  mover: 'Mover', animacao: 'Animação', fala: 'Falas', som: 'Som e música',
  visivel: 'Mostrar e esconder', seta: 'Seta holográfica', aguardar: 'Aguardar', evento: 'Evento',
};

export function novoId(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Garante campos que podem faltar num arquivo vindo de fora. */
export function normalizarPacote(p: Pacote): Pacote {
  if (p.versao_formato !== 1) throw new Error('Pacote de cenas em formato desconhecido.');
  p.personagens ??= {};
  // campos opcionais acrescentados em 18/10 (caminhos, falas_por_evento, ator.relogio): pacotes antigos continuam valendo
  p.falas_por_evento ??= [];
  for (const c of p.cenas) {
    c.fundo ??= '#0a141c';
    c.jogador ??= { pos: [0, 0, 0], rotY: 0 };
    c.cenario ??= []; c.atores ??= []; c.faixas ??= []; c.caminhos ??= [];
    for (const a of c.atores) { a.escala ??= 1; a.rotY ??= 0; a.visivel ??= true; a.falarAutomatico ??= true; }
    for (const f of c.faixas) {
      if ('chaves' in f) f.chaves.sort((a, b) => a.t - b.t);
      if ('blocos' in f) (f.blocos as { t: number }[]).sort((a, b) => a.t - b.t);
    }
  }
  return p;
}
