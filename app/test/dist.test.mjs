// prototype/dist est le fichier servi par l'application et par la démonstration : il doit
// correspondre exactement à prototype/src, rendu par build.mjs (constat 91).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'prototype', 'dist');
const STALE = 'prototype/dist n\'est pas à jour : lancez npm run build';

// Compare un fichier construit au rendu en mémoire, avec un message qui dit quoi faire.
function same(file, expected) {
  const p = path.join(DIST, file);
  assert.ok(fs.existsSync(p), STALE + ' (' + file + ' absent)');
  const actual = fs.readFileSync(p, 'utf8');
  if (actual === expected) return;
  // Même contenu une fois les fins de ligne ramenées à LF : checkout en CRLF, pas un oubli de build.
  if (actual.replace(/\r\n?/g, '\n') === expected) {
    assert.fail(STALE + ' (' + file + ' est en CRLF : le dépôt doit être extrait en LF, voir .gitattributes)');
  }
  const a = actual.split('\n'), e = expected.split('\n');
  let i = 0;
  while (i < a.length && i < e.length && a[i] === e[i]) i++;
  assert.fail(STALE + ' (' + file + ', première différence ligne ' + (i + 1) + ')');
}

test('prototype/dist correspond à prototype/src (build.mjs render)', async () => {
  const build = await import(pathToFileURL(path.join(ROOT, 'prototype', 'build.mjs')).href);
  assert.equal(typeof build.render, 'function', 'prototype/build.mjs doit exporter render()');
  const r = build.render();
  assert.deepEqual(r.missing, [], 'fichiers sources absents : ' + r.missing.join(', '));
  same('preview.html', r.preview);
  same('page.html', r.page);
});

test('prototype/dist contient une interface complète', () => {
  const html = fs.readFileSync(path.join(DIST, 'preview.html'), 'utf8');
  assert.match(html, /<title>Skill Advisor<\/title>/);
  assert.match(html, /SA\.start\(\)/, 'le démarrage de l\'interface manque');
  assert.ok(!/\r/.test(html), 'preview.html contient des CR');
});
