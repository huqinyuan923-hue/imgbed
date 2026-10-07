# PixNest · 私有图床 🪺

Cloudflare **Pages + KV** 的个人图床：粘贴 / 拖拽 / 点击上传，SHA-1 内容寻址自动去重，直链外发（边缘缓存 + 一年强缓存），自带图库管理页。**全程免费、无需绑卡。**

## 特性

- 📋 **三种上传姿势**：Ctrl+V 粘贴、拖拽、点击选择，多文件队列 + 进度条
- 🔁 **内容寻址去重**：相同图片只存一份（SHA-1 前 16 位作 key）
- 🔗 **一键复制**：URL / Markdown / HTML 三种格式
- 🖼️ **图库管理**：分页浏览、缩略图预览、复制、删除（删除同步清边缘缓存）
- 🔐 **令牌鉴权**：上传与管理私有，图片直链公开
- 💰 **免费额度**（无需绑卡）：KV 1GB 存储 / 每天 10 万次读 / 1000 次写——个人图床绰绰有余

## 部署到 Cloudflare Pages（面板方式，约 5 分钟）

> 前置：域名 DNS 已托管在 Cloudflare（下面第 6 步会把 `img.adcakeyuan.top` 绑到本项目，可按需改成你自己的子域）。

1. **创建 KV 命名空间**：Dashboard → 存储和数据库 → KV → 创建命名空间，名称 `picnest-images`，**复制它的 32 位 ID**
2. **填入 ID**：把 ID 填进 `wrangler.jsonc` 的 `kv_namespaces[0].id`（可直接在 GitHub 网页上编辑这一行提交）
3. **创建 Pages 项目**：Workers 和 Pages → 创建 → 选 **Pages** 标签 → 连接到 Git → 选本仓库：
   - 项目名称：`picnest`
   - 框架预设：**无**
   - 构建命令：**留空**
   - 构建输出目录：`public`
4. **设置令牌**：项目 → 设置 → 环境变量 → （生产和预览都）添加：`UPLOAD_TOKEN` = 你的令牌（一串长随机字符），可选勾选"加密"
5. **部署**，访问 `https://picnest.pages.dev` 确认能打开
6. **绑定域名**：项目 → 自定义域 → 添加 `img.adcakeyuan.top`（DNS 在同一账号，一键创建）

本地方式：`npx wrangler pages deploy public`。

## API

所有 `/api/*` 需要 Header：`Authorization: Bearer <UPLOAD_TOKEN>`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/upload` | multipart 字段 `file`，返回 `{ url, markdown, html, deduped }` |
| GET | `/api/images?cursor=` | 图库列表（游标分页，每页 60） |
| DELETE | `/api/images/:key` | 删除图片（同时清理边缘缓存） |
| GET | `/i/<key>` | 图片直链（公开，无鉴权，边缘缓存 + 强缓存） |

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
- KV 免费档：1GB 总量、每天 1000 次写入、10 万次读取——图库页显示累计体积，写满前注意清理
- 未配置 `UPLOAD_TOKEN` 时所有写操作返回 401（防误上线裸奔）
- 删除后直链立即失效（同步清理缓存）；浏览器本地缓存可能残留
- 令牌泄露：Pages 设置里改掉 `UPLOAD_TOKEN` 重新部署即可

## 本地开发

```bash
npm install
npx wrangler pages dev public   # 本地模拟 KV + Functions
```
