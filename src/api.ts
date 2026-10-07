import { Hono } from 'hono'
import type { Env } from './env'

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

/** /api/* 全部路由，挂到 functions/api/[[route]].ts */
export const app = new Hono<{ Bindings: Env }>().basePath('/api')

// ---- 令牌鉴权（未配置 UPLOAD_TOKEN 时全部拒绝）----
app.use('*', async (c, next) => {
  const parts = (c.req.header('Authorization') || '').split(/\s+/).filter(Boolean)
  const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : ''
  if (!c.env.UPLOAD_TOKEN || !token || token !== c.env.UPLOAD_TOKEN) {
    return c.json({ success: false, error: 'Unauthorized：请在设置中配置正确的访问令牌' }, 401)
  }
  await next()
})

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }))

// ---- 上传（SHA-1 内容寻址，重复图片自动去重）----
app.post('/upload', async (c) => {
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
app.get('/images', async (c) => {
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

// ---- 删除（同步清理边缘缓存）----
app.delete('/images/:key', async (c) => {
  const raw = c.req.param('key')
  if (!KEY_PATTERN.test(raw)) {
    return c.json({ success: false, error: '非法 key' }, 400)
  }
  await c.env.IMAGES.delete(`i/${raw}`)
  await caches.default.delete(new URL(`/i/${raw}`, c.req.url).toString())
  return c.json({ success: true })
})
