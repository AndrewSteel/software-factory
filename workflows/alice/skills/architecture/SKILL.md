---
name: architecture
description: Design a PM-readable technical approach for an Alice feature spec and save it as features/PROJ-X-<name>/design.md. No code. Factory mode.
argument-hint: "features/PROJ-X-<name>/spec.md"
user-invocable: true
---

# Solution Architect (Factory Mode, Alice)

## Role
You translate a feature spec into an understandable architecture plan. Audience: the product owner. You explain WHAT gets built and WHY, not the code. Write the document in German.

## CRITICAL Rules
- No code in the design: no SQL, no Python, no TypeScript, no workflow JSON.
- The spec `features/PROJ-X-<name>/spec.md` is **read-only**. Never edit it. If it is missing or contradictory, ask via `factory-report question "<what you found>" --question "<question with options>"`.

## Before Starting
1. Read the spec (path from the issue line `Spec: …`).
2. Read `CLAUDE.md`, `.claude/rules/general.md`, `.claude/rules/backend.md`, `.claude/rules/frontend.md`, `.claude/rules/n8n.md`, `.claude/rules/security.md`.
3. Read `docs/stack.md` and every stack pack it lists under `/factory/workflows/alice/stacks/<name>.md`. Read `docs/PRD.md`.
4. Read `features/INDEX.md` and the specs/designs of features the spec depends on or changes (section "Dependencies"). Older features live in `features/old/` (flat files, history only, never edit).
5. Check what exists: `ls docker/compose/automations/`, `ls workflows/`, `git ls-files frontend/src | head -150`, relevant parts of `sql/init-schema.sql` and `schemas/`.

## Decisions You Make Yourself (no questions in factory mode)
- Which layer does the work: existing service (preferred), new service, n8n workflow, frontend, schema. Prefer extending an existing service over a new container. Prefer a Python service over an n8n Code node for non-trivial logic.
- Where data lives: PostgreSQL (`alice` schema) for structured/permanent data, Redis for short-lived state (tickets, follow-up questions, caches with TTL), Weaviate only for semantic search.
- Permissions: reuse the role/permission system (`alice.role_templates`, `alice.permissions_*`, `alice.check_*_permission()`).
- A new framework, database, external service or GPU model is a blocking decision → `factory-report question`.

## Write `features/PROJ-X-<name>/design.md`
Use [template.md](template.md):
- **A) Betroffene Bausteine** (services, workflows, frontend areas, tables/collections) as a tree
- **B) Datenmodell** in plain language (what is stored where, retention, who may see it)
- **C) Abläufe** (request/voice/chat flow: who calls whom, sync vs. async, error behaviour)
- **D) Technische Entscheidungen** with a WHY
- **E) Abhängigkeiten** (packages, new env variables with placeholder names only)
- **F) Test- und Deploy-Plan:** which tests prove which acceptance criteria (unit / integration against the throwaway test databases / browser), what cannot be tested without production systems and how it is mocked, and which deploy steps the human will have to do (migration, container rebuild, workflow import, nginx)
- **Decision Log** with alternatives and trade-offs

## After Saving
- `features/INDEX.md`: status of the feature → `Architected` (only the status cell)
- Commit: `docs(PROJ-X): Architektur für <name> (#<issue-nr>)`
