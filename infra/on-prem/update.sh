#!/usr/bin/env bash
# =============================================================================
# Vantage AI — On-Prem Update Script
#
# Safe, automated updates for self-hosted deployments.
# Performs: pre-flight checks → backup → pull → build → migrate → restart →
#           health check → rollback on failure.
#
# Usage:
#   bash update.sh              # update to latest
#   bash update.sh --dry-run    # show what would happen without changing anything
#   bash update.sh --rollback   # revert to the previous version
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
BACKUP_DIR="${SCRIPT_DIR}/backups"
VERSION_FILE="${PROJECT_ROOT}/VERSION"
CHANGELOG_FILE="${PROJECT_ROOT}/CHANGELOG.md"

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
DRY_RUN=false
ROLLBACK=false

for arg in "$@"; do
    case "$arg" in
        --dry-run)   DRY_RUN=true ;;
        --rollback)  ROLLBACK=true ;;
        --help|-h)
            echo "Usage: bash update.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dry-run     Show what would happen without making changes"
            echo "  --rollback    Revert to the previous version"
            echo "  -h, --help    Show this help"
            exit 0
            ;;
        *) echo -e "${RED}Unknown option: $arg${NC}"; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║           Vantage AI — Update Manager                   ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
current_version() {
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE" | tr -d '[:space:]'
    else
        echo "unknown"
    fi
}

timestamp() {
    date +%Y%m%d_%H%M%S
}

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
if [ "$ROLLBACK" = true ]; then
    echo -e "${BOLD}Rolling back to previous version...${NC}"

    PREV_COMMIT=$(git -C "$PROJECT_ROOT" log --oneline -2 | tail -1 | awk '{print $1}')
    if [ -z "$PREV_COMMIT" ]; then
        echo -e "${RED}✗ Cannot determine previous commit${NC}"
        exit 1
    fi

    echo -e "  Previous commit: ${BOLD}${PREV_COMMIT}${NC}"
    git -C "$PROJECT_ROOT" checkout "$PREV_COMMIT" -- .

    echo -e "  Rebuilding containers..."
    docker compose -f "$COMPOSE_FILE" build --parallel --quiet
    docker compose -f "$COMPOSE_FILE" up -d

    echo -e "${GREEN}✓ Rolled back to ${PREV_COMMIT}${NC}"
    echo -e "  Version: $(current_version)"
    exit 0
fi

# ---------------------------------------------------------------------------
# 1. Pre-flight checks
# ---------------------------------------------------------------------------
echo -e "${BOLD}[1/7] Pre-flight checks...${NC}"

CURRENT=$(current_version)
echo -e "  ${GREEN}✓${NC} Current version: ${BOLD}${CURRENT}${NC}"

# Check we're in a git repo
if ! git -C "$PROJECT_ROOT" rev-parse --git-dir &> /dev/null; then
    echo -e "  ${RED}✗ Not a git repository — cannot pull updates${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Git repository detected"

# Check for uncommitted changes
if ! git -C "$PROJECT_ROOT" diff --quiet 2>/dev/null; then
    echo -e "  ${YELLOW}⚠${NC}  Uncommitted local changes detected"
    echo -e "     These will be stashed before updating."
    STASHED=true
else
    STASHED=false
    echo -e "  ${GREEN}✓${NC} Working directory clean"
fi

# Check Docker is running
if ! docker info &> /dev/null; then
    echo -e "  ${RED}✗ Docker daemon is not running${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker daemon is running"

# Check services are running
RUNNING=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | grep -c '"running"' || true)
echo -e "  ${GREEN}✓${NC} ${RUNNING} service(s) currently running"

# ---------------------------------------------------------------------------
# 2. Check for updates
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[2/7] Checking for updates...${NC}"

git -C "$PROJECT_ROOT" fetch origin main --quiet 2>&1

LOCAL_HEAD=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
REMOTE_HEAD=$(git -C "$PROJECT_ROOT" rev-parse origin/main)

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
    echo -e "  ${GREEN}✓${NC} Already up to date (${CURRENT})"
    echo -e "\n${GREEN}No update needed.${NC}"
    exit 0
fi

COMMITS_BEHIND=$(git -C "$PROJECT_ROOT" rev-list HEAD..origin/main --count)
echo -e "  ${YELLOW}⬆${NC}  ${BOLD}${COMMITS_BEHIND} new commit(s)${NC} available"

# Show what's new
echo -e "\n  ${BLUE}Recent changes:${NC}"
git -C "$PROJECT_ROOT" log --oneline HEAD..origin/main | head -10 | while IFS= read -r line; do
    echo -e "    ${BLUE}•${NC} $line"
done

if [ "$DRY_RUN" = true ]; then
    echo -e "\n${YELLOW}Dry run — no changes made.${NC}"
    echo -e "Run ${BOLD}bash update.sh${NC} to apply the update."
    exit 0
fi

# ---------------------------------------------------------------------------
# 3. Backup database
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[3/7] Backing up database...${NC}"

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/vantage_backup_$(timestamp).sql"

# Source .env for DB credentials
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if docker compose -f "$COMPOSE_FILE" exec -T vantage-db \
    pg_dump -U "${POSTGRES_SYS_ADMIN_USER:-postgres}" "${POSTGRES_DB:-vantage_admin}" > "$BACKUP_FILE" 2>/dev/null; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "  ${GREEN}✓${NC} Database backed up (${BACKUP_SIZE}) → ${BACKUP_FILE}"
else
    echo -e "  ${YELLOW}⚠${NC}  Database backup failed (DB may not be running). Continuing..."
    BACKUP_FILE=""
fi

# ---------------------------------------------------------------------------
# 4. Stash local changes and pull
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[4/7] Pulling latest code...${NC}"

ROLLBACK_COMMIT="$LOCAL_HEAD"

if [ "$STASHED" = true ]; then
    git -C "$PROJECT_ROOT" stash --quiet
    echo -e "  ${GREEN}✓${NC} Local changes stashed"
fi

git -C "$PROJECT_ROOT" pull origin main --quiet 2>&1

NEW_VERSION=$(current_version)
echo -e "  ${GREEN}✓${NC} Updated: ${CURRENT} → ${BOLD}${NEW_VERSION}${NC}"

# ---------------------------------------------------------------------------
# 5. Rebuild containers
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[5/7] Rebuilding container images...${NC}"

docker compose -f "$COMPOSE_FILE" build --parallel 2>&1 | while IFS= read -r line; do
    echo -e "  ${BLUE}│${NC} $line"
done

echo -e "  ${GREEN}✓${NC} Images rebuilt"

# ---------------------------------------------------------------------------
# 6. Restart services (rolling)
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[6/7] Restarting services...${NC}"

docker compose -f "$COMPOSE_FILE" up -d 2>&1 | while IFS= read -r line; do
    echo -e "  ${BLUE}│${NC} $line"
done

# ---------------------------------------------------------------------------
# 7. Health check
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[7/7] Verifying health...${NC}"

MAX_WAIT=120
WAITED=0
INTERVAL=5
HEALTHY=false

while [ $WAITED -lt $MAX_WAIT ]; do
    UNHEALTHY=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
        | grep -c '"unhealthy"\|"starting"' || true)

    if [ "$UNHEALTHY" -eq 0 ]; then
        HEALTHY=true
        break
    fi

    echo -e "  ${YELLOW}⏳${NC} Waiting for services... (${WAITED}s / ${MAX_WAIT}s)"
    sleep $INTERVAL
    WAITED=$((WAITED + INTERVAL))
done

echo ""

if [ "$HEALTHY" = true ]; then
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                                          ║${NC}"
    echo -e "${CYAN}║  ${GREEN}✓ Update complete!${CYAN}                                     ║${NC}"
    echo -e "${CYAN}║                                                          ║${NC}"
    echo -e "${CYAN}║  Version: ${BOLD}${NEW_VERSION}${NC}${CYAN}                                          ║${NC}"
    echo -e "${CYAN}║  All services are healthy.                               ║${NC}"
    echo -e "${CYAN}║                                                          ║${NC}"
    echo -e "${CYAN}║  View changelog:                                         ║${NC}"
    echo -e "${CYAN}║    ${BOLD}cat ${CHANGELOG_FILE}${NC}${CYAN}                      ║${NC}"
    echo -e "${CYAN}║                                                          ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                          ║${NC}"
    echo -e "${RED}║  ✗ Health check failed — rolling back!                   ║${NC}"
    echo -e "${RED}║                                                          ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"

    echo -e "\n${YELLOW}Reverting to previous version (${ROLLBACK_COMMIT})...${NC}"
    git -C "$PROJECT_ROOT" checkout "$ROLLBACK_COMMIT" -- .
    docker compose -f "$COMPOSE_FILE" build --parallel --quiet
    docker compose -f "$COMPOSE_FILE" up -d

    if [ -n "${BACKUP_FILE:-}" ] && [ -f "$BACKUP_FILE" ]; then
        echo -e "  Restoring database from backup..."
        docker compose -f "$COMPOSE_FILE" exec -T vantage-db \
            psql -U "${POSTGRES_SYS_ADMIN_USER:-postgres}" "${POSTGRES_DB:-vantage_admin}" < "$BACKUP_FILE" 2>/dev/null || true
    fi

    echo -e "\n${RED}Update failed. System has been rolled back to $(current_version).${NC}"
    echo -e "Check logs: ${BOLD}docker compose -f docker-compose.prod.yml logs${NC}"
    exit 1
fi

# Restore stashed changes
if [ "$STASHED" = true ]; then
    git -C "$PROJECT_ROOT" stash pop --quiet 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Local changes restored"
fi

# Clean up old backups (keep last 10)
if [ -d "$BACKUP_DIR" ]; then
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.sql 2>/dev/null | wc -l)
    if [ "$BACKUP_COUNT" -gt 10 ]; then
        ls -1t "$BACKUP_DIR"/*.sql | tail -n +11 | xargs rm -f
        echo -e "  ${GREEN}✓${NC} Cleaned old backups (kept last 10)"
    fi
fi
