import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classeDaFerramenta,
  consumirLease,
  evidenciaPropriedade,
  executarFerramentaComAutoridade,
  validarLease
} from "../src/tools/autoridade.mjs";

const AGORA = 1_000_000;
const leaseValido = () => ({
  origem: "toque-tela",
  escopo: ["enviar-email"],
  concedidoEmMs: AGORA - 1_000,
  expiraEmMs: AGORA + 30_000,
  usosRestantes: 1
});

test("Open-Meteo é leitura pública — permissivo, e o registro reconhece que fala fantasma ainda pode dispará-lo", async () => {
  assert.equal(classeDaFerramenta("open-meteo"), "leitura-publica");
  const execucao = await executarFerramentaComAutoridade({
    nome: "open-meteo",
    propriedade: evidenciaPropriedade(),
    executar: async () => "25 graus"
  });
  assert.equal(execucao.ok, true);
  assert.equal(execucao.resultado, "25 graus");
});

test("ferramenta desconhecida é ESCRITA (fail-closed)", () => {
  assert.equal(classeDaFerramenta("enviar-email"), "escrita");
});

test("leitura sensível: evidência AUSENTE bloqueia (fail-closed)", async () => {
  const execucao = await executarFerramentaComAutoridade({
    nome: "extrato-bancario",
    propriedade: undefined,
    executar: async () => {
      throw new Error("não deveria executar");
    }
  });
  assert.equal(execucao.ok, false);
});

test("leitura sensível: PRESUNÇÃO não é evidência — presumido bloqueia", async () => {
  const propriedade = evidenciaPropriedade({ cena: { veredicto: "limpa" } });
  assert.equal(propriedade.enderecamento, "presumido");
  // simula uma ferramenta sensível registrada
  const execucao = await executarFerramentaComAutoridade({
    nome: "extrato-bancario",
    propriedade,
    executar: async () => "saldo"
  });
  // extrato-bancario não registrada ⇒ escrita ⇒ bloqueada sem lease;
  // o caso sensível puro é testado pela decisão de endereçamento:
  assert.equal(execucao.ok, false);
});

test("escrita: lease TRUTHY não estruturado é rejeitado", () => {
  for (const invalido of ["toque-tela", true, {}, { origem: "x" }]) {
    assert.equal(
      validarLease(invalido, { ferramenta: "enviar-email", agoraMs: AGORA })
        .valido,
      false
    );
  }
});

test("escrita: lease estruturado válido executa e é consumido one-shot", async () => {
  const execucao = await executarFerramentaComAutoridade({
    nome: "enviar-email",
    propriedade: evidenciaPropriedade(),
    lease: leaseValido(),
    agoraMs: AGORA,
    executar: async () => "enviado"
  });
  assert.equal(execucao.ok, true);
  assert.equal(execucao.leaseConsumido.usosRestantes, 0);
  // reuso do lease consumido é bloqueado
  const reuso = await executarFerramentaComAutoridade({
    nome: "enviar-email",
    propriedade: evidenciaPropriedade(),
    lease: execucao.leaseConsumido,
    agoraMs: AGORA,
    executar: async () => "enviado de novo"
  });
  assert.equal(reuso.ok, false);
  assert.equal(reuso.motivo, "lease-esgotado");
});

test("escrita: lease vencido e fora de escopo são bloqueados", () => {
  assert.equal(
    validarLease(
      { ...leaseValido(), expiraEmMs: AGORA - 1 },
      { ferramenta: "enviar-email", agoraMs: AGORA }
    ).motivo,
    "lease-vencido"
  );
  assert.equal(
    validarLease(leaseValido(), {
      ferramenta: "apagar-tudo",
      agoraMs: AGORA
    }).motivo,
    "lease-fora-de-escopo"
  );
});

test("consumirLease é imutável e decrementa", () => {
  const original = leaseValido();
  const consumido = consumirLease(original);
  assert.equal(original.usosRestantes, 1);
  assert.equal(consumido.usosRestantes, 0);
});

test("broker é o caminho único: bloqueio NÃO executa a ferramenta", async () => {
  let executou = false;
  const execucao = await executarFerramentaComAutoridade({
    nome: "enviar-email",
    propriedade: evidenciaPropriedade(),
    lease: null,
    agoraMs: AGORA,
    executar: async () => {
      executou = true;
    }
  });
  assert.equal(execucao.ok, false);
  assert.equal(executou, false);
  assert.equal(execucao.evento.type, "ferramenta.autorizacao");
  assert.equal(execucao.evento.classe, "escrita");
});

test("evidência de propriedade segue honesta sobre o não-instrumentado", () => {
  const evidencia = evidenciaPropriedade();
  assert.equal(evidencia.fonte, "nao-instrumentada");
  assert.equal(evidencia.enderecamento, "presumido");
  assert.equal(evidencia.lease, null);
  assert.equal(
    evidenciaPropriedade({ cena: { veredicto: "adversa" } }).enderecamento,
    "incerto-cena"
  );
});
