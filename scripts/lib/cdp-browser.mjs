import { execFileSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 15_000;

export function discoverCdpOrigin(environment = process.env) {
  if (environment.CDP_URL) return environment.CDP_URL;
  const route = execFileSync("ip", ["route", "show", "default"], {
    encoding: "utf8"
  });
  const gateway = /\bvia\s+([0-9.]+)/u.exec(route)?.[1];
  if (!gateway) throw new Error("gateway do Windows não encontrado");
  return `http://${gateway}:9223`;
}

export async function connectCdpBrowser(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const origin = options.origin ?? discoverCdpOrigin(options.environment);
  const versionResponse = await fetch(`${origin}/json/version`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!versionResponse.ok) {
    throw new Error(`CDP version retornou HTTP ${versionResponse.status}`);
  }
  const version = await versionResponse.json();
  if (!version.webSocketDebuggerUrl) {
    throw new Error("CDP não expôs WebSocket do browser");
  }
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout ao conectar ao browser CDP")),
      timeoutMs
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", (error) => {
      clearTimeout(timer);
      reject(error);
    }, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) {
      operation.reject(new Error(
        `${operation.method}: ${message.error.message}`
      ));
    }
    else operation.resolve(message.result);
  });

  function send(method, params = {}, sessionId = undefined) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout CDP: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {})
      }));
    });
  }

  async function createIsolatedPage(url, pageOptions = {}) {
    const { browserContextId } = await send("Target.createBrowserContext", {
      disposeOnDetach: true
    });
    const originUrl = new URL(url).origin;
    if (pageOptions.permissions?.length) {
      await send("Browser.grantPermissions", {
        browserContextId,
        origin: originUrl,
        permissions: pageOptions.permissions
      });
    }
    const createTarget = {
      url,
      browserContextId,
      background: false
    };
    if (pageOptions.newWindow === true) createTarget.newWindow = true;
    const { targetId } = await send("Target.createTarget", createTarget);
    const attached = await send("Target.attachToTarget", {
      targetId,
      flatten: true
    });
    const sessionId = attached.sessionId;
    await Promise.all([
      send("Runtime.enable", {}, sessionId),
      send("Page.enable", {}, sessionId)
    ]);

    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
        );
      }
      return result.result?.value;
    }

    async function waitFor(expression, waitOptions = {}) {
      const deadline = Date.now() + (waitOptions.timeoutMs ?? timeoutMs);
      while (Date.now() < deadline) {
        const value = await evaluate(expression).catch(() => null);
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`condição CDP não atingida: ${expression}`);
    }

    await waitFor("document.readyState === 'complete'");
    let closed = false;
    return Object.freeze({
      browserContextId,
      targetId,
      sessionId,
      send(method, params = {}) {
        return send(method, params, sessionId);
      },
      evaluate,
      waitFor,
      async close() {
        if (closed) return;
        closed = true;
        await send("Target.closeTarget", { targetId }).catch(() => {});
        await send("Target.disposeBrowserContext", { browserContextId })
          .catch(() => {});
      }
    });
  }

  let closed = false;
  return Object.freeze({
    origin,
    version,
    send,
    createIsolatedPage,
    async close() {
      if (closed) return;
      closed = true;
      for (const operation of pending.values()) {
        clearTimeout(operation.timer);
        operation.reject(new Error("CDP encerrado"));
      }
      pending.clear();
      socket.close();
    }
  });
}
