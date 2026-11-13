# Manuel d'installation

[English](INSTALL.md) · **Français** · [Español](INSTALL.es.md) · [العربية](INSTALL.ar.md)

Ce manuel vous mène de zéro à un skill vérifié et installé dans votre agent. Chaque étape comporte une action et un résultat attendu. Vous pouvez vous arrêter à n'importe quelle étape : les étapes 1 à 4 demandent seulement un navigateur web.

> [!IMPORTANT]
> Skill Advisor est un prototype. L'interface montre une machine d'exemple et n'écrit rien sur votre disque. Les étapes 7 et 8 utilisent de vraies commandes qui écrivent de vrais fichiers. Chacune de ces étapes le signale.

## Sommaire

| Étape | Ce que vous faites | Durée | Il faut |
|---|---|---|---|
| 1 | Vérifier ce qu'il vous faut | 2 min | - |
| 2 | Télécharger Skill Advisor | 1 min | Navigateur ou git |
| 3 | Ouvrir la démonstration | 1 min | Navigateur |
| 4 | Parcourir le trajet | 5 min | Navigateur |
| 5 | Construire et tester (facultatif) | 1 min | Node.js |
| 6 | Vérifier un skill | 2 min | Node.js |
| 7 | Essayer un vrai skill dans un dossier de test | 3 min | Node.js, internet |
| 8 | Installer un skill pour tous vos projets | 2 min | Node.js, internet |

---

## Étape 1 · Vérifier ce qu'il vous faut

| Outil | Utile pour | Comment vérifier | Où le trouver |
|---|---|---|---|
| Un navigateur web | Étapes 3 et 4 | - | Déjà sur votre machine |
| Node.js 22 ou plus récent | Étapes 5 à 8 | `node -v` | [nodejs.org](https://nodejs.org) |
| git | Étape 2 (option B). Recommandé pour les étapes 7 et 8 | `git --version` | [git-scm.com](https://git-scm.com) |

Ouvrez un terminal (Terminal sur macOS et Linux, PowerShell sur Windows) et lancez :

```bash
node -v
git --version
```

**Résultat attendu :** deux numéros de version. Le numéro de Node.js commence par 22 ou plus. Les commandes de ce manuel ont été testées avec Node.js 26. Les commandes des étapes 5 à 7 ont été rejouées sur macOS. Les commandes d'installation de l'étape 8 ont été testées sur Windows 11, Linux et macOS.

Pourquoi git est recommandé : sans git, l'installation s'arrête quand GitHub limite les téléchargements anonymes (60 requêtes par heure pour une adresse publique). Avec git, l'installation continue.

## Étape 2 · Télécharger Skill Advisor

Choisissez une option.

**Option A, sans git.** Téléchargez le fichier ZIP et décompressez-le :

<https://github.com/warezfr/skill-advisor/archive/refs/heads/main.zip>

Le dossier décompressé s'appelle `skill-advisor-main`. Renommez-le en `skill-advisor`.

**Option B, avec git.**

```bash
git clone https://github.com/warezfr/skill-advisor.git
```

Entrez ensuite dans le dossier :

```bash
cd skill-advisor
```

**Résultat attendu :** un dossier `skill-advisor` qui contient `prototype`, `catalog`, `tools` et `README.md`.

## Étape 3 · Ouvrir la démonstration

Ouvrez le fichier `prototype/dist/preview.html` dans votre navigateur. Double-cliquez dessus, ou utilisez la commande de votre système.

macOS :

```bash
open prototype/dist/preview.html
```

Windows :

```powershell
start prototype\dist\preview.html
```

Linux :

```bash
xdg-open prototype/dist/preview.html
```

**Résultat attendu :** l'écran « Ma machine ». Le coin en bas à gauche indique « machine d'exemple » : les 50 skills affichés sont des exemples, pas les vôtres.

![L'écran Ma machine](../assets/screenshots/01-ma-machine.png)

Remarques :

- La page n'a besoin ni de serveur ni de compte. Elle charge ses polices depuis internet.
- L'interface est en français : vous n'avez rien à traduire.

## Étape 4 · Parcourir le trajet

**4.1 Choisir un objectif.** Cliquez sur « Conseil » dans le menu de gauche, puis sur « Créer un site ».

![Choisir un objectif](../assets/screenshots/02-objectif.png)

**4.2 Répondre à quatre questions.** Type de site, technologie, hébergement, besoins. Le panneau de droite se remplit au fil de vos réponses. Cliquez sur « Voir les recommandations ».

![Quatre questions](../assets/screenshots/03-questions.png)

**4.3 Lire les recommandations.** Chaque skill a une note sur 100 et une ligne « Pourquoi pour vous ». Cochez les skills que vous voulez. Les skills déjà installés portent la mention « Installé ».

![Recommandations](../assets/screenshots/04-recommandations.png)

**4.4 Ouvrir le détail d'un skill.** Cliquez sur « Voir le détail ». Vous voyez comment la note est construite : popularité 40, réputation de la source 25, fraîcheur 15, sécurité 20.

![Détail d'un skill](../assets/screenshots/05-detail.png)

**4.5 Vérifier avant d'écrire.** Cliquez sur « Installer 3 skills ». L'écran « Vérifiez avant d'écrire » liste les skills, les agents qui les recevront et la portée : tous les projets ou ce projet seulement.

![Vérifier avant d'écrire](../assets/screenshots/06-installation.png)

**4.6 Lire le guide.** Confirmez. Dans le prototype, rien n'est écrit sur le disque. Le guide explique quand l'agent utilise chaque skill et comment l'appeler.

![Guide](../assets/screenshots/07-guide.png)

**4.7 Gérer.** « Mes skills » liste ce qui est installé, avec les mises à jour, les alertes et le coût en contexte. « Agents » montre les agents trouvés sur la machine et l'endroit où chacun garde ses skills.

![Mes skills](../assets/screenshots/08-mes-skills.png)

![Agents](../assets/screenshots/09-agents.png)

**4.8 Chercher.** « Recherche » explore toute la base, avec des filtres par type de projet, par installations et par alertes.

![Recherche](../assets/screenshots/10-recherche.png)

**4.9 Essayer les autres états.** Le bouton « Aperçu », en bas à gauche, montre les mêmes écrans dans d'autres états, par exemple sur une machine vide. L'icône de lune passe au thème sombre.

![Thème sombre](../assets/screenshots/11-theme-sombre.png)

**Résultat attendu :** vous avez vu tout le trajet, de l'objectif jusqu'à un skill installé et géré.

## Étape 5 · Construire et tester (facultatif)

Le fichier `preview.html` est déjà construit. Faites cette étape seulement si vous modifiez les fichiers de `prototype/src/`.

```bash
npm run build
npm test
```

**Résultat attendu :** la construction affiche la taille de deux fichiers, et le test se termine par `558 render checks, 0 failure(s)`.

![Construction et test](../assets/screenshots/12-terminal-build-test.png)

Ces deux commandes n'installent rien : le projet n'a aucune dépendance.

## Étape 6 · Vérifier un skill

Le contrôle lit les fichiers d'un skill comme du texte et cherche 11 motifs risqués. Il n'exécute jamais le skill. Le dossier `examples/skills` contient deux skills d'exemple : un sûr, un écrit pour échouer.

```bash
node tools/skill-scan.mjs examples/skills
```

**Résultat attendu :** une ligne rouge pour `risky-installer`, et un total de 2 skills : 1 `vert`, 1 `rouge`.

![Résultat du contrôle](../assets/screenshots/14-terminal-scan.png)

| Verdict | Signification | Ce qu'il faut faire |
|---|---|---|
| `vert` | Aucun motif connu trouvé | Lisez le skill, puis décidez |
| `vert-remarques` (vert avec remarques) | Seulement des constats de gravité faible | Lisez les remarques |
| `orange` | Au moins un constat de gravité moyenne | Lisez chaque constat avant d'installer |
| `rouge` | Un constat de gravité élevée | N'installez pas, sauf si vous comprenez chaque ligne |

Pour voir chaque constat avec son fichier et son numéro de ligne, ajoutez `--json` :

```bash
node tools/skill-scan.mjs examples/skills --json
```

Pour vérifier vos propres skills, donnez le dossier qui contient un sous-dossier par skill. Les skills installés avec l'outil `skills` sont stockés dans `.agents/skills`, dans votre dossier personnel :

```bash
node tools/skill-scan.mjs ~/.agents/skills
```

Sous Windows PowerShell, écrivez `$HOME\.agents\skills` à la place de `~/.agents/skills`.

Le contrôle ignore les dossiers liés. Donnez-lui le dossier qui contient les vrais fichiers.

> [!WARNING]
> Un verdict vert signifie « aucun motif connu trouvé ». Il ne signifie pas « sûr ». Le contrôle ne trouve que les motifs connus.

## Étape 7 · Essayer un vrai skill dans un dossier de test

Cette étape écrit des fichiers, mais seulement dans un dossier de test que vous pouvez supprimer. Elle utilise [`skills`](https://skills.sh), l'outil open source en ligne de commande sur lequel Skill Advisor s'appuie pour installer.

Créez un dossier de test à côté de `skill-advisor` et entrez-y :

```bash
mkdir ../try
cd ../try
```

Installez un skill pour ce dossier seulement, puis vérifiez-le :

```bash
npx -y skills@1.8.1 add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code -y
node ../skill-advisor/tools/skill-scan.mjs .claude/skills
```

**Résultat attendu :** le skill est copié dans `.claude/skills/web-design-guidelines`, à l'intérieur du dossier de test, et le contrôle affiche `Total 1 · vert 1`.

![Installer dans un dossier de test, puis vérifier](../assets/screenshots/13-terminal-try-a-skill.png)

Ce que signifient les options :

| Option | Signification |
|---|---|
| `vercel-labs/agent-skills` | Le dépôt GitHub qui contient le skill |
| `--skill web-design-guidelines` | Le skill à installer depuis ce dépôt |
| `-a claude-code` | L'agent qui le reçoit. Autres valeurs : `cursor`, `gemini-cli` |
| `-y` | Ne pas demander de confirmation |

Pour trouver le dépôt et le nom d'un skill, ouvrez [catalog/CATALOGUE.md](../../catalog/CATALOGUE.md) : chaque ligne donne le skill et sa source.

Pour tout retirer de cette étape, supprimez le dossier `try`.

## Étape 8 · Installer un skill pour tous vos projets

> [!WARNING]
> Cette étape écrit dans vos vrais dossiers d'agent, par exemple `~/.claude/skills`. Faites-la seulement pour un skill que vous avez vérifié à l'étape 7.

Ajoutez `-g` (global) pour installer pour tous vos projets :

```bash
npx -y skills@1.8.1 add vercel-labs/agent-skills --skill web-design-guidelines -g -a claude-code -y
```

Les quatre commandes dont vous avez besoin ensuite :

| Action | Commande |
|---|---|
| Lister ce qui est installé | `npx -y skills@1.8.1 list -g` |
| Chercher des mises à jour | `npx -y skills@1.8.1 check -g` |
| Tout mettre à jour | `npx -y skills@1.8.1 update -g -y` |
| Supprimer un skill | `npx -y skills@1.8.1 remove --skill web-design-guidelines -g -y` |

**Résultat attendu :** `list -g` affiche `web-design-guidelines`. Redémarrez votre agent pour qu'il relise son dossier de skills.

Où vont les fichiers : le skill est stocké une seule fois dans `~/.agents/skills/`, et le dossier de votre agent y pointe. Sur macOS et Linux, le pointeur est un lien symbolique. Sur Windows, c'est une jonction.

---

## En cas de problème

| Ce que vous voyez | Cause | Ce qu'il faut faire |
|---|---|---|
| `node: command not found` | Node.js n'est pas installé | Installez-le depuis [nodejs.org](https://nodejs.org), puis ouvrez un nouveau terminal |
| `[SKILLS_GIT_CLONE_FAILED] ... spawn git ENOENT` | GitHub a limité les téléchargements anonymes et git n'est pas installé | Installez git, ou attendez une heure et recommencez |
| `skill-scan.mjs` affiche `ENOENT ... scandir` | Le dossier donné n'existe pas | Donnez un dossier qui contient un sous-dossier par skill |
| Sur Windows, l'installateur indique « symlinked » | L'outil emploie un seul mot pour les deux types de lien | Rien à faire : il a créé une jonction, qui fonctionne sans droits d'administrateur |

## Supprimer Skill Advisor

Skill Advisor n'installe rien sur votre système. Supprimez le dossier `skill-advisor`. Les skills installés à l'étape 8 restent en place : retirez-les avec la commande `remove` de l'étape 8.

---

[Retour au README](../../README.fr.md) · Site web : [span.observer](https://span.observer)
