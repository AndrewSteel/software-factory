# Job-Image: Jeder Factory-Job läuft in einem eigenen Container aus diesem Image.
# Enthält Claude Code, GitHub CLI, git, Node und einen Chromium für Screenshots/E2E-Tests,
# dazu die Docker-CLI mit Compose (spricht im Job nur mit dem Docker-Wächter des Runners),
# psql/redis-cli für Test-Datenbanken und gitleaks für den Zugangsdaten-Scan vor jedem Push.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

# Exempt from host clean-up jobs (e.g. `docker image prune -af --filter "label!=keep=true"`):
# the image is only in use while a job runs and would otherwise be pruned.
LABEL keep=true

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends git jq curl ca-certificates gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update -qq && apt-get install -y -qq gh \
 && rm -rf /var/lib/apt/lists/*

# Docker-CLI + Compose (ohne Daemon). Builds laufen über den klassischen Builder, BuildKit sperrt der Wächter.
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin postgresql-client redis-tools netcat-openbsd build-essential \
 && rm -rf /var/lib/apt/lists/*
ENV DOCKER_BUILDKIT=0

# gitleaks: Zugangsdaten-Scan vor jedem Push und in factory-verify
ARG GITLEAKS_VERSION=8.28.0
RUN ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/') \
 && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${ARCH}.tar.gz" \
  | tar -xz -C /usr/local/bin gitleaks \
 && gitleaks version

# Playwright als globales Paket (Browser sind im Basis-Image schon vorhanden)
RUN npm install -g playwright@1.65.0 && npm cache clean --force
ENV NODE_PATH=/usr/lib/node_modules

# Factory-Werkzeuge, Playbook und Workflow
COPY image/bin/ /usr/local/bin/
COPY image/entrypoint.sh /factory/entrypoint.sh
COPY image/preview.sh /factory/preview.sh
COPY image/improve.sh /factory/improve.sh
COPY image/git-hooks/ /factory/git-hooks/
COPY playbooks/factory.md /factory/playbook.md
COPY playbooks/improve.md /factory/improve.md
COPY workflows/ /factory/workflows/
RUN chmod +x /usr/local/bin/factory-* /factory/entrypoint.sh /factory/preview.sh /factory/improve.sh /factory/git-hooks/*

# Claude Code als normaler Nutzer installieren (offizieller Installer)
USER pwuser
ENV HOME=/home/pwuser
RUN curl -fsSL https://claude.ai/install.sh | bash
# Python-Projekte: uv (verwaltet Python-Versionen und Pakete selbst)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH=/home/pwuser/.local/bin:$PATH
# Paket-Caches: Der Runner hängt hier gemeinsame Volumes ein, damit nicht jeder Job alles neu lädt
RUN mkdir -p /home/pwuser/.cache/uv /home/pwuser/.npm

WORKDIR /work
ENTRYPOINT ["/factory/entrypoint.sh"]
