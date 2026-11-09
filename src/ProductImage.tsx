import { ImageOff } from 'lucide-react'
import { useState } from 'react'

type ProductImageProps = {
  src: string | null
  alt: string
  className: string
  loading?: 'eager' | 'lazy'
}

function isAllowedImageUrl(src: string) {
  try {
    const url = new URL(src, window.location.origin)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function ProductImage({ src, alt, className, loading = 'lazy' }: ProductImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (!src || failedUrl === src || !isAllowedImageUrl(src)) {
    return (
      <div className={`${className} image-fallback`} role="img" aria-label={`${alt} (image unavailable)`}>
        <ImageOff size={23} aria-hidden="true" />
        <span>Image unavailable</span>
      </div>
    )
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setFailedUrl(src)}
    />
  )
}
