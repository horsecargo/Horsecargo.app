import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../www/', import.meta.url));
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(full));
    else result.push(full);
  }
  return result;
}
const hash = createHash('sha256');
for (const file of (await files(root)).sort()) {
  if (file === path.join(root, 'sw.js')) continue;
  hash.update(path.relative(root, file).replaceAll('\\', '/'));
  hash.update('\0');
  hash.update(await readFile(file));
  hash.update('\0');
}
// Include worker logic as well, normalizing the self-referential cache name.
const workerPath = path.join(root, 'sw.js');
const worker = await readFile(workerPath, 'utf8');
hash.update(worker.replace(/const CACHE = '[^']+';/, 'const CACHE = RELEASE;'));
const release = hash.digest('hex').slice(0, 16);
await writeFile(workerPath, worker.replace(/const CACHE = '[^']+';/, `const CACHE = 'hc-shell-${release}';`));
console.log(`Horse Cargo web release: ${release}`);
