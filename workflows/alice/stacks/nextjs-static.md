# Stack-Pack: Next.js als statischer Export

Gilt, wenn `docs/stack.md` unter „Stack-Packs" `nextjs-static` nennt.

## Grundsätze
- `frontend/` ist Next.js 15 mit `output: "export"`: es gibt **keinen Node-Server** in Produktion. Keine Route Handlers, keine Server Actions, kein `getServerSideProps`, keine dynamischen Routen ohne `generateStaticParams`. Daten kommen zur Laufzeit im Browser von den Diensten über nginx (`/api/...`).
- Aufbau siehe `CLAUDE.md` (Code Reference) und `.claude/rules/frontend.md`. API-Zugriffe gebündelt in `src/services/`, Hooks in `src/hooks/`.
- Bausteine: vorhandene Komponenten aus `src/components/` und die Radix-/shadcn-Bausteine, Styling mit Tailwind.
- **i18n Pflicht:** kein sichtbarer Text im Code, alles über react-i18next (`src/i18n/`), für **alle** vorhandenen Sprachen.
- Auth: JWT aus `services/auth.js`, geschützte Ansichten über `ProtectedRoute`. Die Prüfung der Rechte passiert im Dienst, die Oberfläche blendet nur aus.
- Jede Ansicht mit Lade-, Fehler- und Leerzustand, nutzbar auf 375px und 1440px.

## Befehle
- install `cd frontend && npm ci`
- dev `cd frontend && npx next dev -p $PORT` (gegen Attrappen: API-Aufrufe in Playwright mit `page.route` beantworten, die echten Dienste gibt es im Job nicht)
- checks: `npx tsc --noEmit`, `npm run build` (prüft auch, dass der statische Export funktioniert)
- `npm run lint` ist noch nicht eingerichtet (fragt interaktiv nach einer ESLint-Konfiguration) und gehört nicht zu den Checks.

## Im PR
Unter **Deploy-Schritte**: `./scripts/deploy-frontend.sh` und `./scripts/sync-compose.sh`, falls nginx-Konfiguration geändert wurde zusätzlich nginx neu laden.
