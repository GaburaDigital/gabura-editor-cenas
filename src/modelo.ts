// Formato das cenas (o arquivo que vai e volta entre você e o Claude, e que o jogo lê).
// Não depende de engine: guarda só nomes de modelos, clipes, falas e tempos.

export type Vec3 = [number, number, number];

/** Um objeto do cenário (não muda durante a cena, só pode tocar uma animação em loop). */
export interface ObjetoCenario {
  id: string;
  modelo: string;          // nome do arquivo .glb
  pos: Vec3;
  rotY: number;            // graus
  escala: number;
  animacao?: string;       // clipe em loop (ex.: "correr" do túnel)
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
  escala: number;
  visivel: boolean;        // no começo da cena
  animacao?: string;       // clipe inicial em loop
}

/** Ponto-chave de movimento. "curva" diz como ir DESTE ponto até o próximo:
 *  linear = velocidade constante (jogador andando); suave = acelera e freia (holograma surgindo). */
export interface ChaveMover { t: number; pos: Vec3; rotY: number; escala: number; curva?: 'linear' | 'suave'; }
export interface BlocoAnimacao { t: number; dur: number; clipe: string; loop: boolean; }
export interface BlocoFala { t: number; fala: string; ator?: string; }
export interface BlocoSom { t: number; dur: number; arquivo: string; volume: number; loop: boolean; }
export interface ChaveVisivel { t: number; visivel: boolean; }
export interface BlocoSeta { t: number; dur: number; alvo: string; }
export type Condicao =
  | { tipo: 'chegar'; pos: Vec3; raio: number; texto: string }
  | { tipo: 'olhar'; alvo: string; angulo: number; texto: string }
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
  notas?: string;
}

export interface Pacote {
  versao_formato: 1;
  projeto: string;
  personagens: Record<string, string>; // id → nome mostrado na legenda
  cenas: Cena[];
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
  for (const c of p.cenas) {
    c.fundo ??= '#0a141c';
    c.jogador ??= { pos: [0, 0, 0], rotY: 0 };
    c.cenario ??= []; c.atores ??= []; c.faixas ??= [];
    for (const a of c.atores) { a.escala ??= 1; a.rotY ??= 0; a.visivel ??= true; a.falarAutomatico ??= true; }
    for (const f of c.faixas) {
      if ('chaves' in f) f.chaves.sort((a, b) => a.t - b.t);
      if ('blocos' in f) (f.blocos as { t: number }[]).sort((a, b) => a.t - b.t);
    }
  }
  return p;
}
