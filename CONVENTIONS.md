# Conventions

Practices for running a static host that serves **both API endpoints and static
assets**. Every number here was measured on this setup, not taken from folklore —
so they are re-checkable, and worth re-checking if a platform changes.

`README.md` documents *how to use this repo*. This file documents *why it is
shaped this way*, so the reasoning survives the next person who wants to
"simplify" something.

## The core tension

Almost every decision here follows from one fact: **endpoints and assets want
opposite things.**

| | Endpoints (`api/*.json`) | Assets (`static/*`) |
|---|---|---|
| Freshness | Must be current; an edit should land soon | Irrelevant; bytes rarely change |
| URL stability | Must be fixed — clients hardcode it | Free to change |
| Desired cache | As short as possible | As long as possible |
| Size | KB | MB |
| Cost of failure | High — the feature breaks | Medium — an image breaks, the app works |
| How to bust cache | Purge, or short TTL | **Rename the file** |

Treating them as one kind of thing produces contradictions. This repo shipped one
for a few hours: the mirror was pinned to `gcore` so that images would not be
redirected to `raw.githubusercontent.com`, but `gcore` turns out to be the one
endpoint jsDelivr's purge cannot clear — the choice that made assets reliable was
the choice that made endpoints unfixably stale.

**So the first rule is to separate them at the path level** (`api/` vs `static/`).
Caching, mirroring and naming can then evolve independently.

## As an API provider

This is where a data host differs most from a personal static site: **the
consumers are already-shipped clients you cannot change.**

**One entry point; the server hands out the rest.** Clients hardcode exactly one
address (`api/index.json`) and discover every other URL from responses. Two
payoffs: a client never guesses a path, so it never hits a 404 (which on static
hosting is a 9379-byte **HTML** body — `res.json()` then throws a SyntaxError that
looks nothing like "wrong path"); and moving domain or CDN later touches one
place, with shipped clients following automatically.

**Manifests store repo-relative paths, never absolute URLs.**

```json
{ "name": "logo", "path": "static/logo.png" }
```

The client joins `base + path`. Changing CDN then means editing one client
constant instead of every data file.

**Validate leniently, break loudly.** Schemas use zod's `.passthrough()`, so
**adding a field is always safe** — older clients ignore it. Only renaming or
removing a field is breaking.

That property is what decides whether to version the API path at all. This repo
has no `api/v1/` directory precisely because passthrough covers the common case.
When a rename or removal becomes necessary, publish it under a new path and leave
the old one serving.

**Publish the contract where consumers can see it.** `index.html` lists every
endpoint, and it fetches each one live and renders the real response body. The
documentation therefore cannot drift from the data. It doubles as a liveness
check: a broken endpoint shows up red.

**Change discipline:** a published path never gets renamed. Change contents
freely; change structure by publishing a new path.

## Caching

Three layers cache independently, and only one of them is under your control.

| Layer | Endpoints | Assets |
|---|---|---|
| Client | `cache: 'no-cache'` — revalidate every read | Let it cache normally |
| Primary CDN | `max-age=600`, **not configurable** | Same |
| Mirror CDN | Purged on every publish | Accepted; work around it by renaming |

**Disable the client cache for endpoints at all** because the mirror, not the
origin, is the bigger offender: jsDelivr answers with `max-age=604800`, so a
single fallback response would be reused locally **for a week** — an updated
manifest could stay invisible on that machine long after the primary recovered.

**Use `no-cache`, not `no-store`.** Measured: an `If-None-Match` revalidation
returns **304 with a 0-byte body**. That gives freshness without re-transferring
anything, which matters against the bandwidth limit. `no-store` would re-download
every payload for no benefit.

**Do not rely on `?v=123`.** Measured: GitHub Pages strips the query string out of
the CDN cache key — three requests with distinct queries all returned
`x-cache: HIT`. On this class of platform query busting is *definitively broken*,
not merely unreliable.

**Bust asset caches by renaming.** Changing the path is the only mechanism that
always works. Practical rule: **update an asset by adding a new filename, not by
overwriting an existing one.** The old URL keeps working for clients that have not
refreshed their manifest yet.

## Availability

**Every fallback must be exercised, never assumed.** Configuring a mirror is not
the same as having one. Measured here: `cdn`/`fastly` answer *image* requests with
a 301 to `raw.githubusercontent.com`, and raw proved less reliable than the origin
it was supposed to protect — the fallback was decorative.

Generalised:

- Actually issue a request down every degraded path and read the status,
  content-type and headers. Documentation is not evidence.
- Verify fallbacks **per resource type**. One CDN can behave completely
  differently for JSON and for images.
- Verify a fallback's **freshness**, not just its reachability. A mirror that
  cannot be purged is the wrong mirror for an API.

**Set a short timeout on the primary.** The realistic failure mode is not a
refused connection but a transfer cut mid-stream — measured on `github.io`:
`connect` succeeded in 0.09s, then the request died. A fetch without a timeout
hangs instead of failing over. This repo uses 3s for the primary, 10s for the
mirror.

## Verification

**Verify from inside the serving network, not from a dev machine.** Measured:
`github.io` failed **3/3** from the authoring machine while `api.github.com`
stayed up — a local curl simply cannot confirm the deployment. The smoke test
therefore runs in the CI runner after `deploy-pages`.

**Assert content-type, not just status.** An endpoint silently downgraded to
`text/plain` is a real risk on this class of host (`raw.githubusercontent.com`
does exactly that), and it breaks precisely those HTTP clients that branch on the
header.

**Incidental finding worth keeping:** the interference follows the hostname, not
the IP. `github.io` was blocked while the custom domain completed a full TLS
handshake against the same addresses. For clients in mainland China, putting a
custom domain in front is an availability measure, not just cosmetics.

## Engineering

**Do not use a static-site framework.** VitePress, Astro and Docusaurus
fingerprint assets (`logo.a3f9c1.png`), so URLs shift on every build — the exact
opposite of what a data source needs.

**Prefer zero build.** Repo path equals published path. Any build step introduces
the whole class of "I edited the source but production serves the old artifact"
problems.

**If a build is unavoidable, keep output out of git.** Otherwise the repository
accumulates a copy of every version of every binary, and deleting files later
does not shrink it.

**Publish only what should be public.** CI assembles `api/`, `static/` and
`index.html` into `_site` rather than uploading the repo root, so this file, the
README and the reference client stay off the public site.

## When not to use this

The other half of a practice is knowing its edge. If any of the following holds,
a static host is the wrong choice for an API provider:

| Requirement | Why it fails |
|---|---|
| Authentication | No access control; CORS is `*`, so everything is world-readable |
| Writes | Read-only |
| Sub-minute propagation | The 600s primary cache cannot be removed |
| An availability commitment | GitHub Pages makes no uptime guarantee |
| Meaningful traffic | 100 GB/month soft limit — roughly 50k requests for 2 MB images |
| Large datasets | 1 GB published-size limit, enforced; deploys fail past it |
| Confidential content | Pages on a private repo needs a paid plan, and the site itself is still public |

**The deciding question:** is this data something that could be world-readable
anyway? If yes, this approach is excellent value — zero cost, zero operations. If
no, start with object storage behind an authenticating gateway instead of adopting
static hosting and then trying to bolt restrictions on.
