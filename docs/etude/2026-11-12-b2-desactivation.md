# B2 — Désactiver un skill sans le supprimer : mécanisme par agent

Date : 12/11/2026. Question B2 du plan produit.

**Nature : recherche dans la documentation. Aucun essai sur machine.** Ce rapport dit ce que chaque éditeur documente, pas ce qui fonctionne réellement.

Légende : **[Vérifié]** page officielle relue le 12/11/2026 ; **[Rapporté]** information de seconde main, non relue sur la source.

## Résultat

| Agent | Mécanisme documenté | Pilotable par un outil ? | Source | Statut |
|---|---|---|---|---|
| Claude Code | Réglage `skillOverrides` (`on`, `name-only`, `user-invocable-only`, `off`) ; champ `disable-model-invocation: true`. Sans effet sur les skills de plugin. | oui, fichier de réglages | code.claude.com/docs/en/skills | **[Vérifié]** |
| Gemini CLI | `/skills disable <nom>` et `/skills enable <nom>`, en session. | à établir : commande de session, aucun fichier documenté | geminicli.com/docs/cli/using-agent-skills/ | **[Vérifié]** |
| GitHub Copilot CLI | `copilot skill disable NOM` et `copilot skill enable NOM` ; menu `/skills` en session. | oui, commande | docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills | **[Vérifié]** |
| Cline | Un interrupteur par skill dans son interface. | à établir : interface seulement, aucun fichier documenté | docs.cline.bot/customization/skills | **[Vérifié]** |
| Cursor | Pas de désactivation complète. `disable-model-invocation: true` limite le skill à l'appel manuel `/nom`. | partiel, en modifiant le fichier du skill | cursor.com/docs/context/skills | **[Vérifié]** |
| Codex CLI | Entrée `[[skills.config]]` avec `enabled = false` dans `~/.codex/config.toml`. | oui, fichier | page « build skills » de la doc Codex | **[Rapporté]** |
| Antigravity | Rien trouvé. | non | antigravity.google/docs/skills | **[Rapporté]** |
| Windsurf | Rien trouvé. | non | docs.devin.ai/desktop/cascade/skills | **[Rapporté]** |

## Ce que cela change pour le produit

1. **Le repli prévu au plan est nécessaire.** Trois agents sur huit n'ont pas de désactivation complète (Cursor, Antigravity, Windsurf). Pour eux : ranger le skill dans un dossier de réserve de Skill Advisor, retour d'un clic.
2. **Trois façons de piloter, pas une.** Fichier de réglages (Claude Code, Codex), commande (Copilot CLI), geste dans l'agent lui-même (Gemini CLI, Cline). Pour ces deux derniers, il faut trouver par essai où l'état est enregistré ; sinon le repli s'applique aussi.
3. **Skills de plugin** : `skillOverrides` de Claude Code ne les touche pas. Le prototype v2 affiche donc « par le plugin » à la place de l'interrupteur.
4. **Modifier le fichier du skill** (champ `disable-model-invocation`) est à éviter : le fichier ne correspondrait plus à sa source, et la prochaine mise à jour le signalerait comme modifié.

## Écart relevé en passant : les dossiers lus

Les pages relues donnent aussi les dossiers où chaque agent lit ses skills **[Vérifié]** :

| Agent | Dossiers personnels | Dossiers de projet |
|---|---|---|
| Gemini CLI | `~/.gemini/skills`, `~/.agents/skills` | `.gemini/skills`, `.agents/skills` |
| Cursor | `~/.cursor/skills`, `~/.agents/skills`, et par compatibilité `~/.claude/skills`, `~/.codex/skills` | `.cursor/skills`, `.agents/skills`, `.claude/skills`, `.codex/skills` |
| Cline | `~/.cline/skills` | `.cline/skills`, `.clinerules/skills`, `.claude/skills` |
| Copilot CLI | `~/.copilot/skills`, `~/.agents/skills` | `.github/skills`, `.claude/skills`, `.agents/skills` |

Deux conséquences à traiter au lot C (table des signaux et des dossiers) :

- Le prototype montre Cline sur `.agents/skills`. Sa documentation dit `~/.cline/skills`. À réconcilier avec la table du CLI `skills`.
- Plusieurs agents lisent plusieurs dossiers. Un skill posé dans `~/.agents/skills` **et** lié dans `~/.cursor/skills` serait vu deux fois par Cursor. À vérifier par essai avant de choisir entre lien et dossier commun.

## Reste à faire

- Relire les pages de Codex, Antigravity et Windsurf.
- Essais sur machine : où Gemini CLI et Cline enregistrent l'état désactivé ; effet réel de `skillOverrides` (un ticket public signale un cas où il serait ignoré **[Rapporté]**).
