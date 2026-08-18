# Changelog

## [1.1.0] - 2026-08-19

### Added
- 项目状态持久化（state.json）：跨进程/重启记住上次项目与最近 screen，面板不再空白
- 跨项目兜底（resolveProjectWithScreens）：当前项目无 screen 时自动找有内容的其他项目
- 生成即取（extractScreenFromReturn）：直接解析 generate/edit 返回值里的 screen，不再依赖 list_screens 索引延迟
- get_screen 按 id 兜底取回 + 本地 screenId 注册表（screensByProject），索引缺失也能列出全部
- 高清预览缓存（=s0）到 ~/.stitch/screens/，面板与本地双份可用
- /stitch/api/state 增强：项目列表 + 指定项目 + 屏幕列表 + 空项目明确标记

### Changed
- 生成/编辑流程：优先用返回数据 → 短等待索引 → 最后按 id 兜底，减少"已生成但看不到"的情况
- 面板显示逻辑：指定项目不再串显示其他项目内容

## [1.0.0] - 2026-08-16

### Added
- 首个正式版本发布（First stable release）
- Google Stitch AI 设计生成（文字 → UI），支持 MOBILE / DESKTOP / TABLET / AGNOSTIC
- DSH 会话内预览面板（会话标题栏「AI 设计」按钮）
- 对话迭代改稿（edit_screens），预览自动更新
- 1:1 HTML 成品导出（可运行 / 部署 / 打包 EXE）
- 高清预览图（Google 图片 `=s0` 原始分辨率）
- 一键安装脚本 `install.sh`
- 完整中英文 README 与 AI 安装指南
