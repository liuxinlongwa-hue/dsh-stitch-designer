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
const STATE_FILE = path.join(os.homedir(), '.stitch', 'state.json')
const DEFAULT_PROJECT = '5188527734101747624'

function apiKey() {
  try {
    return fsmod.readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return process.env.STITCH_API_KEY || ''
  }
}

// 项目状态持久化：跨进程/重启记住上次使用的项目和最近生成的 screen，
// 避免 cachedProject 被切到空项目/新项目后面板一片空白。
function loadState() {
  try { return JSON.parse(fsmod.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}
function saveState(patch) {
  try {
    const prev = loadState()
    const s = { ...prev, ...patch }
    // 空值不覆盖已有值（防止内存变量未初始化时把 state.json 清空）
    if (!patch.projectId && prev.projectId) s.projectId = prev.projectId
    if (!patch.lastScreenId && prev.lastScreenId) s.lastScreenId = prev.lastScreenId
    fsmod.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
    return s
  } catch { return patch }
}
// 项目 → 已知 screenId 注册表（list_screens 索引不可靠，本地记住见过的 id 以便兜底列出全部）
function knownScreenIds(projectId) {
  const st = loadState()
  const reg = (st.screensByProject && st.screensByProject[projectId]) || []
  return Array.isArray(reg) ? reg : []
}
function rememberScreenId(projectId, sid) {
  if (!projectId || !sid) return
  try {
    const st = loadState()
    const reg = st.screensByProject || {}
    const list = Array.isArray(reg[projectId]) ? reg[projectId] : []
    if (!list.includes(sid)) list.push(sid)
    reg[projectId] = list.slice(-50) // 每项目最多记 50 个
    fsmod.writeFileSync(STATE_FILE, JSON.stringify({ ...st, screensByProject: reg }, null, 2))
  } catch (_) { /* ignore */ }
}
let cachedProject = loadState().projectId || DEFAULT_PROJECT
let lastScreenId = loadState().lastScreenId || ''

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

async function listAllProjects() {
  const sc = await mcpCall('list_projects', {})
  return sc?.projects || []
}

// 找一个"有 screen 的项目"：优先 cachedProject → DEFAULT_PROJECT → 其余项目（按最近更新排序）。
// 避免 cachedProject 被切到空项目后面板一片空白。
async function resolveProjectWithScreens(preferred) {
  const candidates = []
  if (preferred) candidates.push(preferred)
  if (DEFAULT_PROJECT && DEFAULT_PROJECT !== preferred) candidates.push(DEFAULT_PROJECT)
  try {
    const projects = await listAllProjects()
    const rest = projects
      .map(p => p.name.split('/').pop())
      .filter(pid => pid && pid !== preferred && pid !== DEFAULT_PROJECT)
      .sort((a, b) => 0) // 保持 list_projects 返回顺序（通常最新在前）
    for (const pid of rest) candidates.push(pid)
  } catch (_) { /* 扫描失败不致命，继续用候选 */ }
  for (const pid of candidates) {
    if (!pid) continue
    try {
      const screens = await listScreens(pid)
      if (screens && screens.length) return { projectId: pid, screens }
    } catch (_) { /* 单个项目失败继续下一个 */ }
  }
  return { projectId: preferred || DEFAULT_PROJECT, screens: [] }
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

// 从 generate/edit 的返回里直接提取最新 screen（Stitch 的 list_screens 索引有延迟，
// 但返回的 structuredContent.outputComponents[].design.screens[] 里是立即可用的完整数据）
function extractScreenFromReturn(gen) {
  try {
    const ocs = gen?.outputComponents || []
    for (const oc of ocs) {
      const screens = oc?.design?.screens || []
      if (screens && screens.length) return screens[0]
    }
  } catch (_) { /* ignore */ }
  return null
}

// 按 screenId 用 get_screen 兜底取回（list_screens 索引未同步时也能拿到）
async function fetchScreenById(projectId, screenId) {
  const sc = await mcpCall('get_screen', { name: `projects/${projectId}/screens/${screenId}` })
  return sc?.screen || sc || null
}

// 统一处理"拿到 screen 对象"：缓存 PNG/HTML + 更新 lastScreenId + 持久化
async function adoptScreen(projectId, fresh, opts = {}) {
  const sid = (fresh.name || '').split('/').pop() || fresh.id
  if (!sid) return null
  lastScreenId = sid
  cachedProject = projectId
  rememberScreenId(projectId, sid)
  saveState({ projectId, lastScreenId })
  const localPng = path.join(SCREENS_DIR, sid + '.png')
  if (fresh.screenshot?.downloadUrl) {
    try { await downloadTo(fresh.screenshot.downloadUrl, localPng) } catch (_) { /* best effort */ }
  }
  if (fresh.htmlCode?.downloadUrl) {
    try { await downloadTo(fresh.htmlCode.downloadUrl, path.join(HTML_DIR, sid + '.html')) } catch (_) { /* best effort */ }
  }
  return {
    ok: true,
    screenId: sid,
    title: fresh.title || '',
    deviceType: fresh.deviceType || '',
    width: fresh.width || '',
    height: fresh.height || '',
    preview: '/stitch/screens/' + sid + '.png',
    html: '/stitch/html/' + sid + '.html',
    source: opts.source || 'list',
    genMeta: opts.genMeta || null,
  }
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

  // GET /stitch/api/state?projectId=xxx —— 指定项目 + 全部项目列表 + 屏幕列表
  // 无 projectId 时用最近使用的项目；空项目会明确返回 empty 标记，不会串显示别的项目。
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/api/state',
    handler: async (req, res) => {
      try {
        const url = new URL(String(req.url || ''), 'http://localhost')
        const wantId = url.searchParams.get('projectId') || ''
        // 1) 所有项目概览（面板切换用）
        let projects = []
        try {
          const all = await listAllProjects()
          projects = all.map(p => ({
            id: (p.name || '').split('/').pop(),
            name: p.name,
            title: p.title || '',
            deviceType: p.deviceType || '',
            updateTime: p.updateTime || '',
          }))
        } catch (_) { /* 项目列表失败不致命 */ }
        // 2) 目标项目：显式指定 > 最近使用
        let targetId = wantId || cachedProject || (projects[0] && projects[0].id) || DEFAULT_PROJECT
        // 3) 拉取目标项目的 screens（list_screens → get_screen 兜底）
        let screens = []
        try { screens = await listScreens(targetId) } catch (_) { /* ignore */ }
        const items = []
        const seen = new Set()
        for (const s of screens) {
          const sid = s.name.split('/').pop()
          if (seen.has(sid)) continue
          seen.add(sid)
          rememberScreenId(targetId, sid)
          const localPath = path.join(SCREENS_DIR, sid + '.png')
          if (!fsmod.existsSync(localPath) && s.screenshot?.downloadUrl) {
            try { await downloadTo(s.screenshot.downloadUrl, localPath) } catch (_) { /* best effort */ }
          }
          items.push({ name: s.name, id: sid, title: s.title, deviceType: s.deviceType, width: s.width, height: s.height, preview: '/stitch/screens/' + sid + '.png', screenshotUrl: s.screenshot?.downloadUrl || '', htmlUrl: s.htmlCode?.downloadUrl || '' })
        }
        // list_screens 索引可能延迟/缺失：用本地注册表 + lastScreenId 兜底补回
        // （不依赖内存变量是否命中——每次从 state.json 也读一次，避免进程内 lastScreenId 丢失）
        let sidFallback = lastScreenId
        if (!sidFallback) { try { sidFallback = loadState().lastScreenId || '' } catch (_) { /* ignore */ } }
        const extraIds = knownScreenIds(targetId)
        if (sidFallback && !extraIds.includes(sidFallback)) extraIds.unshift(sidFallback)
        for (const sid of extraIds) {
          if (seen.has(sid)) continue
          try {
            const sc = await mcpCall('get_screen', { name: `projects/${targetId}/screens/${sid}` })
            const s = sc?.screen || sc
            if (s && s.name) {
              seen.add(sid)
              const localPath = path.join(SCREENS_DIR, sid + '.png')
              if (!fsmod.existsSync(localPath) && s.screenshot?.downloadUrl) {
                try { await downloadTo(s.screenshot.downloadUrl, localPath) } catch (_) { /* best effort */ }
              }
              items.push({ name: s.name, id: sid, title: s.title, deviceType: s.deviceType, width: s.width, height: s.height, preview: '/stitch/screens/' + sid + '.png', screenshotUrl: s.screenshot?.downloadUrl || '', htmlUrl: s.htmlCode?.downloadUrl || '' })
            }
          } catch (_) { /* 单个 id 兜底失败不致命 */ }
        }
        // 4) 记录最近查看的项目（显式切换也记住）
        cachedProject = targetId
        saveState({ projectId: targetId, lastScreenId })
        const targetMeta = projects.find(p => p.id === targetId) || { id: targetId, title: '' }
        json(res, 200, { ok: true, projectId: targetId, projectTitle: targetMeta.title || '', lastScreenId, projects, screens: items })
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
        saveState({ projectId, lastScreenId })
        const gen = await mcpCall('generate_screen_from_text', { projectId, prompt, deviceType })
        // 1) 优先用返回里的 screen 数据（list_screens 索引有延迟，返回里是立即可用的）
        let fresh = extractScreenFromReturn(gen)
        let source = 'return'
        // 2) 若返回里没有，短等待 list_screens 索引
        if (!fresh) {
          const before = await listScreens(projectId)
          const known = before.map(s => s.name)
          try {
            fresh = await waitForNewScreen(projectId, known, 60000)
            source = 'list'
          } catch (_) { /* 索引未同步，走 3 */ }
        }
        // 3) 最后用 generate 返回的 sessionId 关联的屏幕无法直接取，则报错提示稍后刷新
        if (!fresh) {
          const err = new Error('设计已生成，但 Stitch 索引尚未同步（通常 1-2 分钟内完成）。请稍后点面板"刷新"查看，或稍后重试生成。')
          err.soft = true
          throw err
        }
        const adopted = await adoptScreen(projectId, fresh, { source, genMeta: gen })
        json(res, 200, adopted)
      } catch (e) { json(res, 500, { ok: false, soft: !!e.soft, error: String(e?.message || e) }) }
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
        // 1) 优先用返回里的 screen 数据
        let target = extractScreenFromReturn(edit)
        let source = 'return'
        // 2) 否则短等待后从列表取（可能生成新 screen 或更新原 screen）
        if (!target) {
          await new Promise(r => setTimeout(r, 3000))
          const screens = await listScreens(projectId)
          target = screens.find(s => s.name === screenName) || screens[0]
          source = 'list'
        }
        if (!target) {
          const err = new Error('修改已提交，但 Stitch 索引尚未同步（通常 1-2 分钟内完成）。请稍后点面板"刷新"查看。')
          err.soft = true
          throw err
        }
        const adopted = await adoptScreen(projectId, target, { source, genMeta: edit })
        json(res, 200, { ...adopted, editMeta: edit })
      } catch (e) { json(res, 500, { ok: false, soft: !!e.soft, error: String(e?.message || e) }) }
    },
  }))

  // GET /stitch/api/html/{screenId} —— 触发 HTML 缓存下载（跨项目查找 screen）
  ctx.effect(() => webServer.register({
    kind: 'prefix', path: '/stitch/api/html',
    handler: async (req, res) => {
      try {
        const parts = String(req.url || '').split('?')[0].split('/')
        const screenId = parts[parts.length - 1]
        const { projectId, screens } = await resolveProjectWithScreens(cachedProject)
        cachedProject = projectId
        let target = screens.find(s => s.name.split('/').pop() === screenId)
        // 列表索引未同步时，用 get_screen 直接按 id 查
        if (!target) {
          try { target = await fetchScreenById(projectId, screenId) } catch (_) { /* ignore */ }
        }
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
