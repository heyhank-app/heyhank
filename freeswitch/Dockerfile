# HeyHank FreeSWITCH — based on drachtio-freeswitch-mrf for mod_audio_fork support
# mod_audio_fork enables WebSocket audio streaming (FreeSWITCH ↔ Gemini Live bridge)
FROM drachtio/drachtio-freeswitch-mrf:latest

# FreeSWITCH paths in this image
ENV FS_DIR=/usr/local/freeswitch
ENV FS_CONF=$FS_DIR/conf
ENV FS_MOD=$FS_DIR/mod

# Copy our entrypoint
COPY entrypoint-drachtio.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh

ENTRYPOINT ["/bin/bash", "/docker-entrypoint-custom.sh"]
