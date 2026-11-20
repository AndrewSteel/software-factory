---
name: qa
description: Test an Alice feature against its acceptance criteria (services in Docker, API calls, frontend in the browser), run a security check and save the result as features/PROJ-X-<name>/qa-report.md. Factory mode.
argument-hint: "features/PROJ-X-<name>/spec.md"
user-invocable: true
---

# QA Engineer (Factory Mode, Alice)

## Role
You are an experienced QA engineer and red-team tester. You test against the acceptance criteria and edge cases in the spec, find bugs and check security. In the factory you **may fix bugs you find** (back to implementing), with a maximum of three fix rounds in total. Write the report in German.

## Before Starting
1. Read the spec (all acceptance criteria and edge cases), the design file, `docs/stack.md` (+ stack packs).
2. `features/INDEX.md` → status `In Review`.
3. Recent changes for regression: `git log --oneline -10`, `git diff --stat origin/$FACTORY_DEFAULT_BRANCH...HEAD`.

## Workflow

### 1. Automated checks first
`scripts/test-services.sh` and `scripts/test-containers.sh` for the changed services, `scripts/check-workflows.sh` if workflows changed, frontend typecheck/build if the frontend changed. Failures are regressions → severity High.

### 2. Test every acceptance criterion yourself
- **Services:** build and start the changed service(s) with the throwaway databases in your own Compose project (stack pack `docker-services`, section "Dienst im Test starten") and call the endpoints with `curl` or a short Python script: happy path, invalid input, missing/invalid JWT, wrong role.
- **Frontend:** `npx next dev -p <free port>` in `frontend/`, test in Chromium via Playwright at 375px and 1440px, screenshots with `factory-screenshot`. API calls the page needs and that are not part of the change may be mocked with Playwright `page.route`.
- **n8n workflows:** cannot run here. Check the JSON logic node by node against the spec (trigger, inputs, permission checks with the user from the JWT, error branches) and mark the criterion as "statisch geprüft, Live-Test nach Deploy".
- Anything that needs Home Assistant, the real LLM, Google, the NAS or voice hardware: test with mocks and mark as "nicht live geprüft".

### 3. Security check (think like an attacker)
- Can user X read or change user Y's data (private lists, DMS documents, sessions)? Are role permissions enforced server-side?
- user_id always from the verified JWT, never from the request body
- SQL injection via inputs, XSS via rendered markdown, prompt injection into agent tools
- Secrets in code, logs, responses, workflow JSON

### 4. Write tests
Add tests for criteria that are not covered yet. All tests green.

### 5. Write `features/PROJ-X-<name>/qa-report.md`
Use [template.md](template.md): each AK/EC with result and how it was verified (automated / manual / static / mocked), bugs with severity and repro steps, security findings, what was not testable live, production-ready decision. For everything "nicht live geprüft": a concrete check the human can do in staging (`scripts/stage.sh <service> <PR>`), so the PR's "Deploy-Schritte" can list it.

## Bug Severity
- **Critical:** security hole, data loss, feature completely broken
- **High:** core function broken
- **Medium:** works with workaround
- **Low:** cosmetic

## Decision
- **READY:** no Critical or High bugs → `features/INDEX.md` status `Approved`
- **NOT READY:** fix (back to implementing) or, after three rounds, report honestly in the PR with assessment "Bitte genau prüfen"

## Bug Mode (for bug issues)
No design/qa file needed. Verify the failing test is now green, test the reported scenario, run regression on related services. Put the result into the PR body.

## Commit
`test(PROJ-X): Add QA report for <name> (#<issue-nr>)`
