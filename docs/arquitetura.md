# Como o Sellomaker funciona — e como construir o mesmo, do zero

Documento de arquitetura + protótipo funcional. Setembro de 2026.

---

## 1. O que o site realmente é

O Sellomaker não é um "conversor de SVG para STL". É um **configurador de matriz de relevo seco**
(*dry embossing*): duas placas que se fecham sobre o papel, uma com o desenho em alto-relevo
(macho) e outra com a mesma forma escavada (fêmea), unidas por dobradiça ou ímãs. O SVG é só a
entrada; o produto é um par de peças que precisam encaixar uma na outra com o papel no meio.

Isso muda tudo no projeto: o problema difícil não é "extrudar o vetor", é **gerar a contraparte
com a folga certa**.

### O que dá para verificar por dentro

Lendo os módulos que o site serve (`engine.js`, 146 kB; `main.js`, 85 kB; `text-tool.js`):

| Camada | O que usam |
|---|---|
| 3D | `three@0.160.0` por importmap (CDN jsDelivr), `OrbitControls`, `SVGLoader`, `STLLoader`, `STLExporter` |
| Geometria | `SVGLoader.createShapes` → `ExtrudeGeometry` com bisel (18 ocorrências de `ExtrudeGeometry`, 20 de `bevel`, 77 de `holes`) |
| Booleanas | **nenhuma** — zero menções a CSG, `Brush`, `Evaluator` ou `subtract`. Sólidos sobrepostos, unidos só na hora de fatiar |
| Offset | `offsetPolygon` próprio (bissetriz), sem Clipper |
| Dobradiça | STL pré-modelado baixado do WordPress (`/wp-content/uploads/2025/12/Bisagra.stl`), carregado com `STLLoader` e mesclado |
| Backend | Firebase: Auth (Google), Firestore (projetos), Storage (STL gerado) |
| Monetização | Mercado Pago + PayPal, créditos de exportação, assinatura mensal, cupons, `requestExportAuth` no servidor |
| Texto | 10 fontes do Google Fonts, limite de 40 caracteres |

### Os parâmetros que eles usam (extraídos do `DEFAULTS`/`STATE` em execução)

```
cornerRadius 5      plateWidth 64.29    plateHeight 45     thickness 4
padding 4           logoOffset 4.5      hingeCount 1       gap -4
specs.relief 0.40   specs.depth 0.42    tolerance 0.22
```

E os presets de material aparecem como pares `relief/depth` no código:
`0.40/0.42` (lata de alumínio), `0.50/0.52`, `0.60/0.62`, `1.20/1.25` (cartão 300 g).

Dois números explicam o produto inteiro:

- **`depth = relief + 0,02`** — a cavidade é um fio mais funda que o relevo é alto, para o macho
  não bater no fundo.
- **`tolerance = 0,22`** — a folga *lateral* da cavidade. Não é tolerância de impressão: é a
  **espessura do papel**. O papel precisa entrar entre as duas paredes sem rasgar. Por isso cada
  material tem seu par de valores.

### O modelo de negócio, em uma linha

O 3D é grátis e roda inteiro no cliente; o botão de download é o paywall
(`checkExportPermission` → créditos ou assinatura → `uploadSTLToStorage`). O aviso
*"PREVIEW ONLY — the final download will include high-precision technical geometry"* sugere que a
malha final seria recalculada com mais resolução no momento da exportação.

---

## 2. Onde estão as dificuldades de verdade

Quem tenta fazer isso "extrudando o SVG" trava em cinco pontos. Todos foram resolvidos no
protótipo:

**a) Furos.** Um logo não é um polígono: é uma árvore. O contorno externo da letra "e" contém um
vazio, que pode conter uma ilha, que pode conter outro vazio. `SVGLoader` resolve isso de um jeito;
eu resolvo por **profundidade de aninhamento**: para cada contorno, lanço um raio horizontal, acho
um ponto interior garantido e conto quantos outros contornos o contêm. Profundidade par = tinta,
ímpar = vazio. Funciona para `nonzero`, `evenodd` e para logos com vários `<path>` soltos.

**b) A fêmea não é o macho invertido.** Ela é o macho **espelhado no eixo da dobra** (senão o
relevo sai ao contrário quando você fecha) e **dilatado pela espessura do material**. Dilatar uma
árvore de contornos significa empurrar os anéis pares para fora e os ímpares para dentro do vazio —
sinais opostos, mesma operação.

**c) Detalhe fino some.** Com folga de 0,32 mm (cartão 300 g), qualquer traço com menos de
0,64 mm de largura desaparece na fêmea. O gerador detecta o anel degenerado, remove o ramo inteiro
da árvore e **avisa** em vez de exportar uma peça que não fecha.

**d) Saída de ângulo.** Parede reta agarra o papel. O topo do relevo é deslocado para dentro
(e o fundo da cavidade também), criando um ângulo de saída de ~7°. São 0,06 mm de deslocamento —
invisível, decisivo na hora de descolar.

**e) Malha válida.** Sobrepor sólidos (o que o Sellomaker faz) funciona no fatiador, mas produz um
STL que nenhum validador aceita. Dá para fazer melhor sem booleanas — ver abaixo.

---

## 3. A arquitetura que eu construí

Sete módulos ES, sem framework. A única dependência externa é o three.js — e só para
**desenhar** a pré-visualização e emprestar o triangulador (`ShapeUtils.triangulateShape`, que é o
earcut). Toda a geometria exportada é código próprio, o que permite rodar o pipeline inteiro fora do
navegador e testar de verdade.

```
SVG ──► svgpoly.js ──► contornos ──► geom.js ──► árvore de tinta
                                                      │
  texto ──► text.js ──────────────────────────────────┤
                                                      ▼
                                        stamp.js  (regras do selo)
                                                      │
                                                      ▼
                                        mesh.js   (placa manifold)
                                                      │
                              ┌───────────────────────┴─────────────┐
                              ▼                                     ▼
                    three.js (preview)                exporters.js (STL / 3MF / zip)
```

| Módulo | Responsabilidade |
|---|---|
| `svgpoly.js` | Parser próprio do atributo `d` (M L H V C S Q T A Z, relativo e absoluto, flags de arco coladas), achatamento adaptativo de Bézier e arcos por desvio máximo, `transform` composto, `path/rect/circle/ellipse/polygon`, inversão do eixo Y, avisos para `<text>`, `<use>`, `clip-path` e traços sem preenchimento |
| `geom.js` | Área com sinal, ponto-em-polígono, ponto interior por raio, aninhamento em árvore, offset por bissetriz com limite de esquadria, Douglas–Peucker, retângulo com raio por canto, marching squares com interpolação sub-pixel |
| `mesh.js` | Sopa de triângulos, extrusão de região com furos, **`buildPlate`**, e um passe final que costura bordas órfãs |
| `stamp.js` | Presets de material, contorno ameado das placas, nós da dobradiça, bolsos de ímã, espelhamento e dilatação da fêmea |
| `text.js` | Texto → contornos reais |
| `exporters.js` | STL binário, zip *stored* com CRC-32 escrito à mão, 3MF multicolor |
| `app.js` | Interface, cena, exportação |

### A decisão central: placa manifold sem booleanas

Em vez de empilhar prismas (o que cria faces coincidentes), `buildPlate` percorre a árvore de tinta
e emite **uma única casca fechada**:

- tampa inferior, com as bocas dos bolsos de ímã já recortadas;
- parede externa;
- superfície superior montada por nível: `triangulate(contorno da placa, [contornos de nível 0])`
  no plano da placa, `triangulate(cada vazio, [ilhas dentro dele])` também no plano da placa, e a
  face de cada região de tinta em `z = espessura + relevo`;
- paredes verticais em cada fronteira, com a orientação dada pela paridade do nó.

O sinal de `relevo` faz o resto: positivo levanta (macho), negativo escava (fêmea) — **o mesmo
código gera as duas placas**, e a normal de cada parede se inverte sozinha porque o produto vetorial
acompanha o sinal de `z₂ − z₁`.

Resultado verificado com `trimesh`, fora do navegador:

```
matriz-relevo-exemplo.stl   watertight True   winding consistent True
                            5 sólidos   23,42 cm³   2.840 triângulos
```

(Dois casos patológicos de teste — anel com furo, quadrado com furo e ilha, bordas exatamente
colineares entre contornos distintos — também passam: `watertight True` nos modos dobradiça e ímãs.)

### Dobradiça gerada, não baixada

O Sellomaker mescla um STL pronto. Aqui os nós são procedurais, mas a **geometria é a mesma** —
medida a partir da malha que o app deles põe em cena e reimplementada:

| | valor |
|---|---|
| eixo de giro | `z = espessura`, na altura da face gravada |
| raio do barril | 3,0 mm (topo da peça em `espessura + 3`) |
| furo | R 1,75 mm, cego, 2,1 mm de profundidade em cada ponta |
| pino integral | R 1,25 mm, 2,2 mm de avanço |
| folga radial pino↔furo | 0,50 mm |
| folga axial entre nós | 0,30 mm |
| parede interna da placa | `3·√2 + 0,16` = 4,40 mm do eixo |
| nós | 5, 7 ou 9, na proporção 1 : 2,5 : 1 : 2,5 : 1 da altura |

Três coisas fazem a peça funcionar, e todas estavam erradas na primeira versão:

**O eixo fica na face de cima, não no meio da placa.** Ao girar 180°, a placa B pousa exatamente
sobre a A com as duas faces gravadas encostadas — que é onde o papel entra. Com o eixo em
`espessura/2` as placas se atravessavam.

**O barril se apoia em duas rampas de 45° tangentes a ele**, uma subindo até a parede interna da
placa, outra descendo até a mesa. Nada no perfil passa de 45°, então imprime deitado sem suporte, e
o barril não fica preso por uma lasca de material.

**O pino é parte da peça.** Os nós de uma placa nascem maciços com um pino que já começa dentro do
furo do nó vizinho; sai articulado da mesa, sem filamento avulso nem peça solta. A folga radial de
0,5 mm é o que impede as camadas de soldarem.

O `0,16 mm` da parede interna não é arbitrário: é a folga que sobra entre a rampa da placa B girada
180° e a face de cima da placa A. Menos que isso e a peça não fecha.

Cada nó é montado empilhando prismas (`prism`), o que deixa faces coincidentes internas — o teste
reporta `dup` > 0 na dobradiça. Não há CSG no projeto; as faces internas ficam dentro de um único
corpo impresso e nenhum fatiador se importa. O que importa (`unmatched`, arestas sem par) é zero.

### Texto sem arquivo de fonte

Não existe API de navegador para extrair contornos de glifo, e o sandbox do artifact bloqueia
baixar um `.ttf` para passar pelo opentype.js. A saída: desenhar o texto num canvas a 26 px/mm,
ler o canal alpha e extrair a curva de nível com **marching squares interpolado** — o ponto de
cruzamento é calculado por interpolação linear do alpha, não arredondado para a borda do pixel, o
que dá curvas lisas em vez de escada. Depois, Douglas–Peucker a 0,013 mm. Texto em arco é desenhado
glifo a glifo sobre a circunferência antes da extração.

---

## 4. Stack: por que 100% navegador

Você me deixou escolher. Escolhi cliente puro, e o motivo não é ideológico:

| | Navegador | Backend Python (shapely + trimesh + manifold3d) |
|---|---|---|
| Custo por usuário | zero | CPU por exportação |
| Latência | ~40 ms por ajuste de slider | ida e volta a cada mudança |
| Robustez geométrica | offset por bissetriz, sem booleanas | offset real, booleanas exatas |
| Proteger o código | impossível | fácil |
| Cobrar | precisa de servidor mesmo assim (só para autorizar) | natural |

A geometria de uma matriz de relevo é **2,5D** — regiões planas extrudadas. Nesse recorte, offset por
bissetriz e triangulação com furos bastam; booleanas 3D seriam ferramenta demais. O momento de mudar
é outro: se um dia a peça tiver chanfro real, encaixe cônico, filete nas bordas ou união de sólidos
que se cruzam, aí vale um backend com `manifold3d` (ou `OpenCascade` via `opencascade.js`, que
roda em WASM e mantém tudo no cliente).

O caminho híbrido que o próprio Sellomaker insinua — preview no cliente, malha final no servidor —
só faz sentido quando a exportação for paga, e aí o servidor existe pelo paywall, não pela
geometria.

**Limite honesto do que construí:** o offset por bissetriz não trata auto-interseção. Em folgas
grandes (acima de ~0,4 mm) sobre curvas de raio pequeno, o anel pode se cruzar. O código detecta a
degeneração pela inversão do sinal da área e descarta o offset daquele anel, mas o correto seria um
Clipper (`js-angusj-clipper`, WASM, ~300 kB) — é a primeira dependência que eu adicionaria.

---

## 5. O protótipo

Publiquei como artifact, funcionando: sobe o SVG, ajusta, baixa.

O que está pronto e equivale ao original:

- upload/arrastar SVG, com avisos quando a arte não serve (traço não expandido, `<text>` vivo, `<use>`)
- 4 presets de material (lata, papel, vegetal, cartão 300 g) ligados a relevo + folga
- placa parametrizada: largura, altura, espessura, raio do canto, margem
- dobradiça com 3, 5 ou 7 nós, ou 2/4 ímãs com bolso dimensionado
- texto em 10 fontes, com curvatura, convertido em contorno real
- escala, rotação de 90°, posição vertical, trocar lados
- ajustes finos: relevo, folga lateral, folga de fundo, saída de ângulo, simplificação
- corte esquemático que se atualiza com os parâmetros (o desenho que explica o produto)
- pré-visualização 3D com órbita, vistas ISO/topo/frente, leitura de dimensão e contagem de triângulos
- exportação STL + 3MF multicolor, empacotados em zip com peça inteira, partes separadas, LEIA-ME
  com os parâmetros e `projeto.json` para recarregar

O que **não** está e seria o trabalho de produto: conta de usuário, cobrança, biblioteca de
modelos prontos, galeria de designs, i18n e a operação de impressão sob demanda.

Um detalhe da plataforma: o sandbox do artifact não deixa a página baixar `.stl` direto (extensão
fora da lista permitida), então a exportação entrega um **.zip** — que por acaso é melhor, porque
cabem as partes separadas e o LEIA-ME junto.

---

## 6. Se fosse virar produto

Na ordem em que eu faria:

1. **Clipper WASM** no lugar do offset por bissetriz. Elimina a única fragilidade geométrica real.
2. **Biblioteca de formatos**: cartão de visita, tag, envelope A7 — tamanhos de placa prontos.
3. **Modo cartucho**: em vez de dobradiça, uma alça tipo alicate (é o que dá força de verdade em
   cartão 300 g; a dobradiça plana escorrega).
4. **Autenticação + créditos** (Firebase resolve em um dia, como eles fizeram) e o servidor só para
   autorizar a exportação.
5. **Aviso de imprimibilidade** por bico: comparar cada anel com a largura do bico (0,4 mm) e
   pintar de vermelho o que não vai sair.
6. **Impressão sob demanda** — o único ponto em que dá para ganhar margem de verdade.

---

## Anexos

- `matriz-relevo-codigo.zip` — código-fonte completo, roda com `python3 -m http.server`
- `matriz-relevo-exemplo.stl` — peça de exemplo gerada pelo próprio pipeline, verificada estanque
