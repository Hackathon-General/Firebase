#!/usr/bin/env bash
# ============================================================================
# SELF-CONTAINED + NON-INTERACTIVE one-shot GCP deploy for the CK HTTP relay.
# relay.js is embedded below — this is the ONLY file you need.
#
# Hardened so it NEVER hangs:
#   - enables the Compute API first (the usual "nothing happens" cause is the
#     interactive 'enable API? (y/N)' prompt on the first compute call)
#   - --quiet everywhere (no y/N prompts)
#   - progress echo before every step so you always see where it is
#   - creates the VM with --async (returns immediately; we poll for the IP)
#
# RUN (GCP Cloud Shell):
#   bash gcp-deploy-standalone.sh
# Then it prints  http://<IP>/  for the sensor team.
# ============================================================================
set -uo pipefail   # NOTE: no -e, so one soft failure can't silently abort

# ---- EDIT IF NEEDED ----
IOT_SECRET="ae8d995a2d097e75d27c550c76d0865d7d3ce762be388add02b73b130003b574"
REGION="us-central1"          # free-tier region: us-west1 / us-central1 / us-east1
ZONE="us-central1-a"
# ------------------------
NAME="ck-relay"
INGEST_URL="https://ingest-ossscobabq-ew.a.run.app"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1   # belt-and-suspenders: never prompt

say() { echo ">>> [$(date +%H:%M:%S)] $*"; }

say "Project: ${PROJECT:-<none>}   Zone: $ZONE"
[ -z "$PROJECT" ] && { echo "ERROR: no project set → run: gcloud config set project carmel-kinneret"; exit 1; }

# 0) Enable the Compute Engine API (THE usual hang). Idempotent; ~30-60s first time.
say "Enabling compute.googleapis.com (can take ~1 min the first time)…"
gcloud services enable compute.googleapis.com --quiet
say "Compute API ready."

# 1) Static external IP — STANDARD tier (free), free while attached to a VM.
say "Reserving static IP ${NAME}-ip…"
gcloud compute addresses create "${NAME}-ip" --region="$REGION" --network-tier=STANDARD --quiet 2>/dev/null \
  && say "IP created." || say "IP already exists (ok)."
STATIC_IP="$(gcloud compute addresses describe "${NAME}-ip" --region="$REGION" --format='get(address)' 2>/dev/null)"
say "Static IP = ${STATIC_IP:-<pending>}"

# 2) Firewall: inbound TCP 80 from anywhere → instances tagged http-server.
say "Creating firewall rule ${NAME}-allow-http (tcp:80)…"
gcloud compute firewall-rules create "${NAME}-allow-http" \
  --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server --quiet 2>/dev/null \
  && say "Firewall created." || say "Firewall already exists (ok)."

# 3) Startup-script (installs node, writes relay.js + systemd unit, starts it on :80).
#    Written to a FILE and passed via --metadata-from-file so gcloud doesn't try to parse
#    the JS commas/colons as dict syntax (that's what broke --metadata=startup-script=...).
cat > /tmp/ck-startup.sh <<STARTUP_EOF
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
if (!IOT_SECRET) { console.error('ERROR: set IOT_SECRET'); process.exit(1); }
const target = new URL(INGEST_URL);
function forward(bodyBuf) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: target.hostname, path: target.pathname || '/', port: 443, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyBuf), Authorization: 'Bearer ' + IOT_SECRET },
    }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode||502,body:d})); });
    req.on('error', (e) => resolve({ status: 502, body: JSON.stringify({ ok:false, error:String(e) }) }));
    req.write(bodyBuf); req.end();
  });
}
const server = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,relay:'carmel-kinneret',target:INGEST_URL})); return; }
  if (req.method !== 'POST') { res.writeHead(405,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'method-not-allowed'})); return; }
  const chunks=[]; let size=0;
  req.on('data',(c)=>{ size+=c.length; if(size>8192) req.destroy(); else chunks.push(c); });
  req.on('end', async () => { const b=Buffer.concat(chunks); const out=await forward(b); res.writeHead(out.status,{'Content-Type':'application/json'}); res.end(out.body); console.log(new Date().toISOString()+' '+req.socket.remoteAddress+' -> '+out.status+' '+out.body); });
});
server.listen(PORT, () => { console.log('relay on :'+PORT+' -> '+INGEST_URL); });
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

# 4) Create the FREE-TIER e2-micro VM — --async so this command returns immediately.
say "Creating e2-micro VM '$NAME' (async; returns right away)…"
gcloud compute instances create "$NAME" \
  --zone="$ZONE" \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-type=pd-standard --boot-disk-size=30GB \
  --network-tier=STANDARD \
  --tags=http-server \
  --address="$STATIC_IP" \
  --metadata-from-file=startup-script=/tmp/ck-startup.sh \
  --quiet --async
say "VM create submitted."

echo ""
echo "============================================================"
echo " Relay deploying. The VM boots + installs in ~2-3 min."
echo " Sensor team URL (static, never changes):"
echo ""
echo "     http://${STATIC_IP}/"
echo ""
echo " Watch it come up (run this; repeat until you get {\"ok\":true}):"
echo "     curl -m 5 http://${STATIC_IP}/"
echo ""
echo " Test a sensor reading:"
echo "     curl -X POST http://${STATIC_IP}/ -H 'Content-Type: application/json' \\"
echo "       -d '{\"id\":\"probe\",\"lat\":32.72,\"lon\":35.27,\"speed_kmh\":5}'"
echo "============================================================"
echo " COST: \$0 (e2-micro + 30GB pd-standard + STANDARD tier = Always-Free)."
echo " Teardown:"
echo "   gcloud compute instances delete $NAME --zone=$ZONE -q"
echo "   gcloud compute addresses delete ${NAME}-ip --region=$REGION -q"
echo "   gcloud compute firewall-rules delete ${NAME}-allow-http -q"
