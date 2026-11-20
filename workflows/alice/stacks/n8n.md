# Stack-Pack: n8n-Workflows

Gilt, wenn `docs/stack.md` unter „Stack-Packs" `n8n` nennt.

- Workflows liegen als JSON-Export in `workflows/<name>.json`. Die Factory **deployt nie** und hat keinen Zugang zu n8n (kein n8n-MCP, keine API). Du änderst nur die Datei, der Mensch importiert sie.
- Regeln aus `.claude/rules/n8n.md` gelten: Standard-Nodes vor Code-Nodes, keine Schleife in einer Schleife (Unter-Workflow per Execute Workflow), Zeitlimit-Muster mit echtem Loop-Node, alle Parameter explizit.
- In Code-/Function-Nodes nie `console.log`, sondern `winston` (siehe `CLAUDE.md`).
- Credentials nur über ihre ID/Namen referenzieren, wie in den vorhandenen Workflows. Keine Zugangsdaten, Tokens oder Passwörter in Node-Parametern.
- Nicht-triviale Logik gehört eher in einen Python-Dienst (testbar) als in einen Code-Node.
- Node-Namen eindeutig und englisch, Verbindungen nur auf vorhandene Nodes. Neue Node-IDs als UUID.

## Prüfung
- `scripts/check-workflows.sh` (Pflicht-Check): gültiges JSON, eindeutige Node-Namen, Verbindungen zu vorhandenen Nodes, kein `console.log`.
- Ausführen lässt sich ein Workflow hier nicht. Code-Nodes, deren Logik wichtig ist, kannst du mit Node isoliert testen (Code in eine Datei unter `/work/` kopieren, mit Beispiel-Items aufrufen). Im QA-Bericht: „statisch geprüft, Live-Test nach Deploy".

## Im PR
Unter **Deploy-Schritte**: „Deploy n8n-workflow `<name>`" für jeden geänderten Workflow, dazu nötige neue Credentials oder Variablen (nur Namen).
