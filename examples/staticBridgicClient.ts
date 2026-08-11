/**
 * Client for static.bridgic.ai.
 *
 * The host is a plain file tree -- a repo path is the published path, so
 * `api/images.json` serves at https://static.bridgic.ai/api/images.json and
 * `static/logo.png` at https://static.bridgic.ai/static/logo.png. Manifests
 * store repo-relative paths, and this class turns them into absolute URLs, so
 * moving to another CDN later means changing one constant instead of every file.
 *
 * Drop-in target: apps/electron/src/renderer/lib/ in the AmphiAgent desktop
 * workspace. Shaped to match amphiClient.ts -- passthrough zod schemas, a
 * labelled parseResponse boundary, AbortSignal.timeout, an options-object
 * constructor, and a status-carrying error class.
 *
 * Two integration notes when copying this in:
 *   1. amphiClient.ts already has a private `parseResponse`. Prefer lifting that
 *      one into a shared module over keeping the copy below.
 *   2. Messages here are plain strings so the file runs standalone. In-repo they
 *      should go through i18n.t(), as amphiClient.ts does.
 *
 * Why a mirror exists: GitHub Pages (and custom domains fronted by it) are
 * routinely throttled on mainland-China networks, and the observed failure mode
 * is a mid-transfer stall rather than a refused connection -- so a fetch without
 * a timeout can hang for many seconds. jsDelivr fronts the same repo.
 */

import { z } from 'zod'

const DEFAULT_BASE = 'https://static.bridgic.ai'
/**
 * Bootstrap mirror, hardcoded because the very first request can fail and at
 * that point nothing has been read to learn a mirror from.
 *
 * Deliberately `gcore.jsdelivr.net` rather than the documented
 * `cdn.jsdelivr.net`: cdn/fastly answer *image* requests with a 301 to
 * raw.githubusercontent.com, and raw measured less reliable than either origin,
 * so images would have had no real fallback. gcore serves the bytes directly
 * (image/png, CORS *, max-age=604800, 5/5 at ~0.75s). If jsDelivr ever retires
 * this subdomain, fall back to cdn.jsdelivr.net and accept the extra raw hop.
 */
const DEFAULT_MIRROR = 'https://gcore.jsdelivr.net/gh/bitsky-tech/static@main'

/** Short, because its only job is to decide "primary is not answering". */
const PRIMARY_TIMEOUT_MS = 3_000
const MIRROR_TIMEOUT_MS = 10_000

// Passthrough so hand-edited manifests can carry extra keys (captions, tags)
// without breaking clients that were shipped before those keys existed.
export const imageEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
  })
  .passthrough()

export const imagesManifestSchema = z
  .object({ images: z.array(imageEntrySchema) })
  .passthrough()

export const indexManifestSchema = z
  .object({ endpoints: z.record(z.string(), z.string()) })
  .passthrough()

export type ImageEntry = z.infer<typeof imageEntrySchema>

/** Absolute URLs for one asset: primary origin plus the mirror fallback. */
export interface AssetUrls {
  url: string
  mirror: string
}

/** Parse `data` with `schema`, throwing a labelled boundary error on mismatch. */
function parseResponse<T>(schema: z.ZodTypeAny, data: unknown, label: string): T {
  const r = schema.safeParse(data)
  if (!r.success) {
    const detail = r.error.issues
      .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
      .join('; ')
    throw new Error(`invalid ${label} response shape: ${detail}`)
  }
  return r.data as T
}

export class StaticAssetHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'StaticAssetHttpError'
  }
}

export interface StaticAssetClientOptions {
  baseUrl?: string
  mirrorUrl?: string
  primaryTimeoutMs?: number
  mirrorTimeoutMs?: number
}

export class StaticAssetClient {
  private readonly baseUrl: string
  private readonly mirrorUrl: string
  private readonly primaryTimeoutMs: number
  private readonly mirrorTimeoutMs: number

  constructor(opts: StaticAssetClientOptions = {}) {
    // Normalize trailing slash so path joins are predictable.
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
    this.mirrorUrl = (opts.mirrorUrl ?? DEFAULT_MIRROR).replace(/\/+$/, '')
    this.primaryTimeoutMs = opts.primaryTimeoutMs ?? PRIMARY_TIMEOUT_MS
    this.mirrorTimeoutMs = opts.mirrorTimeoutMs ?? MIRROR_TIMEOUT_MS
  }

  /** Resolve a repo-relative path such as `static/logo.png` to both origins. */
  urls(path: string): AssetUrls {
    const clean = path.replace(/^\/+/, '')
    return { url: `${this.baseUrl}/${clean}`, mirror: `${this.mirrorUrl}/${clean}` }
  }

  /**
   * GET a JSON manifest, e.g. `api/images.json`.
   *
   * Note the 600s CDN cache on GitHub Pages: a freshly pushed manifest can take
   * up to ten minutes to become visible, and `?v=` does not help because the
   * query string is stripped out of the cache key.
   */
  async getJson<T>(path: string, schema: z.ZodTypeAny, label = path): Promise<T> {
    const { url } = this.urls(path)
    const res = await this.fetchWithMirror(url)
    // A missing path returns a ~9KB HTML 404, so status must be checked before
    // parsing or res.json() throws an opaque SyntaxError.
    if (!res.ok) throw new StaticAssetHttpError(res.status, `GET ${url} failed with ${res.status}`)
    return parseResponse<T>(schema, await res.json(), label)
  }

  /** The image manifest, with each entry's URLs already resolved. */
  async images(): Promise<Array<ImageEntry & AssetUrls>> {
    const manifest = await this.getJson<z.infer<typeof imagesManifestSchema>>(
      'api/images.json',
      imagesManifestSchema,
      'images',
    )
    return manifest.images.map((entry) => ({ ...entry, ...this.urls(entry.path) }))
  }

  /** Primary origin first; on timeout or network error, retry against the mirror. */
  private async fetchWithMirror(url: string): Promise<Response> {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(this.primaryTimeoutMs) })
    } catch (err: unknown) {
      const mirrored = this.toMirror(url)
      if (mirrored === null) throw err
      return fetch(mirrored, { signal: AbortSignal.timeout(this.mirrorTimeoutMs) })
    }
  }

  /** Rewrite a primary-origin URL onto the mirror, or null if it is not ours. */
  private toMirror(url: string): string | null {
    const prefix = `${this.baseUrl}/`
    if (!url.startsWith(prefix)) return null
    return `${this.mirrorUrl}${url.slice(this.baseUrl.length)}`
  }
}
