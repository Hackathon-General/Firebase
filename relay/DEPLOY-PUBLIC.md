# Public HTTP relay for antenna / cellular sensors

The sensor talks **plain HTTP over a cellular antenna** — it is NOT on your Wi-Fi and cannot do
TLS. So the relay must run on a machine with a **public IP / public hostname**, listening on
plain HTTP. The relay then forwards each reading to the HTTPS `ingest` Cloud Function (over TLS,
with the secret attached).

```
[ sensor ] --http (cellular)--> [ public relay box :80 ] --https--> [ ingest Cloud Function ]
```

## What the sensor team gets
A single URL, e.g.:  `http://203.0.113.10/`   (or `http://relay.yourdomain.com/`)
- Method `POST`, `Content-Type: application/json`, no auth header.
- Body: `{"id":"sensor-01","lat":32.72,"lon":35.27,"speed_kmh":9,"heading_deg":120}`

## Option A — cheap public VM (recommended, most reliable)
Any $5 VM with a static public IP (GCP e2-micro / AWS Lightsail / DigitalOcean / Hetzner).

1. Open the firewall for inbound **TCP 80** (and 8080 if you don't use 80).
2. Install Node 18+:  `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
3. Copy `relay.js` to the box (e.g. `/opt/ck-relay/relay.js`).
4. Run it on port 80 as a service (see systemd unit below).

Give the team:  `http://<VM_PUBLIC_IP>/`

### systemd unit (survives reboot/crash) — `/etc/systemd/system/ck-relay.service`
```ini
[Unit]
Description=Carmel-Kinneret IoT HTTP relay
After=network-online.target

[Service]
Environment=PORT=80
Environment=IOT_SECRET=REPLACE_WITH_SECRET
Environment=INGEST_URL=https://ingest-ossscobabq-ew.a.run.app
ExecStart=/usr/bin/node /opt/ck-relay/relay.js
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ck-relay
sudo systemctl status ck-relay      # verify "active (running)"
curl http://localhost/              # health → {"ok":true,...}
```

## Option B — your Mac + a public tunnel (quick test only, NOT for the event)
If the relay must run on your laptop, expose it publicly with a tunnel. Note this gives an
**https** URL — only use it if the sensor CAN do https; for a pure-http sensor use Option A.
```bash
IOT_SECRET=... PORT=8080 node relay.js &
npx localtunnel --port 8080        # prints https://xxxx.loca.lt   (or use ngrok / cloudflared)
```

## Option C — point the sensor straight at Cloud Run (no relay) — ONLY if it can do HTTPS
If the antenna module actually supports TLS, skip the relay: have it POST directly to
`https://ingest-ossscobabq-ew.a.run.app` with header `Authorization: Bearer <IOT_SECRET>`.
(Cloud Run is HTTPS-only and 302-redirects http→https, stripping the auth header — which is
exactly why the relay exists for http-only devices.)

## Verify end-to-end (from anywhere)
```bash
curl -X POST http://<PUBLIC_IP>/ -H "Content-Type: application/json" \
  -d '{"id":"probe","lat":32.72,"lon":35.27,"speed_kmh":5}'
# → {"ok":true}    and the pin appears on the admin God-Mode map (source: sensor)
```
