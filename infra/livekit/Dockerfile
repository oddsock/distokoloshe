FROM livekit/livekit-server:v1.9.12
COPY livekit.yaml /etc/livekit.yaml.tmpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 7880 3478/udp 5349 50201-50400/udp
ENTRYPOINT ["/entrypoint.sh"]
