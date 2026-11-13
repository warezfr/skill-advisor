<div align="center">

# Skill Advisor

**Encuentre, verifique, instale y gestione Agent Skills para sus agentes de programación con IA.**

[English](README.md) · [Français](README.fr.md) · **Español** · [العربية](README.ar.md)

![Status: prototype](https://img.shields.io/badge/status-prototype-f59e0b)
![License: MIT](https://img.shields.io/badge/license-MIT-2563eb)
![Node.js 22+](https://img.shields.io/badge/node-22%2B-16a34a)
![Tested on macOS, Windows 11, Linux](https://img.shields.io/badge/tested-macOS%20%C2%B7%20Windows%2011%20%C2%B7%20Linux-64748b)

[![Skill Advisor en 20 segundos](docs/assets/video-youtube.jpg)](https://www.youtube.com/watch?v=hjwuJ8zlqQc)

*Haga clic en la imagen para ver el vídeo en YouTube.*

</div>

---

## Qué es

Un Agent Skill es una carpeta con un archivo `SKILL.md`. Ese archivo enseña a un agente de IA a hacer bien una tarea concreta. El índice público skills.sh enumera 92 899. Skill Advisor responde a tres preguntas:

1. **¿Qué skills encajan con mi proyecto?** Usted responde cuatro preguntas y recibe una lista ordenada.
2. **¿Puedo confiar en esta skill?** Cada skill tiene una puntuación sobre 100 y una verificación de seguridad estática que se puede leer línea por línea.
3. **¿Qué hay instalado en mi máquina?** Una sola pantalla muestra todas las skills, en todos los agentes, con actualizaciones y avisos.

> [!IMPORTANT]
> **Esta versión es un prototipo.** La interfaz funciona con una máquina de ejemplo y no escribe nada en su disco. El catálogo, la verificación de seguridad y los comandos de instalación son reales y se pueden usar hoy. La aplicación local que detecta sus agentes e instala por usted es el siguiente paso. Consulte **Qué funciona hoy** más abajo.

## Qué funciona hoy

| Parte | Estado | Qué se puede hacer |
|---|---|---|
| Interfaz (`prototype/`) | Demostración | Recorra el trayecto completo en su navegador. Catálogo real, máquina de ejemplo. |
| Catálogo (`catalog/`) | Datos reales | Explore 242 skills valoradas en 16 tipos de proyecto. Instantánea del 12 de noviembre de 2026. |
| Verificación de seguridad (`tools/skill-scan.mjs`) | Funciona | Compruebe cualquier carpeta de skill con 11 reglas antes de instalarla. |
| Instalación | Funciona con la CLI `skills` | Instale, liste, actualice y elimine skills con comandos probados en tres sistemas. |
| Aplicación local | Aún no desarrollada | Detectar sus agentes e instalar desde la interfaz. |

## Inicio rápido

Necesita un navegador web. Para los comandos necesita además [Node.js](https://nodejs.org) 22 o posterior (probado con Node.js 26).

```bash
git clone https://github.com/warezfr/skill-advisor.git
cd skill-advisor
```

Abra `prototype/dist/preview.html` en su navegador. Eso es toda la demostración: sin servidor y sin instalación.

Después, verifique las dos skills de ejemplo:

```bash
node tools/skill-scan.mjs examples/skills
```

**El manual paso a paso, con una captura de pantalla por cada paso: [docs/install/INSTALL.es.md](docs/install/INSTALL.es.md).**

## Un recorrido en capturas de pantalla

Por ahora la interfaz está en francés. Cada pie de imagen explica qué hace la pantalla.

### 1. Mi máquina

Todas las skills de todos los agentes, en una sola pantalla: 50 skills en 5 agentes, 3 actualizaciones, 8 skills por revisar. La lista inferior muestra primero lo que requiere su atención.

![Mi máquina](docs/assets/screenshots/01-ma-machine.png)

### 2. Cuente qué construye

Elija un objetivo: un sitio web, una aplicación o un análisis de datos. Después responda cuatro preguntas breves sobre su proyecto.

| Objetivo | Preguntas |
|---|---|
| ![Objetivo](docs/assets/screenshots/02-objectif.png) | ![Preguntas](docs/assets/screenshots/03-questions.png) |

### 3. Recomendaciones ordenadas

Doce skills para su proyecto, ordenadas por puntuación. Cada tarjeta explica por qué encaja con sus respuestas y muestra los avisos.

![Recomendaciones](docs/assets/screenshots/04-recommandations.png)

### 4. Una puntuación legible

La puntuación es sobre 100: popularidad 40, reputación de la fuente 25, actualidad 15, seguridad 20. El panel de detalle muestra cada parte, el archivo de la skill y el resultado de cada verificación.

![Detalle de una skill](docs/assets/screenshots/05-detail.png)

### 5. Verifique antes de escribir nada

La pantalla de instalación enumera exactamente qué se creará, en qué agentes, para todos los proyectos o para uno solo. No se escribe nada antes de que usted confirme.

![Verificar antes de escribir](docs/assets/screenshots/06-installation.png)

### 6. Una guía para cada skill instalada

Tras la instalación, cada skill recibe una guía breve: cuándo la usa el agente y cómo invocarla.

![Guía](docs/assets/screenshots/07-guide.png)

### 7. Gestione lo instalado

Actualice, desactive, elimine. Filtre por estado. Vea cuánto contexto consume cada skill.

| Mis skills | Agentes encontrados en la máquina |
|---|---|
| ![Mis skills](docs/assets/screenshots/08-mes-skills.png) | ![Agentes](docs/assets/screenshots/09-agents.png) |

### 8. Busque en toda la base, en tema claro u oscuro

| Búsqueda | Tema oscuro |
|---|---|
| ![Búsqueda](docs/assets/screenshots/10-recherche.png) | ![Tema oscuro](docs/assets/screenshots/11-theme-sombre.png) |

## La verificación de seguridad

`tools/skill-scan.mjs` lee los archivos de una skill como texto. Nunca los ejecuta.

```bash
node tools/skill-scan.mjs examples/skills
```

![Resultado de la verificación](docs/assets/screenshots/14-terminal-scan.png)

| Veredicto | Significado |
|---|---|
| `vert` (verde) | No se encontró ningún patrón conocido. |
| `vert-remarques` (verde con notas) | Solo hallazgos de gravedad baja. |
| `orange` (naranja) | Al menos un hallazgo de gravedad media. |
| `rouge` (rojo) | Un hallazgo de gravedad alta, o archivos de credenciales junto con datos enviados al exterior. |

Las 11 reglas buscan: comandos que descargan y ejecutan, código oculto, inyección de instrucciones, texto invisible, archivos de credenciales, datos enviados al exterior, comandos privilegiados o destructivos, direcciones sospechosas, scripts que llaman a la red, peticiones de instalar programas, y archivos `.env` o claves de API.

> [!WARNING]
> Un veredicto verde significa "no se encontró ningún patrón conocido". No significa "seguro". Lea una skill antes de confiar en ella.

## El catálogo

- 242 skills, en 16 tipos de proyecto, seleccionadas entre las 92 899 que enumera skills.sh.
- Cada skill tiene una puntuación, un número de instalaciones, las estrellas de su repositorio y sus avisos.
- Un aviso nunca retira una skill de la lista. Se muestra y usted decide.
- Léalo aquí: [catalog/CATALOGUE.md](catalog/CATALOGUE.md) (en francés). Datos sin procesar: [catalog/catalog.json](catalog/catalog.json).

## Sistemas probados

Los comandos de instalación se repitieron mediante un script en tres sistemas, todos con procesadores arm64.

| Sistema | Resultado |
|---|---|
| Windows 11 | 17 comprobaciones de 17 |
| Debian 12 (contenedor) | 17 comprobaciones de 17 |
| macOS | 17 comprobaciones de 17 |

Aún sin probar: procesadores x64 y WSL. Los informes están en [docs/etude/](docs/etude/) (en francés).

## Estructura del proyecto

```text
prototype/     Interface of the demonstration (HTML, CSS, JavaScript, no dependency)
catalog/       Catalogue, data snapshot and the scripts that build it
tools/         skill-scan.mjs, the static security check
examples/      Two example skills for the check: one safe, one written to fail
essais/        Test scripts and raw results for Windows, Linux and macOS
docs/          Installation manual, screenshots and test reports
```

## Hoja de ruta

- Aplicación local que se inicia con un solo comando y detecta los agentes de su máquina.
- Instalación, actualización, desactivación y eliminación desde la interfaz.
- Pruebas en procesadores x64 y WSL.

## Licencia

[MIT](LICENSE). Las skills del catálogo pertenecen a sus autores y conservan sus propias licencias.

## Enlaces

- Sitio web: [span.observer](https://span.observer)
- Índice de skills: [skills.sh](https://skills.sh)
