# QA-Bericht: PROJ-X <Feature-Name> (#<issue-nr>)

**Spec:** [spec.md](spec.md) · **Design:** [design.md](design.md)
**Getestet am:** YYYY-MM-DD · **Commit:** `<sha>`

## Ergebnis
**Produktionsreif:** Ja / Nein
- Akzeptanzkriterien: X von Y bestanden
- Bugs: Critical 0 · High 0 · Medium 0 · Low 0

## Akzeptanzkriterien
| AK | Ergebnis | Nachweis |
|---|---|---|
| AK-1 … | ✅ | automatisiert (`tests/test_….py::…`) |
| AK-2 … | ✅ | manuell gegen Test-Container (curl) |
| AK-3 … | ⚠️ | statisch geprüft, Live-Test nach Deploy (n8n) |

## Edge Cases
- ✅ EC-1: …

## Bugs
- **B-1 (High):** Beschreibung · Schritte: 1. … 2. … · Erwartet: … · Tatsächlich: …

## Sicherheit
- Keine Auffälligkeiten / Befund: …

## Nicht live geprüft
- … (Grund, womit stattdessen geprüft)

## Automatisierte Tests
- `scripts/test-services.sh …`: … bestanden
