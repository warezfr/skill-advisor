<div align="center">

# Skill Advisor

**Trouvez, vérifiez, installez et gérez des Agent Skills pour vos agents de code IA.**

[English](README.md) · **Français** · [Español](README.es.md) · [العربية](README.ar.md)

![Status: prototype](https://img.shields.io/badge/status-prototype-f59e0b)
![License: MIT](https://img.shields.io/badge/license-MIT-2563eb)
![Node.js 22+](https://img.shields.io/badge/node-22%2B-16a34a)
![Tested on macOS, Windows 11, Linux](https://img.shields.io/badge/tested-macOS%20%C2%B7%20Windows%2011%20%C2%B7%20Linux-64748b)

[![Skill Advisor en 20 secondes](docs/assets/video-youtube.jpg)](https://www.youtube.com/watch?v=hjwuJ8zlqQc)

*Cliquez sur l'image pour voir la vidéo sur YouTube.*

</div>

---

## De quoi s'agit-il

Un Agent Skill est un dossier avec un fichier `SKILL.md`. Il apprend à un agent IA à bien faire une tâche précise. L'index public skills.sh en recense 92 899. Skill Advisor répond à trois questions :

1. **Quels skills conviennent à mon projet ?** Vous répondez à quatre questions et vous obtenez une liste classée.
2. **Puis-je faire confiance à ce skill ?** Chaque skill a une note sur 100 et un contrôle de sécurité statique que vous pouvez lire ligne par ligne.
3. **Qu'est-ce qui est installé sur ma machine ?** Un seul écran montre chaque skill, dans chaque agent, avec les mises à jour et les alertes.

> [!IMPORTANT]
> **Cette version est un prototype.** L'interface fonctionne sur une machine d'exemple et n'écrit rien sur votre disque. Le catalogue, le contrôle de sécurité et les commandes d'installation sont réels et utilisables dès aujourd'hui. L'application locale, qui détecte vos agents et installe à votre place, est la prochaine étape. Voir **Ce qui fonctionne aujourd'hui** ci-dessous.

## Ce qui fonctionne aujourd'hui

| Élément | État | Ce que vous pouvez faire |
|---|---|---|
| Interface (`prototype/`) | Démonstration | Parcourez tout le trajet dans votre navigateur. Catalogue réel, machine d'exemple. |
| Catalogue (`catalog/`) | Données réelles | Parcourez 242 skills notés, répartis en 16 types de projet. Instantané du 12 novembre 2026. |
| Contrôle de sécurité (`tools/skill-scan.mjs`) | Fonctionne | Vérifiez n'importe quel dossier de skill avec 11 règles avant de l'installer. |
| Installation | Fonctionne via le CLI `skills` | Installez, listez, mettez à jour et supprimez des skills avec des commandes testées sur trois systèmes. |
| Application locale | Pas encore construite | Détecter vos agents et installer depuis l'interface. |

## Démarrage rapide

Il vous faut un navigateur web. Pour les commandes, il faut aussi [Node.js](https://nodejs.org) 22 ou plus récent (testé avec Node.js 26).

```bash
git clone https://github.com/warezfr/skill-advisor.git
cd skill-advisor
```

Ouvrez `prototype/dist/preview.html` dans votre navigateur. C'est toute la démonstration : pas de serveur, pas d'installation.

Ensuite, vérifiez les deux skills d'exemple :

```bash
node tools/skill-scan.mjs examples/skills
```

**Le manuel pas à pas, avec une capture d'écran pour chaque étape : [docs/install/INSTALL.fr.md](docs/install/INSTALL.fr.md).**

## Visite en captures d'écran

L'interface est en français : chaque légende explique le rôle de l'écran.

### 1. Ma machine

Chaque skill de chaque agent sur un seul écran : 50 skills dans 5 agents, 3 mises à jour, 8 skills à examiner. La liste du dessous montre ce qui demande votre attention en premier.

![Ma machine](docs/assets/screenshots/01-ma-machine.png)

### 2. Dites ce que vous construisez

Choisissez un objectif : un site web, une application ou une analyse de données. Répondez ensuite à quatre courtes questions sur votre projet.

| Objectif | Questions |
|---|---|
| ![Objectif](docs/assets/screenshots/02-objectif.png) | ![Questions](docs/assets/screenshots/03-questions.png) |

### 3. Recommandations classées

Douze skills pour votre projet, classés par note. Chaque carte explique pourquoi le skill correspond à vos réponses et affiche les alertes éventuelles.

![Recommandations](docs/assets/screenshots/04-recommandations.png)

### 4. Une note que vous pouvez lire

La note est sur 100 : popularité 40, réputation de la source 25, fraîcheur 15, sécurité 20. Le panneau de détail montre chaque part, le fichier du skill et le résultat de chaque contrôle.

![Détail d'un skill](docs/assets/screenshots/05-detail.png)

### 5. Vérifiez avant que rien ne soit écrit

L'écran d'installation liste exactement ce qui sera créé, dans quels agents, pour tous les projets ou pour un seul. Rien n'est écrit avant votre confirmation.

![Vérifier avant d'écrire](docs/assets/screenshots/06-installation.png)

### 6. Un guide pour chaque skill installé

Après l'installation, chaque skill reçoit un court guide : quand l'agent l'utilise et comment l'appeler.

![Guide](docs/assets/screenshots/07-guide.png)

### 7. Gérez ce qui est installé

Mettez à jour, désactivez, supprimez. Filtrez par état. Voyez combien de contexte coûte chaque skill.

| Mes skills | Agents trouvés sur la machine |
|---|---|
| ![Mes skills](docs/assets/screenshots/08-mes-skills.png) | ![Agents](docs/assets/screenshots/09-agents.png) |

### 8. Cherchez dans toute la base, en clair ou en sombre

| Recherche | Thème sombre |
|---|---|
| ![Recherche](docs/assets/screenshots/10-recherche.png) | ![Thème sombre](docs/assets/screenshots/11-theme-sombre.png) |

## Le contrôle de sécurité

`tools/skill-scan.mjs` lit les fichiers d'un skill comme du texte. Il ne les exécute jamais.

```bash
node tools/skill-scan.mjs examples/skills
```

![Résultat du contrôle](docs/assets/screenshots/14-terminal-scan.png)

| Verdict | Signification |
|---|---|
| `vert` | Aucun motif connu trouvé. |
| `vert-remarques` (vert avec remarques) | Seulement des constats de gravité faible. |
| `orange` | Au moins un constat de gravité moyenne. |
| `rouge` | Un constat de gravité élevée, ou des fichiers d'identifiants avec des données envoyées à l'extérieur. |

Les 11 règles recherchent : les commandes qui téléchargent puis exécutent, le code caché, l'injection de prompt, le texte invisible, les fichiers d'identifiants, les données envoyées à l'extérieur, les commandes privilégiées ou destructrices, les adresses suspectes, les scripts qui appellent le réseau, les demandes d'installation de programmes, et les fichiers `.env` ou clés d'API.

> [!WARNING]
> Un verdict vert signifie « aucun motif connu trouvé ». Il ne signifie pas « sûr ». Lisez un skill avant de lui faire confiance.

## Le catalogue

- 242 skills, répartis en 16 types de projet, choisis parmi les 92 899 skills recensés par skills.sh.
- Chaque skill a une note, un nombre d'installations, les étoiles de son dépôt et ses alertes.
- Une alerte ne retire jamais un skill de la liste. Elle est affichée et vous décidez.
- Lisez-le ici : [catalog/CATALOGUE.md](catalog/CATALOGUE.md). Données brutes : [catalog/catalog.json](catalog/catalog.json).

## Systèmes testés

Les commandes d'installation ont été rejouées par script sur trois systèmes, tous avec des processeurs arm64.

| Système | Résultat |
|---|---|
| Windows 11 | 17 contrôles sur 17 |
| Debian 12 (conteneur) | 17 contrôles sur 17 |
| macOS | 17 contrôles sur 17 |

Pas encore testés : les processeurs x64 et WSL. Les rapports sont dans [docs/etude/](docs/etude/).

## Organisation du projet

```text
prototype/     Interface de la démonstration (HTML, CSS, JavaScript, sans dépendance)
catalog/       Catalogue, instantané des données et scripts qui le construisent
tools/         skill-scan.mjs, le contrôle de sécurité statique
examples/      Deux skills d'exemple pour le contrôle : un sûr, un écrit pour échouer
essais/        Scripts de test et résultats bruts pour Windows, Linux et macOS
docs/          Manuel d'installation, captures d'écran et rapports de test
```

## Feuille de route

- Application locale lancée par une seule commande, qui détecte les agents de votre machine.
- Installation, mise à jour, désactivation et suppression depuis l'interface.
- Tests sur les processeurs x64 et WSL.

## Licence

[MIT](LICENSE). Les skills listés dans le catalogue appartiennent à leurs auteurs et gardent leurs propres licences.

## Liens

- Site web : [span.observer](https://span.observer)
- Index des skills : [skills.sh](https://skills.sh)
