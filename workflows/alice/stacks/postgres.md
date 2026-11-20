# Stack-Pack: PostgreSQL (Schema `alice`)

Gilt, wenn `docs/stack.md` unter „Stack-Packs" `postgres` nennt.

## Schema
- Alle Tabellen im Schema `alice`. Quelle der Wahrheit für neue Installationen ist `sql/init-schema.sql` (konsolidiert, idempotent: `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
- Jede Schema-Änderung **zweimal**:
  1. in `sql/init-schema.sql` an der passenden Stelle (bei neuen Installationen und für die Test-Datenbank)
  2. als Migration für die bestehende Produktiv-Datenbank: `sql/migrations/<JJJJ-MM-TT>_PROJ-X_<kurzname>.sql`, idempotent und in einer Transaktion (`BEGIN; … COMMIT;`). Gibt es den Ordner noch nicht, legst du ihn an.
- Nie SQL gegen eine echte Datenbank ausführen. Die Produktiv-Datenbank ist für dich unerreichbar und wird vom Menschen migriert.
- Regeln aus `.claude/rules/backend.md`: Row Level Security und Policies auf neuen Tabellen, Indizes auf Filter-/Sortier-/Join-Spalten, Fremdschlüssel mit bewusstem `ON DELETE`.
- Berechtigungen über das vorhandene System: `alice.role_templates`, `alice.permissions_*`, `alice.init_user_permissions()`, `alice.check_*_permission()`. Neue Berechtigungen auch in den Rollen-Vorlagen ergänzen.
- Sonderfälle im Schema kennen: z. B. der Gast-Nutzer `00000000-0000-0000-0000-000000000000` für nicht erkannte Sprecher.

## Zugriff aus Diensten
- `asyncpg` mit Pool, immer parametrisierte Abfragen (`$1`), Listen mit `LIMIT`, keine N+1-Abfragen.
- DSN aus `POSTGRES_DSN` (bzw. der Variable des Dienstes).

## Tests
- Die Test-Datenbank aus `docker/test/compose.test.yml` startet leer mit `sql/init-schema.sql`. Prüfe nach jeder Schema-Änderung, dass sie fehlerfrei startet: `docker compose -p sf-db -f docker/test/compose.test.yml up -d --wait test-postgres`, dann `docker compose -p sf-db -f docker/test/compose.test.yml logs test-postgres | grep -i error`.
- Die Migration zusätzlich gegen eine Datenbank im **alten** Stand testen: `git show origin/$FACTORY_DEFAULT_BRANCH:sql/init-schema.sql > /work/old-schema.sql`, Container mit diesem Schema starten, Migration zweimal anwenden (`psql -v ON_ERROR_STOP=1 -f …`), beide Läufe ohne Fehler.
- `psql` und `redis-cli` sind im Job installiert.

## Im PR
Unter **Deploy-Schritte**: die Migrationsdatei und der Befehl, z. B. `docker exec -i postgres psql -U <user> -d alice -v ON_ERROR_STOP=1 < sql/migrations/<datei>.sql`.
