import { createHash } from "node:crypto";

function serialize(value, path, seen) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contém número não finito`);
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "undefined") {
    throw new TypeError(`${path} contém undefined`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contém tipo não serializável: ${typeof value}`);
  }
  if (seen.has(value)) {
    throw new TypeError(`${path} contém referência circular`);
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item, index) => serialize(item, `${path}[${index}]`, seen))
        .join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${path} precisa conter apenas objetos JSON`);
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`, seen)}`
      )
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return serialize(value, "$", new Set());
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

