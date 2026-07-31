import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const DEFAULT_ROOTS = Object.freeze([
  "src",
  "web",
  "scripts",
  "tests",
  "eval/factory",
  "eval/gates",
  "eval/scenarios",
  "package.json",
  "package-lock.json",
  "requirements-asr.txt"
]);

function bytewiseTextOrder(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function collectFiles(path, files) {
  const entries = await readdir(path, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOTDIR") {
        files.push(path);
        return null;
      }
      throw error;
    });
  if (entries === null) {
    return;
  }
  for (const entry of entries.sort(
    (left, right) => bytewiseTextOrder(left.name, right.name)
  )) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(child, files);
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
}

export async function createSourceFingerprint(
  projectRoot,
  options = {}
) {
  const root = resolve(projectRoot);
  const roots = options.roots ?? DEFAULT_ROOTS;
  const files = [];
  for (const item of roots) {
    await collectFiles(resolve(root, item), files);
  }
  files.sort(bytewiseTextOrder);

  const hash = createHash("sha256");
  for (const path of files) {
    const name = relative(root, path).replaceAll("\\", "/");
    const content = await readFile(path);
    hash.update(`${name.length}:${name}:${content.length}:`, "utf8");
    hash.update(content);
  }
  return Object.freeze({
    algorithm: "sha256-source-tree-v1",
    sha256: hash.digest("hex"),
    fileCount: files.length,
    roots: [...roots]
  });
}

export { DEFAULT_ROOTS as SOURCE_FINGERPRINT_ROOTS };
