# Workflow: Alice

Für das Projekt [Alice](https://github.com/AndrewSteel/alice): lokale Dienste in Docker-Containern, n8n-Workflows, PostgreSQL/Redis/Weaviate und ein statisches Next.js-Frontend auf demselben Server, auf dem auch die Factory läuft. Aufbau wie der Starter-Kit-Workflow, angepasst an die Alice-Konventionen (flache Spec-Dateien, Regeln in `CLAUDE.md` und `.claude/rules/`, Deploy macht immer der Mensch).

## Aufgabenteilung

- **Du (lokal mit Claude Code):** Spec mit dem Alice-Skill `/write-spec` schreiben (bzw. `/requirements`), prüfen, auf den Standard-Branch pushen, mit `/to-factory PROJ-X` übergeben.
- **Factory (auf dem Server):** Architektur, Umsetzung, Tests, Pull Request, unabhängige Abnahme.
- **Du:** PR prüfen, geänderte Dienste mit `scripts/stage.sh <dienst> <PR>` neben der Produktion mit echten Daten ansehen, mergen, **deployen** (Compose-Sync, Container neu bauen, Migrationen anwenden, n8n-Workflows importieren). Was zu tun ist, steht im PR unter „Deploy-Schritte".

## Ablage

Flach im Ordner `features/`, wie in Alice üblich:

```
features/
  INDEX.md                               Übersicht aller Features + Status
  PROJ-114-listen-webapp.md              WAS: Spec mit User Stories, Akzeptanzkriterien (Vertrag, vom Menschen)
  PROJ-114-listen-webapp.design.md       WIE: Architektur (Factory, Skill architecture)
  PROJ-114-listen-webapp.qa.md           ERGEBNIS: Testbericht (Factory, Skill qa)
```

Die Spec (`PROJ-X-<name>.md`) ändert die Factory nie, auch nicht den Status-Kopf darin. Den Status pflegt sie in `features/INDEX.md`.

## Zuordnung zu den Factory-Phasen

- **Prüfung:** Spec vorhanden (`Spec: features/PROJ-X-<name>.md` im Issue)? Akzeptanzkriterien testbar? Passt zu `docs/stack.md`, `docs/PRD.md`, `features/INDEX.md` und dem bestehenden Code? Lässt es sich ohne Produktivsysteme testen (siehe Stack-Packs)? Bei Freigabe: Testszenarien nach `/scenarios/scenarios.md`.
- **Bau:**
  - Schritt **Architektur** → Skill `architecture` → `PROJ-X-<name>.design.md` (Bug: reproduzieren, roter Test)
  - Schritt **Umsetzung** → Skill `build`
  - Schritt **Tests** → Skill `qa` → `PROJ-X-<name>.qa.md`
- **Abnahme:** Spec und Testszenarien gegen den PR-Branch: Dienste per Docker starten, APIs aufrufen, Frontend im Browser. Was nur mit Produktivsystemen geht (Home Assistant, echtes LLM, NAS, Google), wird mit Attrappen geprüft und im Bericht als „nicht live geprüft" markiert.

## Projekt-Skills von Alice

Alice bringt eigene Skills in `.claude/skills/` mit (`backend`, `frontend`, `deploy`, `n8n-architecture` …). Sie sind für die interaktive Arbeit am eigenen Rechner gedacht (Rückfragen per Dialog, n8n-MCP, Deploy). **In der Factory nicht verwenden.** Es gelten nur die Workflow-Skills `architecture`, `build` und `qa` (gleichnamige persönliche Skills haben Vorrang vor Projekt-Skills). Die Regeln aus `CLAUDE.md` und `.claude/rules/` gelten dagegen voll.

## Stack-Packs

Unter `/factory/workflows/alice/stacks/`. Welche gelten, steht in `docs/stack.md` des Repos.

## Status in `features/INDEX.md`

`Planned` (Spec fertig, vom Menschen) → `Architected` → `In Progress` → `In Review` → `Approved` (QA bestanden). `Deployed` setzt nur der Mensch.
