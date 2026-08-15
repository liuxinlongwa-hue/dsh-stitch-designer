// Google Stitch 设计预览插件 —— Host 端
// 直接调用 Stitch 官方 MCP HTTP API（stitch.googleapis.com/mcp + X-Goog-Api-Key），
// 提供：生成 / 编辑 / 列表 / 截图缓存 / HTML 导出（1:1 还原）。
// 不依赖 DSH 的 mcp-client，独立可用。
import path from 'node:path'
import os from 'node:os'
import fsmod from 'node:fs'

export const name = 'stitch-designer'
export const inject = ['webServer']

const MCP_URL = 'https://stitch.googleapis.com/mcp'
const KEY_FILE = path.join(os.homedir(), '.stitch', 'key')
const SCREENS_DIR = path.join(os.homedir(), '.stitch', 'screens')
const HTML_DIR = path.join(os.homedir(), '.stitch', 'html')
const DEFAULT_PROJECT = '5188527734101747624'

function apiKey() {
  try {
    return fsmod.readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return process.env.STITCH_API_KEY || ''
  }
}

let cachedProject = DEFAULT_PROJECT
let lastScreenId = ''

async function mcpCall(method, args) {
  const key = apiKey()
  if (!key) throw new Error('未找到 Stitch API key（~/.stitch/key）')
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': key, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: method, arguments: args } }),
  })
  const data = await res.json()
  const result = data?.result || {}
  const sc = result.structuredContent
  if (result.isError) {
    const msg = (result.content && result.content[0] && result.content[0].text) || 'Stitch 调用失败'
    throw new Error(String(msg).slice(0, 500))
  }
  return sc !== undefined ? sc : result.content?.[0]?.text
}

async function listScreens(projectId) {
  const sc = await mcpCall('list_screens', { projectId })
  return sc?.screens || []
}

async function waitForNewScreen(projectId, since, timeoutMs = 180000) {
  const start = Date.now()
  const known = new Set(since)
  while (Date.now() - start < timeoutMs) {
    const screens = await listScreens(projectId)
    const fresh = screens.find(s => !known.has(s.name))
    if (fresh) return fresh
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error('等待 Stitch 生成超时')
}

// Google 图片服务：加 =s0 返回原始高清尺寸（Stitch 默认给缩略图）
function hdImageUrl(url) {
  const u = String(url || '')
  return u.includes('googleusercontent.com') && !/=[sw]\d+/.test(u) ? u + '=s0' : u
}

async function downloadTo(url, dest) {
  const res = await fetch(hdImageUrl(url))
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
  fsmod.mkdirSync(path.dirname(dest), { recursive: true })
  fsmod.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const json = (res, status, value) => {
    try {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(value))
    } catch (_) { /* ignore */ }
  }

  // GET /stitch/api/state —— 当前项目 + 屏幕列表（含本地预览 URL，缺失自动下载缓存）
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/api/state',
    handler: async (req, res) => {
      try {
        const screens = await listScreens(cachedProject)
        const items = []
        for (const s of screens) {
          const sid = s.name.split('/').pop()
          const localPath = path.join(SCREENS_DIR, sid + '.png')
          // 本地无缓存时自动从 Stitch 下载截图（保证预览图可加载）
          if (!fsmod.existsSync(localPath) && s.screenshot?.downloadUrl) {
            try { await downloadTo(s.screenshot.downloadUrl, localPath) } catch (_) { /* best effort */ }
          }
          items.push({ name: s.name, id: sid, title: s.title, deviceType: s.deviceType, width: s.width, height: s.height, preview: '/stitch/screens/' + sid + '.png', screenshotUrl: s.screenshot?.downloadUrl || '', htmlUrl: s.htmlCode?.downloadUrl || '' })
        }
        json(res, 200, { ok: true, projectId: cachedProject, lastScreenId, screens: items })
      } catch (e) { json(res, 500, { ok: false, error: String(e?.message || e) }) }
    },
  }))

  // POST /stitch/api/generate {prompt, deviceType, projectId?}
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/api/generate',
    handler: async (req, res) => {
      try {
        let body = ''
        for await (const chunk of req) body += chunk
        const args = JSON.parse(body || '{}')
        const prompt = String(args.prompt || '').trim()
        if (!prompt) { json(res, 400, { ok: false, error: 'prompt 必填' }); return }
        const projectId = args.projectId || cachedProject
        const deviceType = ['MOBILE', 'DESKTOP', 'TABLET', 'AGNOSTIC'].includes(args.deviceType) ? args.deviceType : 'MOBILE'
        cachedProject = projectId
        const before = await listScreens(projectId)
        const known = before.map(s => s.name)
        const gen = await mcpCall('generate_screen_from_text', { projectId, prompt, deviceType })
        const fresh = await waitForNewScreen(projectId, known)
        lastScreenId = fresh.name.split('/').pop()
        const localPng = path.join(SCREENS_DIR, lastScreenId + '.png')
        if (fresh.screenshot?.downloadUrl) await downloadTo(fresh.screenshot.downloadUrl, localPng)
        if (fresh.htmlCode?.downloadUrl) await downloadTo(fresh.htmlCode.downloadUrl, path.join(HTML_DIR, lastScreenId + '.html'))
        json(res, 200, { ok: true, screenId: lastScreenId, title: fresh.title, deviceType: fresh.deviceType, width: fresh.width, height: fresh.height, preview: '/stitch/screens/' + lastScreenId + '.png', html: '/stitch/html/' + lastScreenId + '.html', genMeta: gen })
      } catch (e) { json(res, 500, { ok: false, error: String(e?.message || e) }) }
    },
  }))

  // POST /stitch/api/edit {screenName, prompt}
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/api/edit',
    handler: async (req, res) => {
      try {
        let body = ''
        for await (const chunk of req) body += chunk
        const args = JSON.parse(body || '{}')
        const screenName = String(args.screenName || '')
        const prompt = String(args.prompt || '').trim()
        if (!screenName || !prompt) { json(res, 400, { ok: false, error: 'screenName 和 prompt 必填' }); return }
        const projectId = screenName.startsWith('projects/') ? screenName.split('/')[1] : cachedProject
        const edit = await mcpCall('edit_screens', { projectId, selectedScreenIds: [screenName.split('/').pop()], prompt })
        // 编辑后重新取最新屏幕（可能生成新 screen 或更新原 screen）
        await new Promise(r => setTimeout(r, 3000))
        const screens = await listScreens(projectId)
        const target = screens.find(s => s.name === screenName) || screens[0]
        lastScreenId = target.name.split('/').pop()
        const localPng = path.join(SCREENS_DIR, lastScreenId + '.png')
        if (target.screenshot?.downloadUrl) await downloadTo(target.screenshot.downloadUrl, localPng)
        if (target.htmlCode?.downloadUrl) await downloadTo(target.htmlCode.downloadUrl, path.join(HTML_DIR, lastScreenId + '.html'))
        json(res, 200, { ok: true, screenId: lastScreenId, preview: '/stitch/screens/' + lastScreenId + '.png', html: '/stitch/html/' + lastScreenId + '.html', editMeta: edit })
      } catch (e) { json(res, 500, { ok: false, error: String(e?.message || e) }) }
    },
  }))

  // GET /stitch/api/html/{screenId} —— 触发 HTML 缓存下载
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/api/html',
    handler: async (req, res) => {
      try {
        const parts = String(req.url || '').split('?')[0].split('/')
        const screenId = parts[parts.length - 1]
        const screens = await listScreens(cachedProject)
        const target = screens.find(s => s.name.split('/').pop() === screenId)
        if (!target) { json(res, 404, { ok: false, error: 'screen 不存在' }); return }
        if (target.htmlCode?.downloadUrl) await downloadTo(target.htmlCode.downloadUrl, path.join(HTML_DIR, screenId + '.html'))
        json(res, 200, { ok: true, html: '/stitch/html/' + screenId + '.html' })
      } catch (e) { json(res, 500, { ok: false, error: String(e?.message || e) }) }
    },
  }))

  // GET /stitch/screens/{id}.png —— 本地预览图
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/screens',
    handler: async (req, res) => {
      try {
        const raw = String(req.url || '').split('?')[0]
        const name = raw.startsWith('/stitch/screens/') ? decodeURIComponent(raw.slice('/stitch/screens/'.length)) : ''
        if (!/^[A-Za-z0-9_-]+\.png$/.test(name)) { res.writeHead(404); res.end('not found'); return }
        const bytes = fsmod.readFileSync(path.join(SCREENS_DIR, name))
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
        res.end(bytes)
      } catch (_) { try { res.writeHead(404); res.end('not found') } catch (__) { /* ignore */ } }
    },
  }))

  // GET /stitch/html/{id}.html —— 1:1 还原的 HTML 成品
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/html',
    handler: async (req, res) => {
      try {
        const raw = String(req.url || '').split('?')[0]
        const name = raw.startsWith('/stitch/html/') ? decodeURIComponent(raw.slice('/stitch/html/'.length)) : ''
        if (!/^[A-Za-z0-9_-]+\.html$/.test(name)) { res.writeHead(404); res.end('not found'); return }
        const bytes = fsmod.readFileSync(path.join(HTML_DIR, name))
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
        res.end(bytes)
      } catch (_) { try { res.writeHead(404); res.end('not found') } catch (__) { /* ignore */ } }
    },
  }))
}
