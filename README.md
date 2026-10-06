# PixNest · 私有图床 🪺

Cloudflare **Workers + R2** 的个人图床：粘贴 / 拖拽 / 点击上传，SHA-1 内容寻址自动去重，直链外发（一年强缓存），自带图库管理页。

## 特性

- 📋 **三种上传姿势**：Ctrl+V 粘贴、拖拽、点击选择，多文件队列 + 进度条
- 🔁 **内容寻址去重**：相同图片只存一份（SHA-1 前 16 位作 key）
- 🔗 **一键复制**：URL / Markdown / HTML 三种格式
- 🖼️ **图库管理**：分页浏览、缩略图预览、复制、删除
- 🔐 **令牌鉴权**：上传与管理私有，图片直链公开 + `immutable` 强缓存
- 💰 **零边际成本**：R2 免费档 10GB 存储、**出口流量免费**（相比 S3 的杀手级优势）

## 部署到 Cloudflare（面板方式，约 5 分钟）

> 前置：域名 DNS 已托管在 Cloudflare（自定义域 `img.adcakeyuan.top` 写在 `wrangler.jsonc` 里，可按需改成你自己的）。

1. **创建 R2 存储桶**：Dashboard → R2 对象存储 → 创建存储桶，名称必须是 `picnest-images`
2. **创建 Worker**：Workers 和 Pages → 创建 → 连接到 Git → 选本仓库；构建配置保持默认（自动识别 `wrangler.jsonc`）
3. **设置令牌**：Worker → 设置 → 变量和机密 → 添加 Secret：`UPLOAD_TOKEN` = 你的令牌（随便一串长随机字符）
4. **重试部署**，然后访问 `https://img.adcakeyuan.top`（首次签发证书需几分钟）

本地方式（ alternative）：`npx wrangler login && npx wrangler deploy`。

## API

所有 `/api/*` 需要 Header：`Authorization: Bearer <UPLOAD_TOKEN>`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/upload` | multipart 字段 `file`，返回 `{ url, markdown, html, deduped }` |
| GET | `/api/images?cursor=` | 图库列表（游标分页，每页 60） |
| DELETE | `/api/images/:key` | 删除图片 |
| GET | `/i/<key>` | 图片直链（公开，无鉴权，强缓存） |

### curl

```bash
curl -H "Authorization: Bearer <token>" -F "file=@screenshot.png" https://img.adcakeyuan.top/api/upload
```

### PicGo 自定义上传

```json
{
  "picBed": {
    "uploader": "custom",
    "custom": {
      "apiPath": "https://img.adcakeyuan.top/api/upload",
      "paramName": "file",
      "jsonPath": "url",
      "customHeaders": "Authorization: Bearer <token>"
    }
  }
}
```

## 限制与说明

- 单张 ≤ 10MB；类型白名单：png / jpg / webp / gif / svg / avif
- 未配置 `UPLOAD_TOKEN` 时所有写操作返回 401（防误上线裸奔）
- 删除后直链立即失效；浏览器/CDN 可能仍有缓存残余
- 令牌泄露：CF 面板改掉 `UPLOAD_TOKEN` 重新部署即可

## 本地开发

```bash
npm install
npx wrangler dev        # 本地模拟 R2，无需登录
```
