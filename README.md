# dsh-stitch-designer · Google Stitch AI 设计预览插件 for DeepSeek Harness

> 🎨 在 DeepSeek Harness（DSH）里用 **Google Stitch** 做 UI/页面设计：文字需求 → 生成设计稿 → 会话内预览图实时展示 → 对话迭代改稿 → 1:1 导出 HTML 成品（可打包 EXE）。支持 **APP / Web / 桌面软件界面**。

**社区插件**：`dsh-plugin` · 适用 DSH Web（Cordis 组合插件，Host + Client 双端）

---

## ✨ 功能

| 能力 | 说明 |
|---|---|
| 文字生成设计 | 输入需求 → Stitch 生成高清设计稿 |
| 设备类型 | `MOBILE`（APP/小程序）· `DESKTOP`（Web/软件界面）· `TABLET` · `AGNOSTIC` |
| 会话内预览 | 会话标题栏「AI 设计」按钮 → 弹出面板实时显示设计预览图（高清原图） |
| 对话迭代 | 直接说"哪里要改" → AI 调用 Stitch 编辑 → 预览图自动更新（面板点刷新） |
| 1:1 导出 | 确定版后导出完整 HTML 成品（Tailwind，可直接运行/部署/打包 EXE） |
| 网页同步 | 同账号打开 stitch.withgoogle.com 可实时查看/手动微调（可选） |

## 📦 安装（给人类）

```bash
# 1. 克隆
git clone https://github.com/liuxinlongwa-hue/dsh-stitch-designer.git
cd dsh-stitch-designer

# 2. 一键安装（自动复制插件 + 写组合配置）
bash install.sh

# 3. 准备 Stitch API key（免费）
#    a. 打开 https://stitch.withgoogle.com 登录
#    b. 头像 → Stitch Settings → API key → Create key
#    c. 把完整 key（AQ. 开头）保存：echo 'AQ.你的key' > ~/.stitch/key && chmod 600 ~/.stitch/key

# 4. 重启 DSH（dsh web），会话标题栏出现「AI 设计」按钮即成功
```

## 🤖 安装（给 AI——把本 README 链接给 AI 读，AI 即可配置）

AI 阅读本文件后，按以下步骤配置：

1. **了解目标**：这是 DeepSeek Harness（DSH）的 Cordis 组合插件，含 Host 端（`plugin.js`）+ Client 端（`client.js`，浏览器面板）。
2. **安装插件**：
   - 将三个文件（`plugin.js` / `client.js` / `package.json`）放入 DSH profile 的 node_modules：
     `${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/stitch-designer/`
   - 在 npx 缓存 node_modules（DSH 实际安装位置，如 `~/.npm/_npx/<hash>/node_modules/`）建立符号链接：`ln -sfn <上面目录> <npx缓存>/stitch-designer`
     （原因：DSH loader 用 `import('stitch-designer')` 从自身位置解析；client-modules 用 `createRequire(profile目录)` 解析 package.json，两边都要能命中。）
   - 在 profile 组合 `cordis.patch.yml` 追加：
     ```yaml
     - insert:
         - id: stitch-designer
           name: 'stitch-designer'
     ```
3. **配置 API key**：
   - 让用户到 https://stitch.withgoogle.com → 头像 → Stitch Settings → API key → Create key 获取免费 key（`AQ.` 开头）。
   - 保存到 `~/.stitch/key`（权限 600）。
   - 插件通过请求头 `X-Goog-Api-Key` 调用官方 MCP 端点 `https://stitch.googleapis.com/mcp`（无需额外 MCP 客户端配置，插件自带）。
4. **重启 DSH** 使组合生效；验证会话标题栏出现「AI 设计」按钮。
5. **使用流程**：用户提设计需求 → 调 `POST /stitch/api/generate`（body `{prompt, deviceType}`）→ 等待（生成约 1-2 分钟，异步落库，用 `list_screens` 轮询）→ 面板显示 `/stitch/screens/{id}.png` 高清预览 → 用户提意见 → `POST /stitch/api/edit`（`{screenName, prompt}`）→ 预览更新 → 满意后 `POST /stitch/api/html/{screenId}` 导出 1:1 HTML。

## 🔌 插件 API（Host 路由）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/stitch/api/state` | 项目 + 屏幕列表（含高清预览 URL，缺失自动下载） |
| POST | `/stitch/api/generate` | `{prompt, deviceType}` 生成设计 |
| POST | `/stitch/api/edit` | `{screenName, prompt}` 编辑改稿 |
| GET | `/stitch/api/html/{screenId}` | 导出 1:1 HTML |
| GET | `/stitch/screens/{id}.png` | 高清预览图（本地缓存） |
| GET | `/stitch/html/{id}.html` | HTML 成品 |

- 高清截图：Stitch 返回的 `screenshot.downloadUrl` 是缩略图，插件自动加 **`=s0`** 参数取原始分辨率（Google 图片服务约定）。
- 默认项目：`5188527734101747624`（可在 `plugin.js` 的 `DEFAULT_PROJECT` 修改）。

## 🛠 开发

- `plugin.js`：Host 端（Node），直接 fetch Stitch MCP HTTP API，管理生成/编辑/缓存/导出。
- `client.js`：Client 端（浏览器 bundle，`__ModuleLoader__.load`），会话头部 Slot 注册「AI 设计」面板。
- 无构建链，纯手写 bundle，修改即生效（重启 DSH）。

## 🔒 安全

- API key 存于 `~/.stitch/key`（600 权限），不硬编码、不随代码发布。
- 请勿把 key 提交到公开仓库。

## 📄 License

MIT
