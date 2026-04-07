#!/bin/sh
# Custom entrypoint for HeyHank FreeSWITCH (Alpine — no bash!)
# Copies custom gateway configs into the right places, then starts FreeSWITCH.

set -e

CUSTOM_DIR="/etc/freeswitch/custom"
FS_CONF="/etc/freeswitch"

# ── Initialize vanilla config if missing (safarov image) ──
if [ ! -f "$FS_CONF/freeswitch.xml" ]; then
  echo "[HeyHank] First boot — initializing FreeSWITCH config..."
  if [ -d /usr/share/freeswitch/conf/vanilla ]; then
    cp -a /usr/share/freeswitch/conf/vanilla/* "$FS_CONF/"
  fi
fi

# Ensure external SIP profile directory exists
mkdir -p "$FS_CONF/sip_profiles/external"

# Copy custom SIP gateway configs if they exist
if [ -d "$CUSTOM_DIR/sip_profiles/external" ]; then
  cp -v "$CUSTOM_DIR/sip_profiles/external/"*.xml "$FS_CONF/sip_profiles/external/" 2>/dev/null || true
fi

# Copy custom dialplan if it exists
if [ -d "$CUSTOM_DIR/dialplan/default" ]; then
  cp -v "$CUSTOM_DIR/dialplan/default/"*.xml "$FS_CONF/dialplan/default/" 2>/dev/null || true
fi

# ── Configure ESL (mod_event_socket) ──
ESL_PW="${HEYHANK_ESL_PASSWORD:-heyhank_esl_secret}"
cat > "$FS_CONF/autoload_configs/event_socket.conf.xml" << EOF
<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <param name="listen-ip" value="127.0.0.1"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="$ESL_PW"/>
  </settings>
</configuration>
EOF

# ── Enable SIP TLS for external profile ──
if [ -f "$FS_CONF/sip_profiles/external.xml" ]; then
  # Set external_ssl_enable=true if not already set
  if grep -q 'external_ssl_enable' "$FS_CONF/sip_profiles/external.xml"; then
    sed -i 's/external_ssl_enable=false/external_ssl_enable=true/' "$FS_CONF/sip_profiles/external.xml"
  fi
fi

echo "[HeyHank] FreeSWITCH config ready, starting..."

# Start FreeSWITCH in foreground
exec /usr/bin/freeswitch -nonat -nf
