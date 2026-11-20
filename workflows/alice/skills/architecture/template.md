# Architektur: PROJ-X <Feature-Name> (#<issue-nr>)

**Spec:** [spec.md](spec.md) · **Stand:** YYYY-MM-DD

## A) Betroffene Bausteine
```
alice-<dienst> (Container)
+-- neuer Endpunkt / Agent-Tool …
n8n: alice-<workflow>
Frontend: Einstellungen › …
PostgreSQL: alice.<tabelle> (neu)
```

## B) Datenmodell
- …

## C) Abläufe
1. …

## D) Technische Entscheidungen
- **…**, weil …

## E) Abhängigkeiten
- Pakete: keine / …
- Neue Umgebungsvariablen (nur Namen, Platzhalter in `.env.example`): …

## F) Test- und Deploy-Plan
| AK | Nachweis | Art |
|---|---|---|
| AK-1 | … | Unit / Integration (Test-DB) / Browser |

Nicht ohne Produktivsysteme testbar: … → Attrappe: …

Deploy-Schritte für den Menschen:
1. …

## Decision Log
| Entscheidung | Alternative | Abwägung |
|---|---|---|
