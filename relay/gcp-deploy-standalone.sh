#!/usr/bin/env bash
# ============================================================================
# SELF-CONTAINED one-shot GCP deploy for the Carmel-Kinneret HTTP relay.
# relay.js is embedded below — this is the ONLY file you need.
#
# Creates: static IP + firewall (TCP 80) + free e2-micro VM that auto-installs
# Node, writes relay.js, and runs it on port 80 via systemd (survives reboot).
#
# RUN (in GCP Cloud Shell):
#   1) gcloud config set project carmel-kinneret
#   2) (optional) edit IOT_SECRET / REGION / ZONE below
#   3) bash gcp-deploy-standalone.sh
#   4) it prints the PUBLIC URL → give http://<IP>/ to the sensor team.
# ============================================================================
set -euo pipefail

# ---- EDIT IF NEEDED ----
IOT_SECRET="ae8d995a2d097e75d27c550c76d0865d7d3ce762be388add02b73b130003b574"
REGION="us-central1"          # free-tier region: us-west1 / us-central1 / us-east1
ZONE="us-central1-a"
# ------------------------
NAME="ck-relay"
INGEST_URL="https://ingest-ossscobabq-ew.a.run.app"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
echo "Project: $PROJECT   Zone: $ZONE"

# 1) Static external IP — STANDARD tier (free egress allowance), free while attached to a VM.
gcloud compute addresses create "${NAME}-ip" --region="$REGION" --network-tier=STANDARD 2>/dev/null || true
STATIC_IP="$(gcloud compute addresses describe "${NAME}-ip" --region="$REGION" --format='get(address)')"
echo "Static IP: $STATIC_IP"

# 2) Firewall: inbound TCP 80 from anywhere → instances tagged http-server.
gcloud compute firewall-rules create "${NAME}-allow-http" \
  --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server 2>/dev/null || true

# 3) Build the VM startup-script (installs node, writes relay.js + systemd unit, starts it).
read -r -d '' STARTUP <<STARTUP_EOF || true
#!/bin/bash
set -e
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
mkdir -p /opt/ck-relay
cat > /opt/ck-relay/relay.js <<'RELAY_EOF'
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const INGEST_URL = process.env.INGEST_URL || 'https://ingest-ossscobabq-ew.a.run.app';
const IOT_SECRET = process.env.IOT_SECRET;

if (!IOT_SECRET) {
  console.error('ERROR: set IOT_SECRET env var.');
  process.exit(1);
}

const target = new URL(INGEST_URL);

function forward(bodyBuf) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname || '/',
        port: 443,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyBuf),
          Authorization: 'Bearer ' + IOT_SECRET,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 502, body: data }));
      }
    );
    req.on('error', (e) => resolve({ status: 502, body: JSON.stringify({ ok: false, error: String(e) }) }));
    req.write(bodyBuf);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, relay: 'carmel-kinneret', target: INGEST_URL }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 8192) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    const bodyBuf = Buffer.concat(chunks);
    const out = await forward(bodyBuf);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.body);
    console.log(new Date().toISOString() + ' ' + req.socket.remoteAddress + ' -> ' + out.status + ' ' + out.body);
  });
});

server.listen(PORT, () => {
  console.log('HTTP->HTTPS relay listening on http://0.0.0.0:' + PORT);
  console.log('Forwarding to ' + INGEST_URL);
});
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

# 4) Create the FREE-TIER e2-micro VM. Cost-safe flags:
#    - e2-micro in us-{west1,central1,east1}  → Always-Free compute
#    - pd-standard 30GB                        → within the 30GB Always-Free disk
#    - STANDARD network tier                   → free egress allowance (1GB/mo N.America)
gcloud compute instances create "$NAME" \
  --zone="$ZONE" \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-type=pd-standard --boot-disk-size=30GB \
  --network-tier=STANDARD \
  --tags=http-server \
  --address="$STATIC_IP" \
  --metadata=startup-script="$STARTUP"

echo ""
echo "============================================================"
echo " Relay deploying (~2 min to boot). Sensor team URL:"
echo ""
echo "     http://${STATIC_IP}/"
echo ""
echo " Verify once up:"
echo "   curl -X POST http://${STATIC_IP}/ -H 'Content-Type: application/json' \\"
echo "     -d '{\"id\":\"probe\",\"lat\":32.72,\"lon\":35.27,\"speed_kmh\":5}'"
echo "   # -> {\"ok\":true}  and a sensor pin appears on the admin God-Mode map"
echo "============================================================"
echo ""
echo " COST: \$0 — e2-micro + 30GB pd-standard + STANDARD tier are Always-Free."
echo " If you ever DELETE the VM, also release the IP so it doesn't bill:"
echo "   gcloud compute addresses delete ${NAME}-ip --region=${REGION}"
echo " Full teardown (removes everything):"
echo "   gcloud compute instances delete ${NAME} --zone=${ZONE} -q && \\"
echo "   gcloud compute addresses delete ${NAME}-ip --region=${REGION} -q && \\"
echo "   gcloud compute firewall-rules delete ${NAME}-allow-http -q"
