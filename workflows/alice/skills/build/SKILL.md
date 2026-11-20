---
name: build
description: Implement an Alice feature from its spec + design end to end (schema, services, n8n workflows, frontend, tests). Factory mode.
argument-hint: "features/PROJ-X-<name>/spec.md"
user-invocable: true
---

# Developer (Factory Mode, Alice)

## Role
You implement what the spec describes, the way the design plans it. The spec is the contract: never edit it. If it turns out to be wrong or impossible, stop and ask via `factory-report question "<what you found>" --question "<question with options>"`.

## Before Starting
1. Read the spec and `design.md` in the same feature folder.
2. Read `CLAUDE.md` and the rules in `.claude/rules/` that match the files you will touch. They are **binding** (language conventions, i18n, winston instead of console.log, RLS, …).
3. Read `docs/stack.md` and the stack packs it lists under `/factory/workflows/alice/stacks/`.
4. `features/INDEX.md` → status `In Progress` (only the status cell).
5. Look at what exists before creating anything: the service directories you touch, `git log --oneline -15`, existing tests.

## Order of Work
1. **Schema** (if needed): see stack pack `postgres`. Change `sql/init-schema.sql` and add an idempotent migration file. Weaviate: see stack pack `weaviate`.
2. **Services**: see stack pack `docker-services`. Logic in Python, input validation, auth/permission check on every endpoint, errors with correct status codes.
3. **n8n workflows** (if needed): see stack pack `n8n`. Edit the JSON export in `workflows/`, never deploy.
4. **Frontend** (if needed): see stack pack `nextjs-static`. Every user-facing string through i18n (all configured languages), loading/error/empty states.
5. **Wire up**: nginx route (`docker/compose/infra/nginx/conf.d/`), Makefile `STACKS` for a new service, `.env.example` for new variables.

## Tests
- Unit tests for non-trivial logic, next to the existing tests of the service (`tests/test_*.py`).
- Integration tests for DB-backed behaviour against the throwaway test databases (`scripts/test-services.sh <service>` starts them), skipped without the DSN like the existing ones.
- External systems (Home Assistant, LLM gateway, Google, MQTT, NAS) are always mocked in tests.
- Container test for every changed service: `scripts/test-containers.sh <service>` (builds the image, starts it with the throwaway databases, waits for its healthcheck). If it needs more environment or secret files to start, add test values in `tests/container.env` / `tests/container-secrets/`; for new endpoints add a `tests/container-smoke.sh` (stack pack `docker-services`, "Container-Test").
- Run `scripts/test-services.sh <changed services>` and `scripts/test-containers.sh <changed services>` until green, then the full checks from `.factory/setup.json`.

## Checklist (before handing over to QA)
- [ ] Every acceptance criterion from the spec is addressed
- [ ] Rules from `CLAUDE.md` / `.claude/rules/` followed (English identifiers and comments, i18n, no console.log in n8n, …)
- [ ] Schema: `init-schema.sql` + migration, RLS/permissions, indexes
- [ ] New env variables only as placeholders in `.env.example`, no `.env` touched
- [ ] Tests green, `frontend` typecheck/build green if touched
- [ ] Short implementation notes appended to the design file ("Umsetzung": what was built, deviations and why)
- [ ] Container test green for every changed service, healthcheck proves the service really works
- [ ] "Deploy-Schritte" collected for the PR (see design section F), including `scripts/stage.sh` and what to check in staging

## Commits
One commit per layer, English, with feature ID and issue number:
```
feat(PROJ-X): Add <table> schema and migration (#<issue-nr>)
feat(PROJ-X): Implement <endpoint> in alice-<service> (#<issue-nr>)
test(PROJ-X): Cover <behaviour> (#<issue-nr>)
```

## Context Recovery
If your context was compacted: re-read the spec and the design file, run `git log --oneline -10` and `git diff`, continue where you stopped. Do not restart.
