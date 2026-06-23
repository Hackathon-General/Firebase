#!/usr/bin/env bash
# ============================================================================
# One-shot GCP deploy for the Carmel-Kinneret HTTP relay (free e2-micro).
# Creates: static IP + firewall (TCP 80) + e2-micro VM that auto-installs Node,
# writes relay.js, and runs it on port 80 via systemd (survives reboots).
#
# USAGE:
#   1) gcloud auth login   &&   gcloud config set project carmel-kinneret
#   2) edit IOT_SECRET below
#   3) bash gcp-deploy.sh
#   4) it prints the PUBLIC URL → give it to the sensor team.
# ============================================================================
set -euo pipefail

# ---- EDIT THIS ----
IOT_SECRET="ae8d995a2d097e75d27c550c76d0865d7d3ce762be388add02b73b130003b574"
# -------------------
PROJECT="$(gcloud config get-value project 2>/dev/null)"
REGION="us-central1"          # free-tier region (us-west1 / us-central1 / us-east1)
ZONE="us-central1-a"
NAME="ck-relay"
INGEST_URL="https://ingest-ossscobabq-ew.a.run.app"

echo "Project: $PROJECT   Zone: $ZONE"

# 1) Reserve a STATIC external IP (free while attached) so the sensor URL never changes.
gcloud compute addresses create "${NAME}-ip" --region="$REGION" 2>/dev/null || true
STATIC_IP="$(gcloud compute addresses describe "${NAME}-ip" --region="$REGION" --format='get(address)')"
echo "Static IP: $STATIC_IP"

# 2) Firewall: allow inbound TCP 80 from anywhere to instances tagged http-server.
gcloud compute firewall-rules create "${NAME}-allow-http" \
  --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server 2>/dev/null || true

# 3) Startup script — installs Node, writes relay.js, runs it on :80 via systemd.
STARTUP="$(cat <<STARTUP_EOF
#!/bin/bash
set -e
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
mkdir -p /opt/ck-relay
cat > /opt/ck-relay/relay.js <<'RELAY_EOF'
$(cat "$(dirname "$0")/relay.js")
RELAY_EOF
cat > /etc/systemd/system/ck-relay.service <<UNIT_EOF
[Unit]
Description=Carmel-Kinneret IoT HTTP relay
After=network-online.target
[Service]
Environment=PORT=80
Environment=IOT_SECRET=${IOT_SECRET}
Environment=INGEST_URL=${INGEST_URL}
ExecStart=/usr/bin/node /opt/ck-relay/relay.js
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
User=root
[Install]
WantedBy=multi-user.target
UNIT_EOF
systemctl daemon-reload
systemctl enable --now ck-relay
STARTUP_EOF
)"

# 4) Create the e2-micro VM (free tier) with the static IP + startup script.
gcloud compute instances create "$NAME" \
  --zone="$ZONE" \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --tags=http-server \
  --address="$STATIC_IP" \
  --metadata=startup-script="$STARTUP"

echo ""
echo "============================================================"
echo " Relay deploying. Give the sensor team this URL (~2 min to boot):"
echo ""
echo "     http://${STATIC_IP}/"
echo ""
echo " Verify once it's up:"
echo "   curl -X POST http://${STATIC_IP}/ -H 'Content-Type: application/json' \\"
echo "     -d '{\"id\":\"probe\",\"lat\":32.72,\"lon\":35.27,\"speed_kmh\":5}'"
echo "   # → {\"ok\":true}  and a pin appears on the admin God-Mode map"
echo "============================================================"
