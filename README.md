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

## Caching

The JSON routes are API endpoints, so staleness is treated as a bug. Three layers
cache independently:

| Layer | JSON | Images |
|---|---|---|
| Client | `cache: 'no-cache'` — revalidates every read, 304 when unchanged | cached normally; bytes rarely change |
| Primary CDN | `max-age=600`, **not removable** — Pages cannot set response headers | same |
| Mirror CDN | purged automatically on every publish | **12h window remains** |

`no-cache` rather than `no-store`: the origin sends an ETag, so a revalidation
that finds nothing new costs a 304 with an empty body instead of re-transferring
the whole thing — which matters against the bandwidth limit below.

**Mirrors are split by resource type**, because JSON and images need opposite
things and no single jsDelivr endpoint gives both:

- **JSON → `cdn.jsdelivr.net`** — the only endpoint purge clears
  (`providers: {CF, FY}`). Measured after one publish: `cdn` served the new commit
  at `age: 0` while `gcore` was still handing out a 3.5-hour-old copy.
- **Images → `gcore.jsdelivr.net`** — `cdn`/`fastly` answer image requests with a
  301 to `raw.githubusercontent.com`, which measured less reliable than either origin.

**Two limits to know:**

1. A replaced file is invisible for up to 10 minutes on the primary origin, and
   `?v=` does not help — the query string is stripped from the cache key.
2. A replaced **image** can stay up to 12h stale on the asset mirror, which purge
   cannot reach. Rename the file instead of overwriting it.

**While iterating on assets:** preview locally with `http.server` and push once
settled. To check production immediately, pin a commit sha — that URL is
permanently immutable and unaffected by either cache:

```
https://gcore.jsdelivr.net/gh/bitsky-tech/static@<commit-sha>/static/logo.png
```

## Known constraints (all measured, not assumed)

| Constraint | Measured | Consequence |
|---|---|---|
| 404 response | 9379 B, `content-type: text/html` | Clients must check `res.ok`, or `res.json()` throws an opaque parse error |
| CORS | `access-control-allow-origin: *` | Clients can fetch cross-origin directly; no proxy needed |
| Published size | 1 GB (GitHub soft limit) | Total size of everything published. A few dozen images is tens of MB — far from it |
| Monthly bandwidth | 100 GB (GitHub soft limit) | Outbound traffic. At 2 MB per image that is ~50k image requests/month; 100 desktop clients pulling 10 images a day would reach ~60 GB |
| Reachability in China | `github.io` transfers get cut mid-stream; on one tested network it failed 3/3 while `api.github.com` stayed up. The **custom domain was unaffected** — the block follows the hostname | Clients still ship the mirror fallback, but `static.bridgic.ai` is usable as the primary |
| Mirror node location | Served from US nodes (`cf-ray … -SJC`, Fastly `FRA`/`DFW`); jsDelivr's mainland-China nodes were retired | ~0.75s from a China network — fine as a fallback, not as a primary |

> "Soft limit" means GitHub does not hard-block at the number; it reserves the
> right to contact you or throttle. Both figures come from GitHub's documentation
> and are the two values here that are **not** measured.

## Changing the owner

Three places: `DEFAULT_JSON_MIRROR` and `DEFAULT_ASSET_MIRROR` in
`examples/staticBridgicClient.ts`, and the value
of the DNS CNAME record above.
