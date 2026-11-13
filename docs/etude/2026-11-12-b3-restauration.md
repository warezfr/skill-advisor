# B3 — Restaurer une installation depuis un fichier

Date : 12/11/2026. Question B3 du plan produit.

**Nature : essai réel, sur macOS seulement** (darwin arm64, Node 26.13, CLI `skills@1.8.1`). La restauration n'a pas été rejouée sur Windows ni Linux : l'essai B1 du 13/11/2026 porte sur les commandes de base, pas sur ce scénario.

Script : `essais/b3-restauration/run.mjs`. Résultat brut : `essais/b3-restauration/resultat.json`. L'essai tourne dans deux faux dossiers personnels, A et B ; une empreinte avant et après montre que les dossiers réels n'ont pas bougé.

## Ce qui a été fait

1. Machine A : installation de trois skills de deux sources, pour Claude Code et Cursor.
2. Fichier d'installation : la liste `source` + `skill`, tirée de `skills list -g --json` seul.
3. Machine B, vide : une commande `skills add` par source, rejouée depuis ce fichier.
4. Comparaison de A et B : liste, fichiers, liens, fichier de verrouillage.

## Résultat

| Point comparé | Résultat |
|---|---|
| `skills list -g --json` (chemins rendus relatifs) | identique |
| Fichiers et liens (81 comparés) | 0 différence |
| Fichier de verrouillage `~/.agents/.skill-lock.json` | mêmes entrées ; seuls `installedAt` et `updatedAt` diffèrent |
| Codes de sortie | 0 partout |

**Réponse : oui, une suite de `add` reproduit l'installation.** Le fichier d'installation peut entrer en v1 (lot E), avec les trois réserves ci-dessous.

## Réserves

1. **« À l'identique » ne vaut que si la source n'a pas changé.** Le verrou note une empreinte (`skillFolderHash`), mais `add` installe toujours la dernière version : il n'y a pas d'option pour demander une version précise (demande ouverte #11). Ici A et B ont été installées à quelques secondes d'écart. Parade : après une restauration, comparer l'empreinte obtenue à celle du fichier, et signaler chaque skill qui a changé.
2. **`list --json` ne nomme pas tous les agents.** Cursor avait été demandé ; la liste ne montre que « Claude Code », et aucun lien n'est créé dans `~/.cursor/skills`. Le CLI pose le skill dans `~/.agents/skills`, que Cursor lit directement (voir le rapport B2). Le fichier d'installation doit donc garder lui-même la liste des agents choisis : on ne peut pas la relire dans `list --json`. Précision apportée par B1 (13/11/2026) : le champ `agents` nomme les agents présents sur la machine qui lisent le dossier. Ici le faux dossier personnel n'avait pas de dossier `.cursor`, d'où l'absence de Cursor ; dans B1, où ce dossier existe, Cursor et Gemini CLI y figurent.
3. **Seuls les skills suivis se restaurent.** Une copie manuelle ou un skill de plugin n'a pas de source à rejouer.

## Reste à faire

- Rejouer cet essai sur Windows et Linux. B1 ne l'a pas fait.
- Tester le cas où la source a changé entre l'export et la restauration.
- Tester l'option `--copy` et la portée projet.
