# netspeed-backend

Speedtest backend API for [NetSpeed.me](https://netspeed.me) — Internet & Gaming Network Analyzer.

A lightweight Express server that provides CORS-enabled endpoints for measuring latency, download speed, and upload speed. Deploy it close to your users and point the frontend at it via `NEXT_PUBLIC_TEST_SERVER_URL`.

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/` | Health check / API info (JSON) |
| `GET` | `/ping` | Latency probe — responds immediately with JSON |
| `GET` | `/download?size=100MB` | Streams incompressible random bytes. Accepts `size` (`100MB`, `500KB`, `1GB`) or raw `bytes=N`. Default 50MB, capped at 1GB. |
| `POST` | `/upload` | Accepts and discards a binary body (max 512MB), returns JSON metrics |
| `WS` | `/ws` | Echo socket for latency sampling — frames are echoed back verbatim. Per-message round trips measure true network RTT, bypassing per-HTTP-request proxy overhead. |

### Example responses

`GET /ping`

```json
{ "pong": true, "serverTimestamp": 1718000000000 }
```

`POST /upload`

```json
{ "receivedBytes": 10485760, "durationMs": 812.4, "mbps": 103.25, "serverTimestamp": 1718000000000 }
```

`GET /download` streams `application/octet-stream`; the payload size is echoed in the `Content-Length` and `X-Payload-Bytes` headers. The download payload is built from random bytes so transparent compression cannot inflate measured speeds.

## Run locally

```bash
npm install
npm start
# → NetSpeed backend listening on port 4000
```

Set `PORT` to override the default:

```bash
PORT=8080 npm start
```

Quick smoke test:

```bash
curl http://localhost:4000/ping
curl -o /dev/null -w "%{speed_download}\n" "http://localhost:4000/download?size=10MB"
curl -X POST --data-binary @somefile http://localhost:4000/upload
```

## Deploy on Hostinger (Node.js hosting)

1. Push this repository to GitHub (or upload the files via the File Manager).
2. In **hPanel → Websites → your site → Node.js**, create a Node.js application:
   - **Node version:** 18 or newer
   - **Application root:** the folder containing `server.js`
   - **Application startup file:** `server.js`
3. Run `npm install` (hPanel has an "Install dependencies" button, or use the SSH terminal).
4. Start / restart the application from hPanel.

The server binds to `process.env.PORT`, which Hostinger's runtime injects automatically — no configuration needed.

### Connect the frontend

In the NetSpeed.me frontend, set:

```
NEXT_PUBLIC_TEST_SERVER_URL=https://your-backend-domain.example
```

and rebuild (the variable is inlined at build time).

## Notes

- All responses send `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`.
- Download streaming respects backpressure, so slow clients don't balloon server memory.
- The server-side `mbps` figure on `/upload` is an estimate; the client's own timing is authoritative for displayed results.
