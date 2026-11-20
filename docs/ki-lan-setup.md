# Factory auf dem eigenen Server neben produktiven Diensten (ki.lan, Alice)

Diese Anleitung gilt, wenn die Factory auf demselben Server läuft wie deine Anwendungen, hier `ki.lan` mit Alice. Gegenüber der [VPS-Anleitung](hostinger-vps-setup.md) ändern sich drei Dinge:

1. **Docker im Job:** Bau und Abnahme starten Test-Container (Postgres, Redis, Weaviate, eigene Dienste). Dafür bekommt jeder Job einen eigenen **Docker-Wächter** statt des echten Docker-Sockets (Docker-out-of-Docker).
2. **Keine Vorschau:** Das Alice-Frontend allein ergibt ohne die Dienste keine sinnvolle Vorschau, und Caddy würde sich Ports mit nginx teilen. In der Alice-Vorlage ist `preview` deshalb nicht gesetzt.
3. **Workflow `alice`:** Ablage wie im Starter Kit (`features/PROJ-X-<name>/spec.md`, alte flache Specs unter `features/old/`), Alice-Regeln, Stack-Packs für Docker-Dienste, Postgres, Redis, Weaviate, n8n und statisches Next.js.

## Einrichten

Als root auf ki.lan:

```bash
git clone https://github.com/<dein-fork>/software-factory.git /opt/software-factory
cd /opt/software-factory
FACTORY_CONFIG_TEMPLATE=factory.config.alice.example.json ./setup.sh
```

`setup.sh` überspringt, was schon da ist (Docker). Bun wird installiert bzw. auf ≥ 1.4 aktualisiert: Ältere Bun-Versionen können keine halboffenen Verbindungen, dann liefern `docker exec` und `docker run` im Job keine Ausgabe. Der Runner prüft das beim Start und bricht sonst mit einem Hinweis ab.

Danach wie gewohnt:

1. Claude-Token: auf deinem Rechner `claude setup-token`, Ergebnis als `CLAUDE_CODE_OAUTH_TOKEN=...` in `/etc/software-factory/secrets.env`
2. GitHub: `gh auth login -s project`
3. Repo anbinden: `./scripts/add-repo.sh AndrewSteel/alice` (Labels, Board)
4. Starten: `systemctl restart software-factory`, Logs: `journalctl -u software-factory -f`. In der Startzeile steht `"docker":"Docker-Wächter an"`.

Auf deinem Rechner nur `to-factory` installieren. Alice bringt eigene Projekt-Skills mit, die schon die Ordner-Ablage nutzen: `init` (neue Phase planen: PRD und Feature-Karte), `write-spec`, `refine` und `deploy`. Persönliche Skills gleichen Namens aus diesem Repo hätten Vorrang und würden Alices Versionen überdecken.

```bash
./scripts/install-local-skills.sh to-factory
```

## Im Alice-Repo

Die Factory liest Spec, `docs/` und Projektregeln von GitHub. Dafür müssen `features/`, `docs/` und `.claude/` wieder ins Repo (nicht mehr in `.gitignore`). Außerdem braucht sie:

| Datei | Zweck |
|---|---|
| `.factory/setup.json` | Installation und Pflicht-Checks (Typecheck, Frontend-Build, Dienst-Tests, n8n-Prüfung, Container-Test) |
| `docs/stack.md` | Stack und Stack-Packs |
| `docker/test/compose.test.yml` | Wegwerf-Postgres (mit `sql/init-schema.sql`), Redis, optional Weaviate ohne GPU |
| `scripts/test-services.sh` | pytest für alle Dienste, startet und entfernt die Test-Datenbanken |
| `scripts/check-workflows.sh` | Prüfung der n8n-JSON-Exporte |
| `scripts/test-containers.sh` | Container-Test der geänderten Dienste (Image bauen, starten, Healthcheck) |
| `scripts/stage.sh`, `scripts/lib/` | Staging neben der Produktion, nur von dir ausgeführt |

Die Test-Infrastruktur liegt bewusst unter `docker/test/` und nicht unter `docker/compose/`: `sync-compose.sh` spiegelt `docker/compose/` mit `--delete` auf den Server.

Ablauf pro Feature: Spec lokal mit `/write-spec` → committen und pushen → `/to-factory PROJ-X` → PR prüfen → geänderte Dienste stagen → mergen → **selbst deployen** (die Schritte stehen im PR unter „Deploy-Schritte").

## Container-Änderungen: Test in der Factory, Staging bei dir

**1. Container-Test (Pflicht-Check `container-tests`, in der Factory).** `scripts/test-containers.sh` baut jeden Dienst, den der Branch ändert, aus seinem `Dockerfile` und startet ihn mit Wegwerf-Postgres, -Redis und bei Bedarf -Weaviate und -MQTT. Bestanden ist der Check erst, wenn der Healthcheck aus `compose.yml` `healthy` meldet und ein optionaler Rauchtest (`tests/container-smoke.sh`) grün ist. Ohne den Check gibt es keinen PR. Der Test-Container bekommt nur `.env.example` mit umgebogenen Test-Adressen, ein frisch erzeugtes JWT-Schlüsselpaar und Testwerte aus `tests/container.env` bzw. `tests/container-secrets/`. Server-Pfade, Netze, Ports und GPUs bekommt er nicht. Lokal: `scripts/test-containers.sh alice-lists`.

**2. Staging (du, auf ki.lan, vor dem Merge).** Was die Factory nicht prüfen kann (echte Daten, Home Assistant, LLM, Zusammenspiel mit den laufenden Diensten), siehst du dir so an:

```bash
scripts/stage.sh alice-lists 123      # PR-Nummer oder Branch, z. B. origin/factory/45
scripts/stage.sh alice-lists --logs
scripts/stage.sh alice-lists --down
```

Das Skript läuft auf deinem Rechner und arbeitet per SSH auf `ki.lan` (`STAGE_HOST`). Es nimmt aus dem PR nur den Dienst-Ordner, baut das Image und startet `alice-lists-staging` **neben** dem produktiven Container: mit der echten `.env` aus `/srv/compose/...`, denselben Volumes und Netzen, aber ohne nginx-Route, ohne veröffentlichte Ports und **ohne den DNS-Namen des Produktivdienstes**. Andere Dienste sprechen also weiter mit der Produktion, nur du erreichst die Staging-Version (`docker run --rm --network backend curlimages/curl -s http://alice-lists-staging:8010/health`). Vorher zeigt es dir, was sich am Dienst geändert hat, und bei geänderter `compose.yml` den vollständigen Diff. Diese Datei läuft mit deinen echten Zugangsdaten.

Achtung: Staging arbeitet auf **Produktivdaten**, und Hintergrundarbeit (MQTT-Listener, Polling, Zeitpläne) läuft doppelt, solange der Container läuft. Bei solchen Diensten kurz halten oder den produktiven Container währenddessen selbst anhalten.

**Schutz der Skripte.** `stage.sh` führst du mit echten Zugangsdaten aus. Deshalb verwendet es immer deine lokale Fassung von `scripts/stage.sh` und `scripts/lib/`, nie die aus dem PR. Außerdem lehnt der Runner Factory-PRs ab, die eine Datei aus `protectedPaths` ändern. In der Alice-Vorlage sind das `.factory/setup.json`, die Test-Skripte, `stage.sh` und `scripts/lib/`. So kann die Factory weder den Pflicht-Check abschalten noch das Staging-Skript verändern.

## Was der Docker-Wächter erlaubt und sperrt

Jeder Bau- und Abnahme-Job bekommt ein eigenes Netz und einen eigenen Socket (`/run/software-factory/docker/<job>/`). Alles, was er anlegt, trägt das Label `sf.owner=<job>` und wird nach dem Lauf entfernt, auch nach einem Absturz oder Neustart des Runners.

**Erlaubt:** Images ziehen und bauen (klassischer Builder), Container, Netze und Volumes anlegen und verwalten, `exec`, `logs`, `cp`, Compose. Bind-Mounts nur aus dem Job-Ordner (`/work/...`).

**Gesperrt:**
- jeder Zugriff auf Container, Netze, Volumes und Images, die der Job nicht selbst angelegt hat. Produktive Container wie `postgres`, `n8n` oder `alice-chat-stream` sind für den Job unsichtbar.
- Server-Pfade als Bind-Mount (`/srv/...`, `/etc`, `/var/run/docker.sock` …), Volume-Treiber-Optionen (damit ließen sich Server-Pfade einbinden)
- `privileged`, Capabilities, Geräte, **GPUs**, andere Runtimes, host-Netz/-PID/-IPC/-userns, Seccomp/AppArmor abschalten, `systempaths=unconfined`
- produktive Netze (`backend`, `automation`, `frontend`, `llm`), eigene Subnetze (könnten mit dem LAN kollidieren)
- Image-Tags, die schon einem fremden Image gehören (sonst ließe sich z. B. `alice-lists-alice-lists` ersetzen und beim nächsten `up` ausrollen)
- BuildKit (`/grpc`, `/session`): Dort lassen sich die Build-Parameter nicht prüfen. Der Job baut mit `DOCKER_BUILDKIT=0`.
- `prune`, `commit`, `load`, `push`, `docker update`, Swarm, Plugins

**Grenzen pro Test-Container** (Config `docker`): Speicher (Standard 2 GB in der Alice-Vorlage), CPU (2), Prozesse (1024), höchstens 8 Container pro Job. Neustart-Regeln werden entfernt, veröffentlichte Ports nur auf `127.0.0.1`.

### Was bleibt

- **Netzwerk:** Job und Test-Container erreichen das Internet und, wie jeder Container, das LAN und Ports, die auf dem Server nach außen veröffentlicht sind. Ohne Zugangsdaten kommen sie dort nicht weiter, Zugangsdaten hat der Job keine. Trotzdem empfehlenswert: produktive Ports, die nur lokal gebraucht werden, auf `127.0.0.1` binden (in Alice z. B. `postgres` mit `5432:5432`).
- **`docker pull`** kann den Tag eines offiziellen Images (`postgres:16`) auf eine neuere Version setzen, wie ein manuelles Update. Laufende Container ändert das nicht.
- **Plattenplatz:** Images und Volumes eines Jobs werden entfernt, gezogene Basis-Images (postgres, redis, weaviate) bleiben als Cache. Gelegentlich `docker system df` prüfen.
- **Last:** Mit `maxParallel: 1` läuft höchstens ein Job mit seinen Test-Containern. GPUs bleiben vollständig bei den produktiven Diensten.

Nachsehen, was gerade zur Factory gehört: `docker ps -a --filter label=sf.owner`, abgelehnte Docker-Aufrufe: `journalctl -u software-factory | grep guard:denied`.

## Keine Zugangsdaten im Repo

Alice ist öffentlich. Ein gepushter Commit ist sofort öffentlich, auch wenn der PR nie gemergt wird. Deshalb gibt es mehrere Schranken:

1. **Kein Zugang zu echten Zugangsdaten:** Die `.env`-Dateien liegen nur unter `/srv/compose/...` auf dem Server. Der Job hat keinen Mount dorthin, und der Docker-Wächter sperrt Bind-Mounts außerhalb des Job-Ordners. Für Tests gibt es nur feste Wegwerf-Werte (Passwort `test` in `docker/test/compose.test.yml`).
2. **Vor jedem Push** (Git-Hook im Job-Image): `factory-secret-scan` prüft alle neuen Commits auf `.env`-Dateien (außer `*.example`), Schlüssel und Zertifikate, auf die Tokens des Jobs selbst (GitHub, Claude) und mit gitleaks auf bekannte Token-Formate. Schlägt er an, wird nicht gepusht.
3. **`factory-verify`** führt denselben Scan als festen Check `secrets` aus, den kein Repo abschalten kann.
4. **Der Runner** übernimmt einen Bau nur, wenn `secrets` grün war und der PR keine Datei wie `.env`, `*.pem` oder `*.key` enthält.
5. Fehlermeldungen, die der Runner ins Issue schreibt, werden um Tokens und `…PASSWORD=`/`…TOKEN=`-Werte bereinigt.

Zusätzlich empfohlen: im Alice-Repo unter *Settings → Code security* **Secret scanning** und **Push protection** einschalten (für öffentliche Repos kostenlos). Dann blockt auch GitHub selbst bekannte Token-Formate.

Restrisiko: gitleaks erkennt nicht jedes selbst ausgedachte Passwort-Format. Weil der Job aber keine echten Zugangsdaten sieht, kann er auch keine veröffentlichen.
