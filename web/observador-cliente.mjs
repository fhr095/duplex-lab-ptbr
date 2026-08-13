// Cliente do observador de experiência: quando o servidor roda com
// OBSERVER=1, envia em lotes (beacons) o que só o navegador sabe — quando
// cada áudio do assistente realmente tocou/terminou/foi cortado, o log da
// página e as marcações humanas. Com o observador inativo, tudo é no-op.
// Nenhum áudio sai do navegador por aqui: só metadados e timestamps.

const MARCAS = [
  ["demorou", "🐢 demorou"],
  ["entendeu-errado", "❌ entendeu errado"],
  ["interrompeu", "✂️ interrompeu"],
  ["estranho", "🤖 estranho"],
  ["otimo", "⭐ ótimo"],
  ["outro", "✏️ outro"]
];

const estado = {
  ativo: false,
  sessionId: null,
  fila: [],
  timer: null
};

function empurrar(entrada) {
  if (!estado.ativo) {
    return;
  }
  estado.fila.push({
    p: performance.now(),
    tc: Date.now(),
    ...entrada
  });
  if (estado.fila.length >= 200) {
    void enviar();
  }
}

async function enviar(final = false) {
  if (!estado.ativo || estado.fila.length === 0) {
    return;
  }
  const entries = estado.fila.splice(0, estado.fila.length);
  const lote = JSON.stringify({
    sessionId: estado.sessionId,
    clientEpochMs: Date.now(),
    perfNow: performance.now(),
    entries
  });
  try {
    if (final && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/observador/beacon",
        new Blob([lote], { type: "application/json" })
      );
      return;
    }
    const resposta = await fetch("/api/observador/beacon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: lote,
      keepalive: final
    });
    const corpo = await resposta.json().catch(() => null);
    if (corpo && corpo.ativo === false) {
      estado.ativo = false;
    }
  } catch {
    // Beacons são melhor-esforço: falha de rede não pode afetar a sessão.
    if (estado.fila.length < 2_000) {
      estado.fila.unshift(...entries);
    }
  }
}

function montarBarraDeMarcas() {
  const barra = document.createElement("div");
  barra.id = "observadorMarcas";
  barra.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:9999;display:flex;" +
    "flex-wrap:wrap;gap:6px;max-width:340px;padding:8px;border-radius:10px;" +
    "background:rgba(20,20,28,.92);color:#eee;font:12px system-ui;" +
    "box-shadow:0 2px 12px rgba(0,0,0,.4)";
  const titulo = document.createElement("div");
  titulo.style.cssText =
    "flex-basis:100%;display:flex;align-items:center;gap:6px";
  titulo.innerHTML =
    "<span style='width:8px;height:8px;border-radius:50%;" +
    "background:#e33;display:inline-block'></span>" +
    "<strong>observador gravando</strong> · marque momentos:";
  barra.append(titulo);
  for (const [tipo, rotulo] of MARCAS) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = rotulo;
    botao.style.cssText =
      "padding:4px 8px;border-radius:8px;border:1px solid #555;" +
      "background:#2a2a35;color:#eee;cursor:pointer";
    botao.addEventListener("click", () => {
      const nota = tipo === "outro"
        ? window.prompt("O que aconteceu?") ?? ""
        : "";
      if (tipo === "outro" && !nota) {
        return;
      }
      observador.marca(tipo, nota);
      botao.style.background = "#3d6b3d";
      setTimeout(() => {
        botao.style.background = "#2a2a35";
      }, 700);
    });
    barra.append(botao);
  }
  document.body.append(barra);
}

export const observador = {
  get ativo() {
    return estado.ativo;
  },

  init(health, sessionId) {
    if (health?.observador?.ativo !== true) {
      return;
    }
    estado.ativo = true;
    estado.sessionId = sessionId;
    estado.timer = setInterval(() => void enviar(), 2_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void enviar(true);
      }
    });
    window.addEventListener("pagehide", () => void enviar(true));
    montarBarraDeMarcas();
    empurrar({
      c: "pagina",
      type: "observador.cliente.iniciado",
      detail: JSON.stringify({
        pasta: health.observador.pasta,
        url: window.location.search,
        userAgent: navigator.userAgent
      })
    });
  },

  uid() {
    return typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `uid-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
  },

  pagina(type, detail) {
    empurrar({ c: "pagina", type, detail });
  },

  reproducao(entrada) {
    empurrar({ c: "reproducao", ...entrada });
  },

  marca(tipo, nota = "") {
    empurrar({ c: "marca", tipo, nota });
  }
};
