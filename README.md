# Editor de Cenas Gabura

**Link:** https://gaburadigital.github.io/gabura-editor-cenas/

<img src="docs/qrcode.png" alt="QR code do link do editor" width="180">

Ferramenta do Gaburaverso para **montar e ajustar as cenas dos jogos** numa linha do tempo, como o AnimationPlayer da Godot. Roda no **Chrome do computador** (Linux e macOS) e funciona **sem internet** depois da primeira visita.

> Na primeira visita, clique no ícone de instalar na barra de endereço do Chrome ("Instalar Editor de Cenas Gabura"). Ele vira um app e abre mesmo offline.

## Como usar

1. **Abrir arquivos** (ou arrastar para a janela): o pacote de cenas (`cenas_nave.json` ou o ZIP com os modelos), os modelos `.glb` e o **ZIP da dublagem** exportado pelo Estúdio de Dublagem. Tudo fica guardado no navegador.
2. **Editar:** clique na régua para ir a um instante, toque com **Espaço**, arraste os blocos. Na janela 3D, clique num objeto e use **Mover / Girar / Tamanho**: se ele tem faixa de movimento, o editor grava um ponto-chave no instante da linha vermelha.
3. **Simular VR:** primeira pessoa na altura de 1,60 m, com o campo de visão do Quest 3S. Clique na janela 3D para **prender o mouse** (olhar em volta) e aperte **Esc** para soltar. **W A S D** anda a 1,4 m/s. **R** mostra o relógio do pulso.
4. **Exportar cenas** (**Ctrl+S**): baixa o pacote `cenas_<projeto>.json`. É esse arquivo que vai para o Claude e para o jogo.

### Faixas

| Faixa | O que faz |
|---|---|
| Mover | Posição, giro e tamanho por pontos-chave. Cada ponto diz como ir até o próximo: velocidade constante ou suave |
| Animação | Toca um clipe do GLB (`falar`, `comemorar`…), com transição de 0,25 s |
| Falas | Toca a gravação, mostra a legenda e faz o ator mexer (`falar`) e brilhar no ritmo da voz. O tamanho do bloco é a duração do áudio |
| Som e música | Sons e músicas. Arquivos que começam com `mus` abaixam sozinhos enquanto alguém fala. Som que ainda não existe vira "espaço reservado" e toca em silêncio |
| Mostrar e esconder | Liga e desliga um objeto |
| Seta holográfica | Seta na frente do jogador apontando para um objeto |
| Aguardar | Pausa a cena até o jogador chegar a um lugar, olhar para algo, ou o jogo avisar. No Simular VR segue sozinho; no Editar, aparece o botão **Simular** (ou **Enter**) |
| Evento | Avisa o jogo para fazer algo (ex.: `mostrar_creditos`). O editor só mostra um aviso |

A câmera do jogador **nunca é tomada**: a faixa "Mover" do jogador leva a plataforma onde ele está (como a nave no túnel); a cabeça e o andar continuam dele.

### Atalhos

| Tecla | Ação |
|---|---|
| Espaço | tocar / pausar (ou seguir um "aguardar") |
| ← → | meio passo de 0,1 s (com Shift, 1 s) |
| Home / End | começo / fim da cena |
| Shift + arrastar bloco | empurra junto tudo o que vem depois, em todas as faixas |
| Alt + arrastar | solta do ímã de 0,05 s |
| Dois cliques na pista | cria um item |
| Delete | apaga o item (com aviso para desfazer) |
| Ctrl+Z / Ctrl+Y | desfazer / refazer |
| G / T / Y | mover / girar / tamanho (modo Editar) |
| F | centraliza a câmera no que está escolhido |
| Ctrl + roda do mouse | zoom da linha do tempo |
| W A S D, R, Esc | andar, relógio, soltar o mouse (Simular VR) |

### Computador sem placa de vídeo

O editor detecta e liga o **modo leve** sozinho (sem sombras, resolução menor). O medidor no canto da janela 3D mostra os quadros por segundo. Em **Ajustes** dá para forçar o modo leve ligado ou desligado.

## O formato das cenas

Um pacote (`versao_formato: 1`) com o nome do projeto, os nomes dos personagens (para a legenda) e a lista de cenas. Cada cena guarda só **nomes** (modelos `.glb`, clipes, falas) e **tempos**, então não depende de engine. No jogo, um "tocador de cenas" pequeno lê o mesmo arquivo. Exemplo em [`dados/cenas/cenas_nave.json`](dados/cenas/cenas_nave.json).

## Desenvolvimento

```bash
npm install
npm run dev      # abre em http://localhost:5173/gabura-editor-cenas/
npm run build    # gera dist/ (o GitHub Pages publica sozinho pela Action)
```

**Publicação:** Settings → Pages → Source: **GitHub Actions**. Cada envio para `main` publica de novo. No editor, **Procurar atualização** (rodapé) pega a versão nova; **Ajustes → Limpar cache do app** força baixar tudo de novo sem apagar as cenas.

Feito com Vite, TypeScript e Three.js 0.170. Licença MIT (o nome e os personagens do Gaburaverso são reservados, veja `LICENSE`).
