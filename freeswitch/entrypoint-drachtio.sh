#!/bin/bash
# HeyHank FreeSWITCH entrypoint (drachtio-freeswitch-mrf image)
# Configures ESL, SIP profiles, codecs (no video!), and mod_audio_fork.

set -e

FS_DIR="/usr/local/freeswitch"
FS_CONF="$FS_DIR/conf"
CUSTOM_DIR="/etc/freeswitch/custom"

echo "[HeyHank] Configuring FreeSWITCH (drachtio-mrf image)..."

# ── Remove video codecs from vars.xml ──
# Carriers (peoplefone) reject calls with video codecs in SIP INVITE
if [ -f "$FS_CONF/vars.xml" ]; then
  echo "[HeyHank] Removing video codecs from global codec prefs..."
  sed -i 's/global_codec_prefs=.*"/global_codec_prefs=PCMU,PCMA,G722,OPUS"/' "$FS_CONF/vars.xml"
  sed -i 's/outbound_codec_prefs=.*"/outbound_codec_prefs=PCMU,PCMA,G722,OPUS"/' "$FS_CONF/vars.xml"
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

# ── Create external SIP profile for gateway registration ──
# The drachtio image only has a "mrf" profile — we need "external" for SIP trunks
mkdir -p "$FS_CONF/sip_profiles/external"

cat > "$FS_CONF/sip_profiles/external.xml" << 'EOF'
<profile name="external">
  <gateways>
    <X-PRE-PROCESS cmd="include" data="external/*.xml"/>
  </gateways>
  <domains>
    <domain name="all" alias="false" parse="true"/>
  </domains>
  <settings>
    <param name="debug" value="0"/>
    <param name="sip-trace" value="no"/>
    <param name="rfc2833-pt" value="101"/>
    <param name="sip-port" value="5060"/>
    <param name="dialplan" value="XML"/>
    <param name="context" value="public"/>
    <param name="dtmf-duration" value="2000"/>
    <!-- Audio-only codec prefs — NO video codecs -->
    <param name="inbound-codec-prefs" value="PCMU,PCMA,G722"/>
    <param name="outbound-codec-prefs" value="PCMU,PCMA,G722"/>
    <param name="hold-music" value="$${hold_music}"/>
    <param name="rtp-timer-name" value="soft"/>
    <param name="local-network-acl" value="localnet.auto"/>
    <param name="manage-presence" value="false"/>
    <param name="inbound-codec-negotiation" value="generous"/>
    <param name="nonce-ttl" value="60"/>
    <param name="auth-calls" value="false"/>
    <param name="inbound-late-negotiation" value="true"/>
    <param name="rtp-ip" value="$${local_ip_v4}"/>
    <param name="sip-ip" value="$${local_ip_v4}"/>
    <param name="ext-rtp-ip" value="$${external_rtp_ip}"/>
    <param name="ext-sip-ip" value="$${external_sip_ip}"/>
    <param name="rtp-timeout-sec" value="300"/>
    <param name="rtp-hold-timeout-sec" value="1800"/>
    <!-- TLS for peoplefone etc. -->
    <param name="tls" value="true"/>
    <param name="tls-only" value="false"/>
    <param name="tls-bind-params" value="transport=tls"/>
    <param name="tls-sip-port" value="5081"/>
  </settings>
</profile>
EOF

# ── Copy custom SIP gateway configs ──
if [ -d "$CUSTOM_DIR/sip_profiles/external" ]; then
  echo "[HeyHank] Copying custom gateway configs..."
  cp -v "$CUSTOM_DIR/sip_profiles/external/"*.xml "$FS_CONF/sip_profiles/external/" 2>/dev/null || true
fi

# ── Copy custom dialplan ──
mkdir -p "$FS_CONF/dialplan/default"
mkdir -p "$FS_CONF/dialplan/public"

if [ -d "$CUSTOM_DIR/dialplan/default" ]; then
  echo "[HeyHank] Copying custom default dialplan..."
  cp -v "$CUSTOM_DIR/dialplan/default/"*.xml "$FS_CONF/dialplan/default/" 2>/dev/null || true
fi

if [ -d "$CUSTOM_DIR/dialplan/public" ]; then
  echo "[HeyHank] Copying custom public dialplan..."
  cp -v "$CUSTOM_DIR/dialplan/public/"*.xml "$FS_CONF/dialplan/public/" 2>/dev/null || true
fi

# ── Ensure mod_audio_fork is loaded ──
MODULES_CONF="$FS_CONF/autoload_configs/modules.conf.xml"
if [ -f "$MODULES_CONF" ]; then
  if ! grep -q "mod_audio_fork" "$MODULES_CONF"; then
    echo "[HeyHank] Adding mod_audio_fork to modules.conf.xml..."
    sed -i '/<\/modules>/i\    <load module="mod_audio_fork"/>' "$MODULES_CONF"
  fi
fi

# ── Ensure essential modules are loaded ──
for mod in mod_sofia mod_dptools mod_commands mod_dialplan_xml mod_event_socket mod_loopback; do
  if [ -f "$MODULES_CONF" ] && ! grep -q "$mod" "$MODULES_CONF"; then
    echo "[HeyHank] Adding $mod to modules.conf.xml..."
    sed -i "/<\/modules>/i\\    <load module=\"$mod\"/>" "$MODULES_CONF"
  fi
done

echo "[HeyHank] FreeSWITCH config ready, starting..."

# Start FreeSWITCH in foreground
exec $FS_DIR/bin/freeswitch -nonat -nf -c
