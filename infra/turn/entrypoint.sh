#!/bin/sh
# Writes coturn's config at start so the shared secret comes from the
# environment only (never baked into the image or committed).
set -eu

: "${TURN_SECRET:?TURN_SECRET must be set (same value as the backend's CALL_TURN_SECRET)}"
REALM="${TURN_REALM:-autobacsindia.com}"
PORT="${TURN_PORT:-3478}"
# This container's own address. When both people in a call are relayed, both
# are allocated on THIS server, so it must relay to itself; every other private
# range stays denied below so the relay cannot be used to reach internal services.
SELF_IP="$(hostname -i 2>/dev/null | awk '{print $1}')"

CONF=/tmp/turnserver.conf
cat > "$CONF" <<CONF
listening-port=${PORT}
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${REALM}
# Railway has no inbound UDP: browsers reach the relay over TCP via the TCP proxy.
no-udp
no-tls
no-dtls
no-cli
no-multicast-peers
no-loopback-peers
stale-nonce=600
# Abuse limits: one call is roughly 1-2.5 Mbps each way.
user-quota=12
total-quota=200
max-bps=3000000
# Never relay into private, link-local or metadata ranges (SSRF guard)...
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
CONF
# ...except ourselves (relay-to-relay between the two callers).
if [ -n "$SELF_IP" ]; then echo "allowed-peer-ip=${SELF_IP}" >> "$CONF"; fi

exec turnserver -c "$CONF"
