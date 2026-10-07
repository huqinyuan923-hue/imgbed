import { Hono } from 'hono'

export type Env = {
  /** KV 命名空间（wrangler.jsonc 中绑定，存储图片二进制 + 元数据） */
  IMAGES: KVNamespace
  /** 静态资源（public/ 目录） */
  ASSETS: Fetcher
  /** 上传/管理令牌（CF Secret，未设置时拒绝所有写操作） */
  UPLOAD_TOKEN: string
}

type AppEnv = { Bindings: Env }

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

const ALLOWED_EXTS = new Set(Object.values(EXT_BY_MIME))

function inferExtFromName(name: string): string | null {
  const dot = (name || '').lastIndexOf('.')
  if (dot === -1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return ALLOWED_EXTS.has(ext) ? ext : null
}

const KEY_PATTERN = /^[a-f0-9]{8,40}\.[a-z0-9]{2,5}$/i

const app = new Hono<AppEnv>()

// ---- /api/* 统一令牌鉴权（未配置 UPLOAD_TOKEN 时全部拒绝）----
app.use('/api/*', async (c, next) => {
  const parts = (c.req.header('Authorization') || '').split(/\s+/).filter(Boolean)
  const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : ''
  if (!c.env.UPLOAD_TOKEN || !token || token !== c.env.UPLOAD_TOKEN) {
    return c.json({ success: false, error: 'Unauthorized：请在设置中配置正确的访问令牌' }, 401)
  }
  await next()
})

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }))

// ---- 上传（SHA-1 内容寻址，重复图片自动去重）----
app.post('/api/upload', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return c.json({ success: false, error: '缺少 file 字段（multipart/form-data）' }, 400)
  }
  if (file.size === 0) return c.json({ success: false, error: '空文件' }, 400)
  if (file.size > MAX_SIZE) return c.json({ success: false, error: '超过 10MB 限制' }, 413)

  const ext = EXT_BY_MIME[file.type] || inferExtFromName(file.name)
  if (!ext) {
    return c.json({ success: false, error: `不支持的图片类型: ${file.type || file.name || '未知'}` }, 415)
  }

  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-1', buf)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const key = `i/${hash}.${ext}`

  // 去重检查：KV 无 head()，用同前缀 list 精确判断
  const dup = await c.env.IMAGES.list({ prefix: key, limit: 1 })
  if (!dup.keys.length) {
    await c.env.IMAGES.put(key, buf, {
      metadata: {
        name: (file.name || key).slice(0, 200),
        size: file.size,
        type: file.type || 'application/octet-stream',
        uploaded: new Date().toISOString(),
      },
    })
  }

  const url = `${new URL(c.req.url).origin}/${key}`
  return c.json({
    success: true,
    url,
    key,
    markdown: `![](${url})`,
    html: `<img src="${url}" alt="" />`,
    size: file.size,
    deduped: dup.keys.length > 0,
  })
})

// ---- 图库列表（游标分页）----
app.get('/api/images', async (c) => {
  const cursor = c.req.query('cursor') || undefined
  const list = await c.env.IMAGES.list({ prefix: 'i/', cursor, limit: 60 })
  const origin = new URL(c.req.url).origin
  return c.json({
    success: true,
    objects: list.keys.map((k) => {
      const m = (k.metadata || {}) as { name?: string; size?: number; uploaded?: string }
      return {
        key: k.name.replace(/^i\//, ''),
        name: m.name || k.name,
        size: m.size || 0,
        uploaded: m.uploaded || new Date(0).toISOString(),
        url: `${origin}/${k.name}`,
      }
    }),
    nextCursor: list.list_complete ? null : list.cursor || null,
  })
})

// ---- 删除 ----
app.delete('/api/images/:key', async (c) => {
  const raw = c.req.param('key')
  if (!KEY_PATTERN.test(raw)) {
    return c.json({ success: false, error: '非法 key' }, 400)
  }
  await c.env.IMAGES.delete(`i/${raw}`)
  // 同步清理边缘缓存
  await caches.default.delete(new URL(`i/${raw}`, c.req.url).toString())
  return c.json({ success: true })
})

// ---- 图片直链（公开；先查边缘缓存，再回源 KV，回源结果写入缓存）----
app.get('i/:key', async (c) => {
  const raw = c.req.param('key')
  if (!KEY_PATTERN.test(raw)) {
    return c.json({ success: false, error: '非法 key' }, 400)
  }

  const cache = caches.default
  const cached = await cache.match(c.req.raw)
  if (cached) return cached

  const data = await c.env.IMAGES.getWithMetadata(`i/${raw}`, { type: 'arrayBuffer' })
  if (!data.value) return c.json({ success: false, error: 'Not found' }, 404)

  const meta = (data.metadata || {}) as { type?: string; uploaded?: string }
  const headers = new Headers()
  headers.set('Content-Type', meta.type || 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', `"${raw}"`)
  const res = new Response(data.value, { headers })
  if (meta.uploaded) c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()))
  return res
})

// ---- 其余路径交给静态资源（/、/app.js、/styles.css）----
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
