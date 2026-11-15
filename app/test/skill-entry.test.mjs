// isSkillEntry : ce qui compte comme un skill dans un dossier d'agent.
// Un dossier d'agent ajouté à la main peut contenir des liens ordinaires (outils, bibliothèques) :
// « Retirer tous ses skills » ne doit jamais les effacer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isSkillEntry } from '../lib/util.mjs';
import { dirLink, fileLinksOk } from './helpers.mjs';

test('isSkillEntry : dossier avec SKILL.md et lien vers lui oui ; liens vers un outil ou un dossier ordinaire non', async (t) => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-entry-'));
  t.after(() => fs.rm(d, { recursive: true, force: true }));
  const tools = path.join(d, 'tools');
  await fs.mkdir(tools);
  await fs.writeFile(path.join(tools, 'outil'), 'x');
  await fs.mkdir(path.join(d, 'vrai'));
  await fs.writeFile(path.join(d, 'vrai', 'SKILL.md'), '---\nname: vrai\n---\n');
  await fs.mkdir(path.join(d, 'dossier-ordinaire'));
  await dirLink(path.join(d, 'vrai'), path.join(d, 'lien-skill'));
  await dirLink(tools, path.join(d, 'lien-dossier'));
  assert.equal(await isSkillEntry(path.join(d, 'vrai')), true);
  assert.equal(await isSkillEntry(path.join(d, 'lien-skill')), true);
  assert.equal(await isSkillEntry(path.join(d, 'lien-dossier')), false);
  assert.equal(await isSkillEntry(path.join(d, 'dossier-ordinaire')), false);
  assert.equal(await isSkillEntry(path.join(d, 'absent')), false);
  if (await fileLinksOk()) {
    await fs.symlink(path.join(tools, 'outil'), path.join(d, 'lien-fichier'));
    await fs.symlink('../lib/node_modules/x/bin', path.join(d, 'casse-outil'));
    await fs.symlink('../../.agents/skills/casse', path.join(d, 'casse'));
    assert.equal(await isSkillEntry(path.join(d, 'lien-fichier')), false);
    assert.equal(await isSkillEntry(path.join(d, 'casse-outil')), false, 'lien cassé qui ne vise pas un dossier de skills');
    assert.equal(await isSkillEntry(path.join(d, 'casse')), true, 'lien cassé posé par le moteur (…/skills/<nom>)');
  }
});
