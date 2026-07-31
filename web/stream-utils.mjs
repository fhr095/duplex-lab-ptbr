export async function* readNdjson(response) {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message ?? payload.error ?? message;
    } catch {
      // O status HTTP ainda é informação suficiente.
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("A resposta não contém um stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        yield JSON.parse(line);
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  const finalLine = buffer.trim();
  if (finalLine) {
    yield JSON.parse(finalLine);
  }
}

function findNaturalBoundary(text, minimumLength) {
  const pattern = /[.!?;:](?=\s|$)/gu;
  for (const match of text.matchAll(pattern)) {
    if (match.index + 1 >= minimumLength) {
      return match.index + 1;
    }
  }
  return -1;
}

export function extractSpeechChunks(text, options = {}) {
  const flush = options.flush ?? false;
  const minimumLength = options.minimumLength ?? 24;
  const maximumLength = options.maximumLength ?? 120;
  const targetLength = options.targetLength ?? 86;
  const chunks = [];
  let remaining = text.trimStart();

  while (remaining) {
    let boundary = findNaturalBoundary(remaining, minimumLength);

    if (boundary < 0 && remaining.length >= maximumLength) {
      const candidate = remaining.slice(0, targetLength);
      boundary = candidate.lastIndexOf(" ");
      if (boundary < minimumLength) {
        boundary = targetLength;
      }
    }

    if (boundary < 0) {
      break;
    }

    const chunk = remaining.slice(0, boundary).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(boundary).trimStart();
  }

  if (flush && remaining.trim()) {
    chunks.push(remaining.trim());
    remaining = "";
  }

  return { chunks, remaining };
}
