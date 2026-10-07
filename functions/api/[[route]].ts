import { handle } from 'hono/cloudflare-pages'
import { app } from '../../src/api'

// /api/* 全部交给 Hono 应用处理
export const onRequest = handle(app)
