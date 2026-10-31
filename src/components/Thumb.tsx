// a small picture of the picked weapon / Warframe / mod. WFCD's image CDN first, the wiki's copy if that one is missing
// (a few, like Galvanized Chamber and Heavy Caliber, point at files the CDN doesn't have). hides itself if both fail
// (offline), so the layout never shows a broken icon
import { useState } from 'react'

export const IMAGE_BASE = 'https://cdn.warframestat.us/img/'

export const imageSources = (imageName: string | null | undefined, wikiImage?: string | null) =>
  [imageName ? IMAGE_BASE + imageName : null, wikiImage ?? null].filter((source): source is string => Boolean(source))

// tries each source in turn. keyed on the first one so picking another item starts over
export function FallbackImage({ sources, className, alt, title }: { sources: string[]; className: string; alt: string; title?: string }) {
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key: '', count: 0 })
  const key = sources.join('|')
  const tried = failed.key === key ? failed.count : 0
  if (tried >= sources.length) return null
  return (
    <img
      className={className} src={sources[tried]} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer"
      onError={() => setFailed({ key, count: tried + 1 })}
    />
  )
}

export function Thumb({ imageName, wikiImage, alt, wide }: { imageName: string | null | undefined; wikiImage?: string | null; alt: string; wide?: boolean }) {
  return <FallbackImage sources={imageSources(imageName, wikiImage)} className={`thumb ${wide ? 'wide' : ''}`} alt={alt} title={alt} />
}
