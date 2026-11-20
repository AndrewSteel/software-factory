# Stack-Pack: Weaviate

Gilt, wenn `docs/stack.md` unter „Stack-Packs" `weaviate` nennt.

- Collections sind in `schemas/*.json` beschrieben und werden mit `scripts/init-weaviate-schema.sh` angelegt. Neue Collection oder neue Eigenschaft: Schema-Datei ändern bzw. anlegen, `init-weaviate-schema.sh` ergänzen. Bestehende Eigenschaften nicht umbenennen oder umtypisieren (Weaviate kann das nicht migrieren), sondern neu anlegen und im PR das Vorgehen für die Daten beschreiben.
- Produktiv laufen die Vektorisierer `multi2vec-clip` und `text2vec-transformers` auf der GPU. Im Test gibt es **keine GPU und keine Vektorisierer**:
  - `test-weaviate` startet nur mit Profil: `docker compose -p sf-alice-test -f docker/test/compose.test.yml --profile weaviate up -d --wait test-weaviate` (erreichbar als `http://test-weaviate:8080`).
  - Tests legen Collections mit `vectorizer: none` an und liefern Vektoren selbst mit (kleine feste Vektoren reichen), oder bilden den Weaviate-Client nach.
  - Schema-Dateien, die einen Vektorisierer brauchen, nur statisch prüfen (gültiges JSON, Eigenschaften vollständig) und im QA-Bericht als „nicht live geprüft" markieren.
- Filter für Berechtigungen (Nutzer, Dokumenttyp) immer serverseitig in der Abfrage, nie erst nach dem Laden.
- Nie gegen das Produktiv-Weaviate testen.
