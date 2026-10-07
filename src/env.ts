export type Env = {
  /** KV 命名空间（wrangler.jsonc 中绑定，存图片二进制 + 元数据） */
  IMAGES: KVNamespace
  /** 上传/管理令牌（Pages 环境变量，未设置时拒绝所有写操作） */
  UPLOAD_TOKEN: string
}
