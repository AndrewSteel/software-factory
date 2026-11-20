# Workflow: Alice

Für das Projekt [Alice](https://github.com/AndrewSteel/alice): lokale Dienste in Docker-Containern, n8n-Workflows, PostgreSQL/Redis/Weaviate und ein statisches Next.js-Frontend auf demselben Server, auf dem auch die Factory läuft. Aufbau wie der Starter-Kit-Workflow, angepasst an die Alice-Konventionen (Regeln in `CLAUDE.md` und `.claude/rules/`, Deploy macht immer der Mensch).

## Aufgabenteilung

- **Du (lokal mit Claude Code):** Spec mit dem Alice-Skill `/write-spec` schreiben (bzw. `/requirements`), prüfen, auf den Standard-Branch pushen, mit `/to-factory PROJ-X` übergeben.
- **Factory (auf dem Server):** Architektur, Umsetzung, Tests, Pull Request, unabhängige Abnahme.
- **Du:** PR prüfen, geänderte Dienste mit `scripts/stage.sh <dienst> <PR>` neben der Produktion mit echten Daten ansehen, mergen, **deployen** (Compose-Sync, Container neu bauen, Migrationen anwenden, n8n-Workflows importieren). Was zu tun ist, steht im PR unter „Deploy-Schritte".

## Ablage

Pro Feature ein Ordner, wie im Starter Kit:

```
features/
  INDEX.md                         Übersicht aller Features + Status + nächste freie ID
  PROJ-115-listen-teilen/
    spec.md                        WAS: User Stories, Akzeptanzkriterien, Edge Cases (Vertrag, vom Menschen)
    design.md                      WIE: Architektur (Factory, Skill architecture)
    qa-report.md                   ERGEBNIS: Testbericht (Factory, Skill qa)
  old/                             Historie: Features aus der Zeit vor der Factory (flache Dateien)
```

Die Spec (`spec.md`) ändert die Factory nie. Den Status pflegt sie in `features/INDEX.md`.

`features/old/` ist **nur Historie**: lesen, wenn eine Spec auf ein altes Feature verweist (z. B. „baut auf PROJ-85 auf"), aber dort nie etwas ändern oder anlegen. Neue Features entstehen nur als Ordner direkt unter `features/`.

## Zuordnung zu den Factory-Phasen

- **Prüfung:** Spec vorhanden (`Spec: features/PROJ-X-<name>/spec.md` im Issue)? Akzeptanzkriterien testbar? Passt zu `docs/stack.md`, `docs/PRD.md`, `features/INDEX.md` und dem bestehenden Code? Lässt es sich ohne Produktivsysteme testen (siehe Stack-Packs)? Bei Freigabe: Testszenarien nach `/scenarios/scenarios.md`.
- **Bau:**
  - Schritt **Architektur** → Skill `architecture` → `design.md` im Feature-Ordner (Bug: reproduzieren, roter Test)
  - Schritt **Umsetzung** → Skill `build`
  - Schritt **Tests** → Skill `qa` → `qa-report.md` im Feature-Ordner
- **Abnahme:** Spec und Testszenarien gegen den PR-Branch: Dienste per Docker starten, APIs aufrufen, Frontend im Browser. Was nur mit Produktivsystemen geht (Home Assistant, echtes LLM, NAS, Google), wird mit Attrappen geprüft und im Bericht als „nicht live geprüft" markiert.

## Projekt-Skills von Alice

Alice bringt eigene Skills in `.claude/skills/` mit (`backend`, `frontend`, `deploy`, `n8n-architecture` …). Sie stammen aus der Zeit der flachen Ablage und sind für die interaktive Arbeit am eigenen Rechner gedacht (Rückfragen per Dialog, n8n-MCP, Deploy). **In der Factory nicht verwenden.** Es gelten nur die Workflow-Skills `architecture`, `build` und `qa` (gleichnamige persönliche Skills haben Vorrang vor Projekt-Skills). Die Regeln aus `CLAUDE.md` und `.claude/rules/` gelten dagegen voll.

## Stack-Packs

Unter `/factory/workflows/alice/stacks/`. Welche gelten, steht in `docs/stack.md` des Repos.

## Status in `features/INDEX.md`

`Planned` (Spec fertig, vom Menschen) → `Architected` → `In Progress` → `In Review` → `Approved` (QA bestanden). `Deployed` setzt nur der Mensch.
