# Stack-Pack: Redis

Gilt, wenn `docs/stack.md` unter „Stack-Packs" `redis` nennt.

- Redis ist für **kurzlebigen Zustand**: Lösch-Tickets, offene Rückfragen, Sitzungszustand, Caches. Jeder Schlüssel bekommt eine TTL (`SET … EX`). Dauerhafte Daten gehören in Postgres.
- Schlüssel mit Präfix des Dienstes und der Nutzer-ID, z. B. `lists:ticket:<user_id>:<id>`, damit Nutzer sich nicht gegenseitig sehen.
- Verbindung aus `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` (bzw. `REDIS_URL`) des Dienstes.
- Tests: in Unit-Tests eine Attrappe (siehe `FakeRedis` in `tests/conftest.py` der Dienste). Für Integrationstests läuft `test-redis` in `docker/test/compose.test.yml` (ohne Passwort, ohne Persistenz), erreichbar als `TEST_REDIS_URL`.
- Nie gegen den Produktiv-Redis testen.
