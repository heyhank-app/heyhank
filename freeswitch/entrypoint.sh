#!/bin/bash
# Custom entrypoint for HeyHank FreeSWITCH
# Copies custom gateway configs into the right places, then starts FreeSWITCH.

set -e

CUSTOM_DIR="/etc/freeswitch/custom"
FS_CONF="/etc/freeswitch"

# Copy custom SIP gateway configs if they exist
if [ -d "$CUSTOM_DIR/sip_profiles/external" ]; then
  cp -v "$CUSTOM_DIR/sip_profiles/external/"*.xml "$FS_CONF/sip_profiles/external/" 2>/dev/null || true
fi

# Copy custom dialplan if it exists
if [ -d "$CUSTOM_DIR/dialplan/default" ]; then
  cp -v "$CUSTOM_DIR/dialplan/default/"*.xml "$FS_CONF/dialplan/default/" 2>/dev/null || true
fi

# Enable mod_audio_fork if available (for streaming audio to HeyHank)
# Note: mod_audio_fork may need to be compiled separately for some images
if [ -f "$FS_CONF/autoload_configs/modules.conf.xml" ]; then
  # Ensure ESL module is loaded (for HTTP API control)
  grep -q "mod_xml_rpc" "$FS_CONF/autoload_configs/modules.conf.xml" || \
    sed -i 's|</modules>|  <load module="mod_xml_rpc"/>\n</modules>|' "$FS_CONF/autoload_configs/modules.conf.xml"
fi

# Configure mod_xml_rpc for HTTP API access (ESL over HTTP)
cat > "$FS_CONF/autoload_configs/xml_rpc.conf.xml" << 'XMLRPC'
<configuration name="xml_rpc.conf" description="XML RPC">
  <settings>
    <param name="http-port" value="8021"/>
    <param name="auth-realm" value="freeswitch"/>
    <param name="auth-user" value="freeswitch"/>
    <param name="auth-pass" value="heyhank_esl_secret"/>
  </settings>
</configuration>
XMLRPC

echo "[HeyHank] FreeSWITCH config ready, starting..."

# Start FreeSWITCH in foreground
exec /usr/bin/freeswitch -nonat -nf
