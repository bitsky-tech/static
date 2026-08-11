# static

Asset and JSON data host for `static.bridgic.ai`, serving the bridgic desktop
clients. Runs on GitHub Pages with **no build step** — a repo path is the
published path.

```
api/images.json    →  https://static.bridgic.ai/api/images.json
static/logo.png    →  https://static.bridgic.ai/static/logo.png
```

<https://static.bridgic.ai/> is an **API reference page**: it lists every
endpoint, probes each one live, shows the real response body, and offers
one-click copy for every address. Copied URLs are always production URLs, even
when previewing locally.

## Adding data

1. Drop files into `static/`
2. Write or edit the matching JSON under `api/`
3. Commit and push to `main` — Actions deploys automatically

Local preview:

```bash
python3 -m http.server 8000     # run from the repo root; paths match production
```

## Layout

| Path | Purpose |
|---|---|
| `api/*.json` | Hand-written data endpoints. The filename is the URL |
| `static/*` | Images and other static files |
| `index.html` | API reference page. Endpoints are read from `api/index.json`, so new ones appear automatically |
| `examples/` | Reference client for the desktop app. **Never published** |
| `CNAME` `.nojekyll` | Kept in the publish tree — do not delete. Note that with **Actions** deployment the `CNAME` file does **not** set the custom domain by itself (measured: `cname` stayed `null` with the file present); the domain comes from the Pages setting below |

`api/index.json` is the endpoint index: clients hardcode that one address and
discover the rest from its response. A `path` in JSON is always **repo-relative**
(e.g. `static/logo.png`) and the client joins `base + path` — so switching domain
or CDN later means changing one client constant instead of every JSON file.

## One-time setup

**DNS**

```
Type: CNAME    Host: static    Value: bitsky-tech.github.io.
```

> If `bridgic.ai` is hosted on Cloudflare, this record must be **grey-cloud /
> DNS only**. Leaving the orange proxy on prevents GitHub from issuing a
> Let's Encrypt certificate, and stacking two CDNs makes it impossible to tell
> which layer is caching.

**Repository settings**

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Pages → Custom domain: `static.bridgic.ai`
3. Enable **Enforce HTTPS** once the certificate is issued

## Client

See `examples/staticBridgicClient.ts` — written to match the `amphiClient.ts`
conventions in the AmphiAgent desktop workspace, ready to copy into
`apps/electron/src/renderer/lib/`.

```ts
const client = new StaticAssetClient()
const images = await client.images()   // every entry carries url + mirror
```

## Known constraints (all measured, not assumed)

| Constraint | Measured | Consequence |
|---|---|---|
| CDN cache | `cache-control: max-age=600` | **After replacing a file in place, clients may see stale bytes for up to 10 minutes** |
| `?v=` cache busting | **Ineffective** — query stripped from the cache key | The only ways to force fresh bytes are renaming the file or the jsDelivr commit form below |
| 404 response | 9379 B, `content-type: text/html` | Clients must check `res.ok`, or `res.json()` throws an opaque parse error |
| CORS | `access-control-allow-origin: *` | Clients can fetch cross-origin directly; no proxy needed |
| Published size | 1 GB official soft limit | A few dozen images is nowhere near it |
| Monthly bandwidth | 100 GB official soft limit | Roughly 50k requests for 2 MB images |
| Reachability in China | `github.io` transfers get cut mid-stream; on one tested network it failed 3/3 while `api.github.com` stayed up | Clients need the mirror fallback, implemented in `examples/` |
| Mirror endpoint choice | `cdn.jsdelivr.net` and `fastly.jsdelivr.net` answer **image** requests with a 301 to `raw.githubusercontent.com`; `gcore.jsdelivr.net` serves the bytes directly | The mirror is pinned to `gcore` — via `cdn` images would fall back onto raw, which measured less reliable than either origin |

**While iterating on assets:** preview locally with `http.server` and push once
settled. To verify production immediately, use the jsDelivr commit form — that
URL is permanently immutable and unaffected by the 600s cache:

```
https://gcore.jsdelivr.net/gh/bitsky-tech/static@<commit-sha>/static/logo.png
```

## Changing the owner

Two places: `DEFAULT_MIRROR` in `examples/staticBridgicClient.ts`, and the value
of the DNS CNAME record above.
