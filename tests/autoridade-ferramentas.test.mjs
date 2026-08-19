import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classeDaFerramenta,
  evidenciaPropriedade,
  podeExecutarFerramenta
} from "../src/tools/autoridade.mjs";

test("Open-Meteo é leitura pública e segue permissivo", () => {
  const classe = classeDaFerramenta("open-meteo");
  assert.equal(classe, "leitura-publica");
  assert.equal(
    podeExecutarFerramenta({ classe, propriedade: evidenciaPropriedade() })
      .ok,
    true
  );
});

test("ferramenta desconhecida é tratada como ESCRITA (fail-closed)", () => {
  assert.equal(classeDaFerramenta("enviar-email"), "escrita");
});

test("escrita SEM lease de autoridade é bloqueada — zero ações externas não autorizadas", () => {
  const decisao = podeExecutarFerramenta({
    classe: "escrita",
    propriedade: evidenciaPropriedade()
  });
  assert.equal(decisao.ok, false);
  assert.equal(decisao.motivo, "escrita-sem-lease");
});

test("escrita COM lease do produto executa", () => {
  const propriedade = { ...evidenciaPropriedade(), lease: "toque-tela" };
  assert.equal(
    podeExecutarFerramenta({ classe: "escrita", propriedade }).ok,
    true
  );
});

test("leitura sensível exige endereçamento não-incerto", () => {
  const incerto = evidenciaPropriedade({
    cena: { veredicto: "adversa" }
  });
  assert.equal(incerto.enderecamento, "incerto-cena");
  assert.equal(
    podeExecutarFerramenta({ classe: "leitura-sensivel", propriedade: incerto })
      .ok,
    false
  );
  const limpo = evidenciaPropriedade({ cena: { veredicto: "limpa" } });
  assert.equal(
    podeExecutarFerramenta({ classe: "leitura-sensivel", propriedade: limpo })
      .ok,
    true
  );
});

test("evidência de propriedade é honesta sobre o não-instrumentado", () => {
  const evidencia = evidenciaPropriedade();
  assert.equal(evidencia.fonte, "nao-instrumentada");
  assert.equal(evidencia.participacao, "presumida-unica");
  assert.equal(evidencia.lease, null);
});
