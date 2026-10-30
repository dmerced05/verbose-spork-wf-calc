// a small picture of the picked weapon / Warframe from WFCD's image CDN. hides itself if the image doesn't load
// (offline, or the CDN doesn't have it), so the layout never shows a broken icon
import { useState } from 'react'

export const IMAGE_BASE = 'https://cdn.warframestat.us/img/'

export function Thumb({ imageName, alt, wide }: { imageName: string | null | undefined; alt: string; wide?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!imageName || failed === imageName) return null
  return <img className={`thumb ${wide ? 'wide' : ''}`} src={IMAGE_BASE + imageName} alt={alt} title={alt} loading="lazy" onError={() => setFailed(imageName)} />
}
