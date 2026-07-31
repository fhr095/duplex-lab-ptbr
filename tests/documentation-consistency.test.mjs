import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walkMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? walkMarkdown(path)
      : entry.isFile() && entry.name.endsWith(".md")
        ? [path]
        : [];
  });
}

function githubLikeSlug(heading) {
  return heading
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/<[^>]*>/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/gu, "-");
}

function localMarkdownFiles() {
  return [
    resolve(PROJECT_ROOT, "README.md"),
    ...walkMarkdown(resolve(PROJECT_ROOT, "docs"))
  ];
}

test("documentação canônica mantém links, exemplos e uma única ordem operacional", () => {
  const files = localMarkdownFiles();
  const bodies = new Map(
    files.map((path) => [path, readFileSync(path, "utf8")])
  );
  const headings = new Map(
    [...bodies].map(([path, body]) => [
      path,
      new Set(
        body
          .split(/\r?\n/gu)
          .filter((line) => /^#{1,6}\s/u.test(line))
          .map((line) =>
            githubLikeSlug(line.replace(/^#{1,6}\s/u, ""))
          )
      )
    ])
  );

  const brokenLinks = [];
  for (const [sourcePath, body] of bodies) {
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = match[1].trim().replace(/^<|>$/gu, "");
      if (/^(?:https?:|mailto:)/u.test(target)) {
        continue;
      }
      const [relativePath, rawFragment] = target.split("#");
      const targetPath = relativePath
        ? resolve(dirname(sourcePath), relativePath)
        : sourcePath;
      if (!existsSync(targetPath)) {
        brokenLinks.push(
          `${relative(PROJECT_ROOT, sourcePath)} -> ${target}`
        );
        continue;
      }
      if (
        rawFragment &&
        targetPath.endsWith(".md") &&
        !headings.get(targetPath)?.has(decodeURIComponent(rawFragment))
      ) {
        brokenLinks.push(
          `${relative(PROJECT_ROOT, sourcePath)} -> #${rawFragment}`
        );
      }
    }
  }
  assert.deepEqual(brokenLinks, []);

  const fence = "`".repeat(3);
  let jsonExamples = 0;
  for (const [path, body] of bodies) {
    assert.equal(
      (body.split(fence).length - 1) % 2,
      0,
      `cerca Markdown sem par em ${relative(PROJECT_ROOT, path)}`
    );
    const marker = `${fence}json`;
    let cursor = 0;
    while ((cursor = body.indexOf(marker, cursor)) >= 0) {
      const start = cursor + marker.length;
      const end = body.indexOf(fence, start);
      assert.notEqual(end, -1);
      assert.doesNotThrow(
        () => JSON.parse(body.slice(start, end).trim()),
        `JSON inválido em ${relative(PROJECT_ROOT, path)}`
      );
      jsonExamples += 1;
      cursor = end + fence.length;
    }
  }
  assert.ok(jsonExamples > 0);

  const orderOwners = [...bodies]
    .filter(([, body]) =>
      /^## Ordem operacional consolidada$/mu.test(body)
    )
    .map(([path]) => relative(PROJECT_ROOT, path));
  assert.deepEqual(orderOwners, ["docs/ROADMAP.md"]);

  for (const path of [
    "README.md",
    "docs/AUTONOMOUS_LOOP.md",
    "docs/DECISION_RUNTIME_LEARNING_SEQUENCE.md",
    "docs/PROJECT_REFERENCE.md"
  ]) {
    assert.match(
      bodies.get(resolve(PROJECT_ROOT, path)),
      /#ordem-operacional-consolidada/u,
      `${path} precisa apontar para a ordem canônica`
    );
  }
});
