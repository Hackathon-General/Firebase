# HTTP → HTTPS Sensor Relay

HTTP-only sensors (no TLS) can't reach Cloud Run directly — it redirects to `https` and drops the
`Authorization` header. This tiny zero-dependency relay bridges them.

```
[ sensor ] --http--> [ relay (this box, port 8080) ] --https--> [ ingest Cloud Function ] --> RTDB live/*
```

## Run

```bash
IOT_SECRET=ae8d995a2d097e75d27c550c76d0865d7d3ce762be388add02b73b130003b574 node relay.js
```

Runs on any always-on machine with a LAN/public IP (laptop at the event, Raspberry Pi, VPS).
Node 18+ only — no `npm install` needed.

Optional env:
- `PORT` (default `8080`; use `80` if you can bind it / run with privileges)
- `INGEST_URL` (default the prod ingest URL)

## Sensor sends (plain HTTP, no auth header — the relay adds the secret)

```
POST http://<relay-ip>:8080/
Content-Type: application/json

{"id":"runner-01","lat":32.75,"lon":35.07,"speed_kmh":8.5,"heading_deg":90}
```

Relay returns the function's exact response (`{"ok":true}` / `401` / `400` / `429`).

## Health check
`GET http://<relay-ip>:8080/` → `{"ok":true,"relay":"carmel-kinneret",...}`

## Notes
- Keep the relay on a trusted network — anything that can POST to it gets its position relayed
  (the relay holds the secret, so sensors don't need it).
- One relay can serve many sensors; the Cloud Function still enforces per-device rate limiting.
