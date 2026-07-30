#!/usr/bin/env bash
# =============================================================================
# Vantage AI — On-Prem Setup Script
#
# One-command bootstrap for self-hosted production deployments.
#
# Usage:
#   bash setup.sh              # full setup
#   bash setup.sh --no-start   # configure only, don't start services
#   bash setup.sh --monitoring # include Prometheus + Grafana
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
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
ENV_TEMPLATE="${SCRIPT_DIR}/.env.template"

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
NO_START=false
MONITORING=false

for arg in "$@"; do
    case "$arg" in
        --no-start)   NO_START=true ;;
        --monitoring) MONITORING=true ;;
        --help|-h)
            echo "Usage: bash setup.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --no-start     Configure only, don't start services"
            echo "  --monitoring   Include Prometheus + Grafana stack"
            echo "  -h, --help     Show this help"
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
echo "  ║                                                          ║"
echo "  ║   ██╗   ██╗ █████╗ ███╗   ██╗████████╗ █████╗  ██████╗  ║"
echo "  ║   ██║   ██║██╔══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔════╝  ║"
echo "  ║   ██║   ██║███████║██╔██╗ ██║   ██║   ███████║██║  ███╗ ║"
echo "  ║   ╚██╗ ██╔╝██╔══██║██║╚██╗██║   ██║   ██╔══██║██║   ██║ ║"
echo "  ║    ╚████╔╝ ██║  ██║██║ ╚████║   ██║   ██║  ██║╚██████╔╝ ║"
echo "  ║     ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ║"
echo "  ║                                                          ║"
echo "  ║              On-Prem Production Setup                    ║"
echo "  ║                                                          ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
echo -e "${BOLD}[1/6] Checking prerequisites...${NC}"

check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "  ${RED}✗ $1 not found${NC}"
        echo -e "    Install it: $2"
        return 1
    fi
    local version
    version=$($3 2>&1 | head -1)
    echo -e "  ${GREEN}✓${NC} $1 — ${version}"
}

MISSING=0
check_cmd "docker" "https://docs.docker.com/engine/install/" "docker --version" || MISSING=1
check_cmd "docker" "https://docs.docker.com/compose/install/" "docker compose version" || MISSING=1

if [ "$MISSING" -eq 1 ]; then
    echo -e "\n${RED}Missing prerequisites. Install them and re-run this script.${NC}"
    exit 1
fi

# Check Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "  ${RED}✗ Docker daemon is not running${NC}"
    echo -e "    Start it with: sudo systemctl start docker"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker daemon is running"

# ---------------------------------------------------------------------------
# 2. Environment file
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[2/6] Setting up environment...${NC}"

if [ -f "$ENV_FILE" ]; then
    echo -e "  ${GREEN}✓${NC} .env already exists — skipping copy"
    echo -e "  ${YELLOW}⚠${NC}  Review your .env to make sure all REQUIRED values are set"
else
    if [ ! -f "$ENV_TEMPLATE" ]; then
        echo -e "  ${RED}✗ .env.template not found at ${ENV_TEMPLATE}${NC}"
        exit 1
    fi
    cp "$ENV_TEMPLATE" "$ENV_FILE"
    echo -e "  ${GREEN}✓${NC} Copied .env.template → .env"
    echo ""
    echo -e "  ${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${YELLOW}║  ACTION REQUIRED: Edit .env and fill in your secrets    ║${NC}"
    echo -e "  ${YELLOW}║                                                          ║${NC}"
    echo -e "  ${YELLOW}║    nano ${ENV_FILE}                                      ║${NC}"
    echo -e "  ${YELLOW}║                                                          ║${NC}"
    echo -e "  ${YELLOW}║  At minimum, set:                                        ║${NC}"
    echo -e "  ${YELLOW}║    • DOMAIN_NAME                                         ║${NC}"
    echo -e "  ${YELLOW}║    • LLM_API_KEY                                         ║${NC}"
    echo -e "  ${YELLOW}║    • POSTGRES_SYS_ADMIN_PASSWORD                         ║${NC}"
    echo -e "  ${YELLOW}║    • JWT_SECRET                                          ║${NC}"
    echo -e "  ${YELLOW}║    • ENCRYPTION_KEY                                      ║${NC}"
    echo -e "  ${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Then re-run: ${BOLD}bash setup.sh${NC}"
    exit 0
fi

# ---------------------------------------------------------------------------
# 3. Validate required env vars
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[3/6] Validating configuration...${NC}"

# Source the .env (safely — only for validation)
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

VALID=true
check_env() {
    local var_name="$1"
    local var_value="${!var_name:-}"
    if [ -z "$var_value" ]; then
        echo -e "  ${RED}✗ ${var_name} is empty${NC}"
        VALID=false
    else
        # Mask secrets
        if [[ "$var_name" == *KEY* ]] || [[ "$var_name" == *SECRET* ]] || [[ "$var_name" == *PASSWORD* ]]; then
            echo -e "  ${GREEN}✓${NC} ${var_name} = ****${var_value: -4}"
        else
            echo -e "  ${GREEN}✓${NC} ${var_name} = ${var_value}"
        fi
    fi
}

check_env "DOMAIN_NAME"
check_env "LLM_PROVIDER"
check_env "POSTGRES_SYS_ADMIN_PASSWORD"
check_env "JWT_SECRET"
check_env "ENCRYPTION_KEY"

# Provider-specific key check
case "${LLM_PROVIDER:-openai}" in
    openai|azure_openai|anthropic)
        check_env "LLM_API_KEY" ;;
    google)
        check_env "GOOGLE_API_KEY" ;;
    huggingface)
        check_env "HF_TOKEN" ;;
esac

if [ "$VALID" = false ]; then
    echo -e "\n${RED}Missing required configuration. Edit .env and re-run.${NC}"
    exit 1
fi

# ---------------------------------------------------------------------------
# 4. Build images
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[4/6] Building container images...${NC}"

COMPOSE_CMD="docker compose -f ${COMPOSE_FILE}"

if [ "$MONITORING" = true ]; then
    COMPOSE_CMD="${COMPOSE_CMD} --profile monitoring"
fi

$COMPOSE_CMD build --parallel 2>&1 | while IFS= read -r line; do
    echo -e "  ${BLUE}│${NC} $line"
done

echo -e "  ${GREEN}✓${NC} Images built successfully"

# ---------------------------------------------------------------------------
# 5. Start services
# ---------------------------------------------------------------------------
if [ "$NO_START" = true ]; then
    echo -e "\n${BOLD}[5/6] Skipping service start (--no-start)${NC}"
    echo -e "\n${GREEN}Setup complete!${NC} Start services with:"
    echo -e "  ${BOLD}${COMPOSE_CMD} up -d${NC}"
    exit 0
fi

echo -e "\n${BOLD}[5/6] Starting services...${NC}"

$COMPOSE_CMD up -d 2>&1 | while IFS= read -r line; do
    echo -e "  ${BLUE}│${NC} $line"
done

# ---------------------------------------------------------------------------
# 6. Health check
# ---------------------------------------------------------------------------
echo -e "\n${BOLD}[6/6] Waiting for services to become healthy...${NC}"

MAX_WAIT=120
WAITED=0
INTERVAL=5

while [ $WAITED -lt $MAX_WAIT ]; do
    UNHEALTHY=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
        | grep -c '"unhealthy"\|"starting"' || true)

    if [ "$UNHEALTHY" -eq 0 ]; then
        break
    fi

    echo -e "  ${YELLOW}⏳${NC} Waiting for services... (${WAITED}s / ${MAX_WAIT}s)"
    sleep $INTERVAL
    WAITED=$((WAITED + INTERVAL))
done

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                          ║${NC}"

if [ $WAITED -lt $MAX_WAIT ]; then
    echo -e "${CYAN}║  ${GREEN}✓ All services are healthy!${CYAN}                              ║${NC}"
else
    echo -e "${CYAN}║  ${YELLOW}⚠ Some services may still be starting${CYAN}                   ║${NC}"
fi

echo -e "${CYAN}║                                                          ║${NC}"
echo -e "${CYAN}║  Access Vantage AI:                                      ║${NC}"
echo -e "${CYAN}║    ${BOLD}https://${DOMAIN_NAME:-your-domain.com}${NC}${CYAN}                        ║${NC}"
echo -e "${CYAN}║                                                          ║${NC}"

if [ "$MONITORING" = true ]; then
    echo -e "${CYAN}║  Grafana dashboard:                                      ║${NC}"
    echo -e "${CYAN}║    ${BOLD}https://${DOMAIN_NAME:-your-domain.com}/grafana${NC}${CYAN}             ║${NC}"
    echo -e "${CYAN}║                                                          ║${NC}"
fi

echo -e "${CYAN}║  Useful commands:                                        ║${NC}"
echo -e "${CYAN}║    docker compose -f docker-compose.prod.yml ps          ║${NC}"
echo -e "${CYAN}║    docker compose -f docker-compose.prod.yml logs -f     ║${NC}"
echo -e "${CYAN}║    docker compose -f docker-compose.prod.yml down        ║${NC}"
echo -e "${CYAN}║                                                          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
