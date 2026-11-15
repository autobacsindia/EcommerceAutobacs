# Call relay (TURN) for one-to-one team-chat calls — coturn.
# Most calls connect browser-to-browser and never touch this; it carries a call
# only when a strict office/mobile network blocks the direct path.
# Railway: deploy this folder as its own service, add a TCP Proxy to port 3478,
# set TURN_SECRET (and optionally TURN_REALM). See README.md.
FROM coturn/coturn:4.6.3
USER root
COPY entrypoint.sh /entrypoint-calls.sh
RUN chmod 0755 /entrypoint-calls.sh
USER nobody
EXPOSE 3478/tcp
ENTRYPOINT ["/entrypoint-calls.sh"]
