import type { Env } from './env'

const KEY_PATTERN = /^[a-f0-9]{8,40}\.[a-z0-9]{2,5}$/i

/** 图片直链 GET /i/:key —— 公开；先查边缘缓存，再回源 KV */
export const onRequestGet: PagesFunction<Env, 'key'> = async (ctx) => {
  const raw = ctx.params.key
  if (typeof raw !== 'string' || !KEY_PATTERN.test(raw)) {
    return Response.json({ success: false, error: '非法 key' }, { status: 400 })
  }

  const cache = caches.default
  const hit = await cache.match(ctx.request)
  if (hit) return hit

  const data = await ctx.env.IMAGES.getWithMetadata(`i/${raw}`, { type: 'arrayBuffer' })
  if (!data.value) {
    return Response.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const meta = (data.metadata || {}) as { type?: string }
  const headers = new Headers()
  headers.set('Content-Type', meta.type || 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', `"${raw}"`)
  const res = new Response(data.value, { headers })
  ctx.waitUntil(cache.put(ctx.request, res.clone()))
  return res
}
