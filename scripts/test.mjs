#!/usr/bin/env node
/**
 * Wrapper de `vitest` para os scripts do package.json.
 *
 *   npm test                      # roda a suíte uma vez (vitest run)
 *   npm test -- format            # roda apenas arquivos que casam com "format"
 *   npm run test watch            # modo watch (equivalente a `npm run test:watch`)
 *   npm run test:watch            # modo watch
 *
 * Motivo de existir: `npm run test watch` entrega `watch` como argumento
 * posicional, e o Vitest interpreta posicionais como filtro de nome de
 * arquivo. O resultado era `No test files found, exiting with code 1` mesmo
 * com a suíte toda verde. Aqui um `watch` isolado vira o modo watch; os
 * demais argumentos continuam sendo filtros.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

if (!fs.existsSync(VITEST)) {
  console.error('Vitest não encontrado. Rode `npm install` antes de `npm test`.');
  process.exit(1);
}

const raw = process.argv.slice(2);
const watch = raw.includes('watch');
const args = raw.filter((arg) => arg !== 'watch');

const result = spawnSync(
  process.execPath,
  [VITEST, ...(watch ? [] : ['run']), ...args],
  { cwd: ROOT, stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
