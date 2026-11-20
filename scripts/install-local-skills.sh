#!/usr/bin/env bash
# Installiert die lokalen Factory-Skills (init, write-spec, to-factory) einmalig auf deinem Rechner.
# Sie gelten dann in allen Projekten. Updates: im Factory-Repo "git pull", fertig (es sind Verknüpfungen).
#   ./scripts/install-local-skills.sh                alle
#   ./scripts/install-local-skills.sh to-factory     nur diese (z. B. wenn dein Projekt eigene
#                                                    init/write-spec-Skills hat, wie Alice)
# Achtung: Persönliche Skills haben Vorrang vor gleichnamigen Projekt-Skills.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/local-skills"
DEST="$HOME/.claude/skills"
mkdir -p "$DEST"
if [ $# -gt 0 ]; then SKILLS=("$@"); else SKILLS=(); for s in "$SRC"/*/; do SKILLS+=("$(basename "$s")"); done; fi
for name in "${SKILLS[@]}"; do
  skill="$SRC/$name"
  [ -d "$skill" ] || { echo "  ✗ unbekannter Skill: $name"; exit 1; }
  if [ -e "$DEST/$name" ] && [ ! -L "$DEST/$name" ]; then
    mv "$DEST/$name" "$DEST/$name.backup-$(date +%Y%m%d%H%M%S)"
    echo "  vorhandenen Skill '$name' gesichert"
  fi
  ln -sfn "$skill" "$DEST/$name"
  echo "  ✓ /$name"
done
echo "Fertig. Die Skills stehen in jedem Projekt zur Verfügung (persönliche Skills haben Vorrang vor Projekt-Skills)."
