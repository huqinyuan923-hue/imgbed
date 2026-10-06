// PixNest 前端逻辑：上传（拖拽/粘贴/选择）+ 图库管理
const $ = (s) => document.querySelector(s)
const TOKEN_KEY = 'picnest_token'

const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function toast(msg, ms = 2200) {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { t.hidden = true }, ms)
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制' + (label || ''))
  } catch {
    toast('复制失败，请手动复制')
  }
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(2) + ' MB'
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + getToken(), ...(opts.headers || {}) },
  })
  if (res.status === 401) {
    openTokenModal()
    throw new Error('需要访问令牌')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false) throw new Error(data.error || 'HTTP ' + res.status)
  return data
}

// ---------- 令牌 ----------
function openTokenModal() {
  $('#tokenInput').value = getToken()
  $('#tokenModal').showModal()
}

$('#tokenBtn').addEventListener('click', openTokenModal)
$('#tokenCancel').addEventListener('click', () => $('#tokenModal').close())
$('#tokenForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const v = $('#tokenInput').value.trim()
  if (!v) return
  setToken(v)
  $('#tokenModal').close()
  toast('令牌已保存')
  try {
    await api('/api/images')
    cursor = null
    $('#gallery').innerHTML = ''
    await loadGallery()
  } catch { /* 错误已由 api() 处理 */ }
})

// ---------- 上传 ----------
const ACCEPTED = /^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/

function upload(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.setRequestHeader('Authorization', 'Bearer ' + getToken())
    const fd = new FormData()
    fd.append('file', file)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(file.name, e.loaded / e.total)
    }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status === 401) { openTokenModal(); return reject(new Error('需要访问令牌')) }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) return resolve(data)
      reject(new Error(data.error || '上传失败 HTTP ' + xhr.status))
    }
    xhr.onerror = () => reject(new Error('网络错误'))
    xhr.send(fd)
  })
}

function setProgress(name, ratio) {
  const bar = progressRows.get(name)
  if (bar) bar.style.width = Math.round(ratio * 100) + '%'
}

const progressRows = new Map()

function addProgressRow(name) {
  const row = el('div', 'prog')
  const meta = el('div', 'meta')
  meta.append(el('span', 'name', name), el('span', 'pct', '0%'))
  const barWrap = el('div', 'bar')
  const bar = el('i')
  barWrap.append(bar)
  row.append(meta, barWrap)
  $('#progress').hidden = false
  $('#progress').append(row)
  progressRows.set(name, bar)
  row._pct = meta.lastChild
  return row
}

function finishProgressRow(row, ok, msg) {
  row.classList.add(ok ? 'done' : 'err')
  row._pct.textContent = msg
  setTimeout(() => { row.remove(); if (!$('#progress').children.length) $('#progress').hidden = true }, ok ? 1200 : 6000)
}

let uploading = false

async function handleFiles(files) {
  if (uploading) return toast('有任务在上传中，稍等一下')
  const images = [...files].filter((f) => ACCEPTED.test(f.type))
  const skipped = files.length - images.length
  if (skipped) toast(`跳过了 ${skipped} 个非图片文件`)
  if (!images.length) return
  if (!getToken()) return openTokenModal()

  uploading = true
  for (const file of images) {
    const row = addProgressRow(file.name)
    try {
      const data = await upload(file)
      setProgress(file.name, 1)
      finishProgressRow(row, true, data.deduped ? '去重命中，返回已有链接' : fmtSize(file.size))
      addResultCard(data, file)
    } catch (err) {
      finishProgressRow(row, false, err.message || '上传失败')
    }
  }
  uploading = false
  await loadGallery(true)
}

function addResultCard(data, file) {
  const card = el('div', 'result')
  const img = el('img')
  img.src = data.url
  img.alt = ''
  const info = el('div', 'info')
  const nameRow = el('div', 'name')
  nameRow.append(el('span', null, (file && file.name) || data.key))
  if (data.deduped) nameRow.append(el('span', 'badge', '去重命中'))
  const urlLine = el('div', 'url', data.url)
  urlLine.title = data.url
  const btns = el('div', 'btns')
  const mk = (label, text) => {
    const b = el('button', 'mini', label)
    b.addEventListener('click', () => copyText(text, label))
    return b
  }
  btns.append(mk('复制 URL', data.url), mk('Markdown', data.markdown), mk('HTML', data.html))
  info.append(nameRow, urlLine, btns)
  card.append(img, info)
  $('#results').prepend(card)
}

// 拖拽 / 点击 / 粘贴
const dz = $('#drop')
;['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over') }),
)
;['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over') }),
)
dz.addEventListener('drop', (e) => handleFiles([...(e.dataTransfer?.files || [])]))
dz.addEventListener('click', () => $('#file').click())
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('#file').click() })
$('#file').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = '' })
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])]
  if (files.length) handleFiles(files)
})

// ---------- 图库 ----------
let cursor = null
let totalBytes = 0
let totalCount = 0

async function loadGallery(reset = false) {
  if (reset) { cursor = null; totalBytes = 0; totalCount = 0; $('#gallery').innerHTML = '' }
  if (!getToken()) { renderEmpty('设置令牌后即可浏览图库'); return }

  const qs = cursor ? '?cursor=' + encodeURIComponent(cursor) : ''
  let data
  try {
    data = await api('/api/images' + qs)
  } catch { return }

  const grid = $('#gallery')
  const empty = grid.querySelector('.empty')
  if (empty) empty.remove()

  if (!data.objects.length && !totalCount) renderEmpty('还没有图片，上传第一张吧')

  for (const o of data.objects) {
    totalCount++
    totalBytes += o.size
    grid.append(galleryCard(o))
  }
  $('#sum').textContent = totalCount ? `（已加载 ${totalCount} 张 · ${fmtSize(totalBytes)}）` : ''
  cursor = data.nextCursor
  $('#more').hidden = !cursor
}

function renderEmpty(text) {
  $('#gallery').append(el('div', 'empty', text))
}

function galleryCard(o) {
  const card = el('div', 'gcard')
  const img = el('img')
  img.src = o.url
  img.loading = 'lazy'
  img.alt = o.name
  img.addEventListener('click', () => window.open(o.url, '_blank'))

  const meta = el('div', 'meta')
  meta.append(el('div', 'name', o.name))

  const d = new Date(o.uploaded)
  const date = `${d.getMonth() + 1}/${d.getDate()}`
  meta.append(el('div', 'sub', `${fmtSize(o.size)} · ${date}`))

  const btns = el('div', 'btns')
  const mk = (label, text, cls) => {
    const b = el('button', 'mini' + (cls ? ' ' + cls : ''), label)
    b.addEventListener('click', () => {
      if (cls === 'danger' && !confirm('确定删除这张图片？直链将立即失效。')) return
      b.disabled = true
      Promise.resolve()
        .then(() => (cls === 'danger' ? api('/api/images/' + o.key, { method: 'DELETE' }) : copyText(text, label)))
        .then(() => { if (cls === 'danger') { card.remove(); totalCount--; toast('已删除'); updateSum() } })
        .catch((err) => { b.disabled = false; toast(err.message || '操作失败') })
    })
    return b
  }
  btns.append(mk('URL', o.url), mk('MD', '![](' + o.url + ')'), mk('删除', null, 'danger'))
  meta.append(btns)
  card.append(img, meta)
  return card
}

function updateSum() {
  $('#sum').textContent = totalCount ? `（已加载 ${totalCount} 张 · ${fmtSize(totalBytes)}）` : ''
}

$('#more').addEventListener('click', () => loadGallery())

// ---------- 启动 ----------
loadGallery()
