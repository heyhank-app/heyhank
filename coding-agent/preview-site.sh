#!/bin/bash
# =============================================================================
# Maxx Agent — Preview Site Manager
# Erstellt/entfernt passwortgeschuetzte Preview-Subdomains fuer Kundenprojekte
#
# Usage:
#   ./preview-site.sh create <name> [user] [pass]
#   ./preview-site.sh delete <name>
#   ./preview-site.sh list
#
# Beispiel:
#   ./preview-site.sh create stevenstaverne
#   → erstellt stevenstaverne.markusstoeger.com mit auto-generiertem Passwort
#
#   ./preview-site.sh create stevenstaverne kunde1 meinPasswort123
#   → erstellt mit eigenem User/Pass
# =============================================================================

set -euo pipefail

DOMAIN_BASE="markusstoeger.com"
WEBROOT_BASE="/var/www"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
HTPASSWD_DIR="/etc/nginx/htpasswd"
PREVIEW_LOG="/opt/agentplatform/coding-agent/preview-sites.json"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# Sicherstellen, dass Verzeichnisse existieren
mkdir -p "$HTPASSWD_DIR"
[ -f "$PREVIEW_LOG" ] || echo '[]' > "$PREVIEW_LOG"

# ─── CREATE ─────────────────────────────────────────────────────────────────

create_site() {
    local NAME="$1"
    local USER="${2:-kunde}"
    local PASS="${3:-$(openssl rand -base64 16 | tr -d '=/+' | head -c 16)}"

    local FQDN="${NAME}.${DOMAIN_BASE}"
    local WEBROOT="${WEBROOT_BASE}/${NAME}.${DOMAIN_BASE}"
    local NGINX_CONF="${NGINX_AVAILABLE}/${FQDN}"
    local HTPASSWD_FILE="${HTPASSWD_DIR}/${FQDN}"

    # Pruefen ob bereits existiert
    if [ -f "$NGINX_CONF" ]; then
        err "Site ${FQDN} existiert bereits!"
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Erstelle Preview-Site: ${FQDN}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 1. Webroot erstellen
    mkdir -p "${WEBROOT}"
    cat > "${WEBROOT}/index.html" <<'PLACEHOLDER'
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Projekt wird erstellt...</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #1a1a1a; color: #e0e0e0; font-family: system-ui, -apple-system, sans-serif; }
        .card { text-align: center; padding: 3rem 2rem; max-width: 480px; }
        h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #fff; }
        p { font-size: 0.95rem; line-height: 1.6; color: #999; }
        .spinner { width: 40px; height: 40px; margin: 0 auto 1.5rem; border: 3px solid #333; border-top-color: #d97757; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="card">
        <div class="spinner"></div>
        <h1>Projekt wird erstellt</h1>
        <p>Die Website wird gerade von unserem AI-Team aufgebaut. Bitte schauen Sie in Kuerze wieder vorbei.</p>
    </div>
</body>
</html>
PLACEHOLDER
    log "Webroot erstellt: ${WEBROOT}"

    # 2. HTTP Basic Auth erstellen
    htpasswd -cb "$HTPASSWD_FILE" "$USER" "$PASS" 2>/dev/null
    chmod 640 "$HTPASSWD_FILE"
    chown root:www-data "$HTPASSWD_FILE"
    log "Basic Auth erstellt: ${USER} / ${PASS}"

    # 3. Nginx Config erstellen
    cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name ${FQDN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${FQDN};

    ssl_certificate /etc/letsencrypt/live/${FQDN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${FQDN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    server_tokens off;

    # Basic Auth — Passwortschutz
    auth_basic "Preview — Nur mit Zugangsdaten";
    auth_basic_user_file ${HTPASSWD_FILE};

    root ${WEBROOT};
    index index.html;

    # Statische Dateien mit Caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # SPA Fallback (fuer React/Next.js/Vue)
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Block common attacks
    location ~ /\\.(git|env|htaccess|htpasswd) {
        deny all;
        return 404;
    }
}
NGINX
    log "Nginx Config erstellt"

    # 4. SSL Zertifikat holen (erst HTTP-only aktivieren fuer Challenge)
    # Temporaer ohne SSL starten fuer certbot
    cat > "${NGINX_CONF}.temp" <<TEMPNGINX
server {
    listen 80;
    server_name ${FQDN};
    root ${WEBROOT};
    location /.well-known/acme-challenge/ { allow all; }
    location / { return 503; }
}
TEMPNGINX

    ln -sf "${NGINX_CONF}.temp" "${NGINX_ENABLED}/${FQDN}"
    nginx -t 2>/dev/null && systemctl reload nginx

    certbot certonly --webroot -w "$WEBROOT" -d "$FQDN" --non-interactive --agree-tos --email info@markusstoeger.com 2>&1 | tail -3

    if [ ! -f "/etc/letsencrypt/live/${FQDN}/fullchain.pem" ]; then
        rm -f "${NGINX_ENABLED}/${FQDN}" "${NGINX_CONF}.temp"
        systemctl reload nginx
        err "SSL-Zertifikat konnte nicht erstellt werden! Ist der DNS-Eintrag fuer ${FQDN} gesetzt?"
    fi
    log "SSL Zertifikat erstellt"

    # 5. Richtige Config aktivieren
    rm -f "${NGINX_CONF}.temp"
    ln -sf "$NGINX_CONF" "${NGINX_ENABLED}/${FQDN}"
    nginx -t 2>/dev/null && systemctl reload nginx
    log "Nginx aktiviert und neu geladen"

    # 6. In Preview-Log speichern
    local TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local TEMP_FILE=$(mktemp)
    python3 -c "
import json, sys
with open('${PREVIEW_LOG}') as f: sites = json.load(f)
sites.append({
    'name': '${NAME}',
    'fqdn': '${FQDN}',
    'url': 'https://${FQDN}',
    'webroot': '${WEBROOT}',
    'user': '${USER}',
    'pass': '${PASS}',
    'created': '${TIMESTAMP}',
    'status': 'active'
})
with open('${PREVIEW_LOG}', 'w') as f: json.dump(sites, f, indent=2)
"
    log "In Preview-Log gespeichert"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Preview-Site erstellt!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  URL:        https://${FQDN}"
    echo "  Benutzer:   ${USER}"
    echo "  Passwort:   ${PASS}"
    echo "  Webroot:    ${WEBROOT}"
    echo ""
    echo "  Der Coding Agent deployed hierhin:"
    echo "  ${WEBROOT}/"
    echo ""
}

# ─── DELETE ─────────────────────────────────────────────────────────────────

delete_site() {
    local NAME="$1"
    local FQDN="${NAME}.${DOMAIN_BASE}"
    local WEBROOT="${WEBROOT_BASE}/${NAME}.${DOMAIN_BASE}"
    local NGINX_CONF="${NGINX_AVAILABLE}/${FQDN}"
    local HTPASSWD_FILE="${HTPASSWD_DIR}/${FQDN}"

    echo ""
    warn "Loesche Preview-Site: ${FQDN}"

    # Nginx deaktivieren
    rm -f "${NGINX_ENABLED}/${FQDN}" "${NGINX_ENABLED}/${FQDN}.temp"
    [ -f "$NGINX_CONF" ] && rm -f "$NGINX_CONF" "${NGINX_CONF}.temp"
    nginx -t 2>/dev/null && systemctl reload nginx
    log "Nginx Config entfernt"

    # Htpasswd entfernen
    [ -f "$HTPASSWD_FILE" ] && rm -f "$HTPASSWD_FILE"
    log "Basic Auth entfernt"

    # Webroot behalten (Sicherheit — nicht automatisch loeschen)
    if [ -d "$WEBROOT" ]; then
        warn "Webroot NICHT geloescht (Sicherheit): ${WEBROOT}"
        warn "Manuell loeschen mit: rm -rf ${WEBROOT}"
    fi

    # SSL Zertifikat entfernen
    certbot delete --cert-name "$FQDN" --non-interactive 2>/dev/null || true
    log "SSL Zertifikat entfernt"

    # Aus Preview-Log entfernen
    python3 -c "
import json
with open('${PREVIEW_LOG}') as f: sites = json.load(f)
sites = [s for s in sites if s.get('name') != '${NAME}']
with open('${PREVIEW_LOG}', 'w') as f: json.dump(sites, f, indent=2)
" 2>/dev/null || true

    echo ""
    log "Preview-Site ${FQDN} geloescht."
    echo ""
}

# ─── LIST ───────────────────────────────────────────────────────────────────

list_sites() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Aktive Preview-Sites"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [ ! -f "$PREVIEW_LOG" ] || [ "$(cat "$PREVIEW_LOG")" = "[]" ]; then
        echo "  Keine Preview-Sites vorhanden."
        echo ""
        return
    fi

    python3 -c "
import json
with open('${PREVIEW_LOG}') as f: sites = json.load(f)
for s in sites:
    print(f\"  {s['fqdn']}\")
    print(f\"    URL:      {s['url']}\")
    print(f\"    User:     {s['user']}\")
    print(f\"    Pass:     {s['pass']}\")
    print(f\"    Webroot:  {s['webroot']}\")
    print(f\"    Erstellt: {s['created']}\")
    print()
"
}

# ─── MAIN ───────────────────────────────────────────────────────────────────

case "${1:-}" in
    create)
        [ -z "${2:-}" ] && err "Usage: $0 create <name> [user] [pass]"
        create_site "$2" "${3:-}" "${4:-}"
        ;;
    delete)
        [ -z "${2:-}" ] && err "Usage: $0 delete <name>"
        delete_site "$2"
        ;;
    list)
        list_sites
        ;;
    *)
        echo "Usage: $0 {create|delete|list} [name] [user] [pass]"
        echo ""
        echo "Beispiele:"
        echo "  $0 create stevenstaverne              # Auto-generiertes Passwort"
        echo "  $0 create stevenstaverne kunde1 pass   # Eigenes User/Pass"
        echo "  $0 delete stevenstaverne               # Site entfernen"
        echo "  $0 list                                # Alle Sites anzeigen"
        exit 1
        ;;
esac
