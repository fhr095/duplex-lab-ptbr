import { readFile } from "node:fs/promises";

const DEFAULT_ENV_URL = new URL("../../.env", import.meta.url);

function decodeValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    if (quote === "'") {
      return inner;
    }

    return inner
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  return value.replace(/\s+#.*$/u, "").trim();
}

export function parseEnvText(text) {
  const values = {};

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u.exec(
      line
    );
    if (!match) {
      continue;
    }

    values[match[1]] = decodeValue(match[2]);
  }

  return values;
}

export async function loadEnvFile(options = {}) {
  const environment = options.environment ?? process.env;
  const url = options.url ?? DEFAULT_ENV_URL;
  const override = options.override ?? false;

  let text;
  try {
    text = await readFile(url, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { loaded: false, keys: [] };
    }
    throw error;
  }

  const values = parseEnvText(text);
  const loadedKeys = [];

  for (const [key, value] of Object.entries(values)) {
    if (!override && environment[key] !== undefined) {
      continue;
    }
    environment[key] = value;
    loadedKeys.push(key);
  }

  return { loaded: true, keys: loadedKeys };
}
