# Stack-Pack: Docker-Dienste (Python) mit Docker-out-of-Docker

Gilt, wenn `docs/stack.md` unter „Stack-Packs" `docker-services` nennt.

## Aufbau eines Dienstes
- Ein Dienst = ein Ordner `docker/compose/automations/<dienst>/` mit `Dockerfile`, `compose.yml`, `.env.example`, `requirements.txt` (+ `requirements-dev.txt`, `pytest.ini`), Code in `app/`, Tests in `tests/`. Alles, was zum Container gehört, liegt in diesem Ordner.
- Python 3.12, FastAPI/Starlette, `asyncpg` für Postgres, `redis` für Redis, `httpx` für HTTP. Neue Abhängigkeiten mit Versionsbereich (`>=x,<y`) wie die vorhandenen.
- Konfiguration nur über Umgebungsvariablen. Neue Variablen mit **Platzhalter** in `.env.example` dokumentieren (`POSTGRES_DSN=postgresql://user:password@postgres:5432/alice`). Die echte `.env` gibt es nur auf dem Server, du siehst und brauchst sie nie.
- JWT: Dienste prüfen RS256 mit dem öffentlichen Schlüssel aus `JWT_PUBLIC_KEY_PATH`. `user_id` und Rolle immer aus dem geprüften Token.
- Neuer Dienst: `compose.yml` nach dem Muster der vorhandenen (externe Netze `backend`/`automation`, `restart: unless-stopped`, Healthcheck, Label `com.centurylinklabs.watchtower.enable=false`), Eintrag in `docker/compose/scripts/Makefile` (`STACKS`), nginx-Route falls von außen erreichbar.
- Logging über das `logging`-Modul, keine Secrets in Logs.

## Produktiv-Compose-Files nie starten
`docker/compose/**/compose.yml` hängen an externen Netzen, `/srv/...`-Pfaden und `.env`-Dateien. Der Docker-Wächter lehnt das ab, und es wäre auch falsch. Zum Testen gibt es `docker/test/`.

## Tests
- `scripts/test-services.sh <dienst> …` legt pro Dienst eine venv an (außerhalb des Repos), installiert die Abhängigkeiten, startet die Wegwerf-Datenbanken aus `docker/test/compose.test.yml` und führt pytest aus. Ohne Argument: alle Dienste mit `tests/`.
- Unit-Tests mit Attrappen (siehe `tests/conftest.py` der Dienste: FakeRedis, FakeGoogle …). Integrationstests gegen Postgres nur über `TEST_POSTGRES_DSN` (bestehende Tests: `LISTS_TEST_DSN`, `CALENDAR_TEST_DSN`), Redis über `TEST_REDIS_URL`, ohne Variable `pytest.skip`.
- Externe Systeme (Home Assistant, LLM-Gateway, Google, MQTT, NAS, Whisper/Piper) in Tests immer nachbilden.
- Braucht ein Dienst besondere Test-Abhängigkeiten (z. B. torch für die CPU): `tests/install-test-deps.sh` (Beispiel: `alice-speech-gateway`).

## Container-Test (Pflicht-Check `container-tests`)
`scripts/test-containers.sh` baut **jeden Dienst, den dein Branch ändert**, aus seinem `Dockerfile` (so wie `compose.yml` es angibt), startet ihn mit den Wegwerf-Datenbanken und wartet, bis der Healthcheck aus `compose.yml` `healthy` meldet. Ohne Healthcheck reicht das nicht: Jeder Dienst braucht einen, der prüft, dass er wirklich arbeitet (bei Workern z. B. ein Heartbeat wie in `alice-ha-sync`).

Der Test-Container bekommt keine Server-Pfade, Netze, Ports, GPUs und keine `.env`. Stattdessen:
- **Umgebung:** `.env.example` des Dienstes. Postgres, Redis, Weaviate und MQTT werden automatisch auf die Test-Container umgebogen (`POSTGRES_DSN`, `POSTGRES_CONNECTION`, `REDIS_*`, `WEAVIATE_URL`, `MQTT_*`). Nutzt der Dienst Weaviate oder MQTT, startet der Test sie mit. Was darüber hinaus zum Starten nötig ist, kommt in `tests/container.env` (nur Wegwerfwerte wie `test`, die Datei wird committet).
- **`/run/secrets`:** frisches Schlüsselpaar als `jwt_private.pem`/`jwt_public.pem`. Andere Secret-Dateien, die `compose.yml` unter `/run/secrets/` einbindet, aus `tests/container-secrets/<name>` (Testinhalt, Beispiel: `alice-llm-gateway`), sonst steht dort `test`.
- **Rauchtest:** `tests/container-smoke.sh` (ausführbar) läuft, wenn der Container gesund ist. Er bekommt `CT_CONTAINER` und ruft den laufenden Dienst z. B. mit `docker exec "$CT_CONTAINER" python -c '…urllib.request.urlopen("http://localhost:8010/…")…'` auf. Für neue Endpunkte lohnt sich ein Aufruf mit und ohne gültiges Token.

Lokal ausprobieren: `scripts/test-containers.sh <dienst>`. `scripts/test-containers.sh`, `scripts/test-services.sh`, `scripts/stage.sh`, `scripts/lib/` und `.factory/setup.json` sind geschützt. Ändert dein PR eine davon, wird der Bau abgelehnt. Brauchst du dort etwas, beschreib es im PR unter „Offene Punkte".

## Dienst im Test starten (Abnahme, manuelle Prüfung)
Eigenes Compose-Projekt aus Test-Infrastruktur + Dienst. Die Datei liegt außerhalb des Repos, z. B. `/work/sut.yml`:

```yaml
include:
  - /work/repo/docker/test/compose.test.yml
services:
  sut:
    build: /work/repo/docker/compose/automations/alice-lists
    environment:
      POSTGRES_DSN: postgresql://alice:test@test-postgres:5432/alice
      REDIS_HOST: test-redis
      JWT_PUBLIC_KEY_PATH: /run/secrets/jwt_public.pem
    volumes:
      - /work/keys/jwt_public.pem:/run/secrets/jwt_public.pem:ro
    depends_on:
      test-postgres: { condition: service_healthy }
```

- Schlüsselpaar für Test-Tokens: `mkdir -p /work/keys && openssl genpkey -algorithm RSA -out /work/keys/jwt_private.pem && openssl pkey -in /work/keys/jwt_private.pem -pubout -out /work/keys/jwt_public.pem`. Tokens damit selbst signieren (PyJWT). Nie ins Repo.
- Starten: `docker compose -p sf-sut -f /work/sut.yml up -d --build --wait`, aufrufen über den Dienstnamen: `curl http://sut:8010/health`.
- Danach: `docker compose -p sf-sut -f /work/sut.yml down -v --rmi local`.

## Im PR
Unter **Deploy-Schritte**, in dieser Reihenfolge:
1. neue Variablen für die `.env` auf dem Server (nur Namen, mit Bedeutung), neue Secret-Dateien unter `/srv/...`
2. **Staging:** `scripts/stage.sh <dienst> <PR-Nummer>` für jeden geänderten Dienst, dazu was der Mensch dort mit echten Daten prüfen soll (konkrete Aufrufe, z. B. `docker run --rm --network backend curlimages/curl -s http://<dienst>-staging:<port>/health`). Hinweis, falls der Dienst im Hintergrund arbeitet (MQTT, Polling, Zeitpläne): Das läuft während des Stagings doppelt.
3. nach dem Merge: `./scripts/sync-compose.sh`, `make rebuild s=automations/<dienst>`, `scripts/stage.sh <dienst> --down`
