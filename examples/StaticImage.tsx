/**
 * Remote asset <img> with a one-shot mirror fallback.
 *
 * Drop-in target: apps/electron/src/renderer/lib/ (or components/) in the
 * AmphiAgent desktop workspace. No CSP change is needed -- the renderer's
 * img-src already allows `https:`.
 */

import { useState } from 'react'

import type { AssetUrls, ImageEntry } from './staticBridgicClient'

interface StaticImageProps {
  /** An entry from StaticAssetClient.images(), which already carries both URLs. */
  image: ImageEntry & AssetUrls
  className?: string
}

/**
 * The `src !== image.mirror` guard is what stops an onError loop: without it, a
 * mirror that also fails re-triggers onError and re-sets the same src forever.
 *
 * width/height come from the manifest so the layout reserves space before the
 * bytes land, instead of reflowing as each image decodes.
 */
export function StaticImage({ image, className }: StaticImageProps) {
  const [src, setSrc] = useState(image.url)

  return (
    <img
      src={src}
      alt={image.name}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      loading="lazy"
      className={className}
      onError={() => {
        if (src !== image.mirror) setSrc(image.mirror)
      }}
    />
  )
}
