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

# ── CRITICAL: Remove video codecs from SIP INVITE ──
# peoplefone/carriers reject calls with video codecs (H264, VP8) in SDP.
# Override global codec prefs to audio-only.
if [ -f "$FS_CONF/vars.xml" ]; then
  echo "[HeyHank] Removing video codecs from global codec prefs..."
  sed -i 's/global_codec_prefs=OPUS,G722,PCMU,PCMA,H264,VP8/global_codec_prefs=PCMU,PCMA,G722/' "$FS_CONF/vars.xml"
  sed -i 's/outbound_codec_prefs=OPUS,G722,PCMU,PCMA,H264,VP8/outbound_codec_prefs=PCMU,PCMA,G722/' "$FS_CONF/vars.xml"
fi

# Also force audio-only codec prefs directly in external SIP profile
if [ -f "$FS_CONF/sip_profiles/external.xml" ]; then
  sed -i 's|<param name="inbound-codec-prefs" value="$${global_codec_prefs}"/>|<param name="inbound-codec-prefs" value="PCMU,PCMA,G722"/>|' "$FS_CONF/sip_profiles/external.xml"
  sed -i 's|<param name="outbound-codec-prefs" value="$${outbound_codec_prefs}"/>|<param name="outbound-codec-prefs" value="PCMU,PCMA,G722"/>|' "$FS_CONF/sip_profiles/external.xml"
fi

# ── Copy custom dialplan for incoming calls (public context) ──
mkdir -p "$FS_CONF/dialplan/public"
if [ -d "$CUSTOM_DIR/dialplan/public" ]; then
  cp -v "$CUSTOM_DIR/dialplan/public/"*.xml "$FS_CONF/dialplan/public/" 2>/dev/null || true
fi

echo "[HeyHank] FreeSWITCH config ready, starting..."

# Start FreeSWITCH in foreground
exec /usr/bin/freeswitch -nonat -nf
