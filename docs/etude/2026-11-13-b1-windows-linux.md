# B1 — Le CLI `skills` sur Windows et Linux

Date : 13/11/2026. Question B1 du plan produit.

**Nature : essais réels**, neuf passages du même script, CLI `skills@1.8.1` : sept passages normaux, puis deux passages sans git rejoués une fois le quota de l'API GitHub épuisé. Tous sur processeur arm64 : la machine Windows et le conteneur Linux tournent sur le même Mac. Le x64 n'est pas couvert.

Un passage, `windows-arm64-sans-git`, date de la version précédente du script. La seule différence : la version finale met entre guillemets les arguments à espace sous Windows, et ce passage n'en a aucun.

Script : `essais/b1-cli/run.mjs`. Résultats bruts, avec le journal de chaque commande : `essais/b1-cli/resultat-<essai>.json`. Chaque essai tourne dans un bac jetable (faux dossier personnel, faux projet, cache npm). Les journaux remplacent le chemin du bac, le dossier personnel et le nom du compte par des marqueurs.

## Où les essais ont tourné

| Essai | Système | Node | git | Compte |
|---|---|---|---|---|
| `windows-arm64-sans-git` | Windows 11 (10.0.26300), machine virtuelle Parallels | 26.13.1 | absent | utilisateur ordinaire, mode développeur désactivé |
| `windows-arm64` | idem | 26.13.1 | 2.56.1 | idem |
| `windows-arm64-chemin-espace` | idem, bac dans un dossier `essai é b1` | 26.13.1 | 2.56.1 | idem |
| `linux-arm64-sans-git` | Debian 12, conteneur Docker | 26.13.1 | absent | utilisateur ordinaire (uid 1000) |
| `linux-arm64` | idem | 26.13.1 | 2.39.5 | idem |
| `linux-arm64-chemin-espace` | idem, bac dans un dossier `essai é b1` | 26.13.1 | 2.39.5 | idem |
| `macos-arm64` | macOS (Darwin 27.3), témoin | 26.13.0 | 2.54.0 | utilisateur ordinaire |
| `windows-arm64-sans-git-quota-epuise` | Windows 11, quota GitHub à 0 | 26.13.1 | absent | utilisateur ordinaire |
| `linux-arm64-sans-git-quota-epuise` | Debian 12, quota GitHub à 0 | 26.13.1 | absent | utilisateur ordinaire |

## Ce que le script contrôle

Dix-sept contrôles, repris de l'essai macOS d'origine. Un contrôle ne réussit que si la commande sort en code 0 **et** si le disque montre l'effet attendu.

| N° | Contrôle |
|---|---|
| 0b, 1a | npm répond ; `npx -y skills@1.8.1 --version` se lance |
| 2 | trois agents simulés (`.claude`, `.gemini`, `.cursor`) |
| 3, 4 | installer pour tout le compte, puis lister en JSON |
| 5a, 5b, 6 | vérifier (projet, compte), mettre à jour |
| 7a, 7b | retirer chez un seul agent, puis partout |
| 8a, 8b | installer dans un projet, puis lister |
| 9a, 9b | lire `detectAgents()` dans le module Node du paquet |
| 10 | installer avec `CLAUDE_CONFIG_DIR` déplacé |
| 11a, 11b | un skill posé à la main est vu, puis épargné par « tout retirer » |

## Résultat

**17 contrôles sur 17 dans les sept passages normaux.** Ce qui était prouvé sur macOS tient sur Windows 11 et sur Debian, sans interaction, y compris dans un chemin qui porte une espace et un accent.

**11 sur 17 dans les deux passages sans git, quota GitHub épuisé.** Les six contrôles qui installent, ou qui dépendent d'une installation, échouent (3, 4, 7a, 8a, 8b, 10). Voir le point 3.

Écritures hors du bac, ce qui a été mesuré : aucune entrée nouvelle au premier niveau du dossier personnel réel ni, sous Windows, de `AppData\Roaming` et `AppData\Local` ; l'empreinte des dossiers de skills réels est la même avant et après. Le contrôle ne descend pas plus bas. Sous Windows, le bac lui-même était dans `AppData\Local\Temp`.

## Les quatre différences

### 1. Sous Windows, le lien est une jonction

| | macOS et Linux | Windows, utilisateur ordinaire |
|---|---|---|
| Créer un lien symbolique | possible | refusé (`EPERM`) |
| Créer une jonction | sans objet | possible |
| Ce que le CLI pose chez Claude Code | lien symbolique, cible relative `../../.agents/skills/<nom>` | jonction, cible absolue |
| Ce que le CLI affiche | « symlink » | « symlinked » aussi |

Conséquences pour le produit :

- Lire une jonction comme un lien. Node la signale comme lien (`isSymbolicLink()`), mais sa cible est absolue.
- Une cible absolue casse si le dossier personnel est renommé ou déplacé. Le lien relatif de macOS et Linux survit à ce cas.
- Ne pas reprendre le mot « symlink » du CLI dans l'interface sous Windows.

Non vérifié : avec le mode développeur activé ou un compte élevé, le CLI poserait sans doute un vrai lien symbolique. Les deux formes sont donc à prévoir.

### 2. Sous Windows, `npx` ne se lance pas sans interpréteur

| Lancement depuis Node | Résultat |
|---|---|
| `spawn('npx', …)` sans interpréteur | `ENOENT` |
| `spawn('npx.cmd', …)` sans interpréteur | `EINVAL` |
| `spawn('npx', …, { shell: true })` | se lance |

Avec l'interpréteur, Node colle les arguments sans les protéger et l'écrit dans un avertissement (`DEP0190`). Le script d'essai s'y est pris : `npm install --prefix <chemin à espace>` a échoué (`EINVALIDTAGNAME`) tant que le chemin n'était pas entre guillemets. Les commandes du CLI, elles, ne reçoivent aucun chemin en argument et n'étaient pas touchées.

Conséquence : le socle (lot C) lance toutes les commandes par un seul module, qui protège les arguments sous Windows. Autre voie possible, non essayée : lancer `node` avec le fichier `npx-cli.js`, sans interpréteur.

### 3. Sans git, l'installation dépend du quota de l'API GitHub

Ce point vaut pour Windows et Linux ; il n'oppose pas les systèmes.

| Situation | git présent | git absent |
|---|---|---|
| L'API GitHub répond | tout passe | tout passe |
| Quota de l'API épuisé | tout passe (`windows-arm64`, rejoué quota à 0) | l'installation échoue |

L'erreur, identique sur les deux systèmes : `[SKILLS_GIT_CLONE_FAILED] Failed to clone https://github.com/vercel-labs/agent-skills.git: Error: spawn git ENOENT`.

Explication, lue dans le paquet et cohérente avec les journaux : le CLI lit d'abord le dépôt par l'API GitHub (`api.github.com/repos/<source>/git/trees/…`). Quand l'API refuse, il se rabat sur `git clone`. Sans git, il n'a plus de repli.

Le quota sans compte est de 60 requêtes par heure et par adresse publique. Quinze passages en moins d'une heure l'ont épuisé ici. Ce cas n'est pas théorique : plusieurs postes derrière la même adresse (bureau, école) partagent ce quota.

Le paquet lit les variables `GITHUB_TOKEN` et `GH_TOKEN`. Avec un jeton, le quota monte. Lu dans le paquet, **non essayé**.

Conséquences pour le produit :

- git reste un prérequis **conseillé**, pas obligatoire. L'interface dit ce que son absence coûte : « sans git, les installations s'arrêtent quand GitHub limite les téléchargements ».
- Reconnaître cette erreur et l'expliquer, au lieu de montrer « Failed to clone ».
- Skill Advisor ne doit pas consommer ce quota pour ses propres besoins. La base en ligne, servie par notre service, répond déjà à ce point.
- Dépôts privés et adresses git hors GitHub : toujours ouverts (B6).

Le premier rapport macOS supposait que git était toujours nécessaire. C'est faux quand l'API répond, vrai quand elle refuse.

### 4. Windows est plus lent dans cette machine virtuelle

La comparaison oppose une machine virtuelle, un conteneur et un Mac sans couche intermédiaire. Elle donne un ordre de grandeur, pas une mesure de Windows.

| | Linux | macOS | Windows |
|---|---|---|---|
| La série complète | 7 à 11 s | 17 s | 20 à 35 s |
| Premier lancement de `npx` (cache npm vide) | environ 1 s | 1,1 s | 2,5 à 3 s |

Le tout premier lancement de `npx` dans la machine Windows a pris 15,7 s. Ce passage a été rejoué depuis et son fichier remplacé : le chiffre n'est plus dans les résultats conservés.

Conséquence : sous Windows, montrer l'avancement dès la première seconde, et ne pas fixer de délai d'abandon court.

## Ce qui est identique partout

- Dossier commun `~/.agents/skills/<nom>`, verrou `~/.agents/.skill-lock.json` (version 3, mêmes sept champs), verrou de projet `skills-lock.json`.
- `list --json` : mêmes champs. Le champ `agents` nomme les agents **présents sur la machine** qui lisent le dossier, pas ceux demandés à l'installation : Gemini CLI y figure sans avoir été demandé, parce que son dossier existe. Dans l'essai B3, le faux dossier personnel n'avait pas de dossier `.cursor`, et Cursor, pourtant demandé, n'y figurait pas.
- `detectAgents()` rend les trois agents simulés, avec leurs dossiers.
- `CLAUDE_CONFIG_DIR` déplacé : le skill est copié dans le dossier déplacé, pas lié.
- Un skill posé à la main sort en `untracked` et « tout retirer » ne le supprime pas.

## Ce que ces essais ne couvrent pas

- **x64** : aucun essai. **WSL** : aucun essai.
- **Aucun agent réel n'a lu les skills.** Les agents sont des dossiers vides. Que Claude Code sous Windows suive une jonction n'est pas vérifié.
- **Linux** : un conteneur Debian, sans bureau. Une autre distribution, ou la détection d'applications de bureau, restent à voir.
- **Node sous Windows** : version portable, dépliée dans le dossier de l'utilisateur, chemin ajouté pour la durée de l'essai. L'installation par `winget` s'est arrêtée sur la demande de droits d'administrateur, que personne n'a acceptée. Les autres façons d'installer Node (MSI, nvm, Volta) ne sont pas essayées.
- **Un seul skill, une seule source publique.** `check` en code 1 (skill périmé) n'a jamais été observé.
- **Restauration (B3)** : non rejouée sur Windows ni Linux. B1 ne la couvre pas.
- **Jeton GitHub** : non essayé. Le nombre de requêtes par installation n'est pas mesuré.
- Antivirus, chemins de plus de 260 caractères, dossier personnel redirigé vers OneDrive : non essayés.
- Le plan disait « par intégration continue ». Les essais ont été lancés à la main dans les machines virtuelles (décision 7). Le script est prêt pour une intégration continue, qui reste à brancher.

## Rejouer

```bash
node essais/b1-cli/run.mjs --label <nom> [--box <dossier>] [--espace]
```

- Linux : le script est passé au conteneur par l'entrée standard, sans monter le dépôt. Images : `node:26.13.1-bookworm-slim` (sans git), et la même avec le paquet `git` de Debian.
- Windows : le script est copié dans la machine, lancé comme l'utilisateur ouvert, sans droits élevés.

## Ce qui reste sur les machines

- Machine Windows : `%USERPROFILE%\b1-outils` (Node 26.13.1 et MinGit 2.56.1 portables, 267 Mo). Les deux archives viennent de nodejs.org et du dépôt git-for-windows ; leurs empreintes SHA-256 ont été comparées aux valeurs publiées. Rien n'est installé dans le système. Pour tout retirer : supprimer ce dossier.
- Mac : deux images Docker, `node:26.13.1-bookworm-slim` et `b1-node-git`.
