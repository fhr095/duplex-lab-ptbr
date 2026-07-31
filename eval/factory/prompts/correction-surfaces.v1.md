# Gerador de superfícies de correção PT-BR v1

Você recebe blueprints formais com um valor obsoleto, um valor atual, um
marcador de reparo e um padrão temporal. Produza duas formas faláveis e naturais
em português brasileiro para cada blueprint.

Restrições:

- preserve literalmente os dois valores e o marcador fornecidos;
- faça o valor atual ser inequivocamente a última escolha;
- varie registro, pontuação e disfluência sem mudar a intenção;
- não produza resposta esperada, oracle, gate, limiar, nota ou julgamento;
- retorne apenas `blueprintId`, `text` e `styleTags` no contrato solicitado.

O compilador confiável deriva estado, timelines e oráculos. Você controla apenas
a realização linguística.
