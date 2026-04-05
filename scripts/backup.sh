#!/bin/bash
# ─── Agent Platform Backup ───────────────────────────────────────────────────
# Backs up all platform data: configs, agents, context, costs, messages
# Run daily via cron or manually

set -euo pipefail

BACKUP_DIR="/opt/agentplatform/backups"
COMPANION_HOME="${HOME}/.companion"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/agentplatform_${TIMESTAMP}.tar.gz"
MAX_BACKUPS=14  # Keep 2 weeks of daily backups

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[backup] Starting backup at $(date -Iseconds)"

# Create tar archive of all important data
tar -czf "$BACKUP_FILE" \
  --exclude='*.log' \
  --exclude='recordings' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  -C / \
  "${COMPANION_HOME#/}/agents" \
  "${COMPANION_HOME#/}/shared-context" \
  "${COMPANION_HOME#/}/auth.json" \
  "${COMPANION_HOME#/}/costs.db" \
  "${COMPANION_HOME#/}/messages.jsonl" \
  "${COMPANION_HOME#/}/vapid-keys.json" \
  "${COMPANION_HOME#/}/push-subscriptions.json" \
  "opt/agentplatform/ecosystem.config.cjs" \
  "etc/nginx/sites-available/agent.markusstoeger.com" \
  2>/dev/null || true

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] Created: $BACKUP_FILE ($BACKUP_SIZE)"

# Rotate old backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/agentplatform_*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  REMOVE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  ls -1t "$BACKUP_DIR"/agentplatform_*.tar.gz | tail -n "$REMOVE_COUNT" | xargs rm -f
  echo "[backup] Rotated: removed $REMOVE_COUNT old backup(s)"
fi

echo "[backup] Done. Total backups: $(ls -1 "$BACKUP_DIR"/agentplatform_*.tar.gz 2>/dev/null | wc -l)"
