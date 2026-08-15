#!/usr/bin/env bash
# dsh-stitch-designer 一键安装脚本（macOS / Linux）
# 用法：bash install.sh
# 作用：把插件装到 DSH profile 的 node_modules、建 npx 缓存 symlink、写入 cordis.patch.yml
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
NPM_NPX="${NPM_NPX:-$HOME/.npm/_npx}"

echo "==> 1/4 复制插件到 DSH profile node_modules"
PKG_DIR="$DSH_HOME/profiles/$PROFILE/node_modules/stitch-designer"
mkdir -p "$PKG_DIR"
cp plugin.js client.js package.json "$PKG_DIR/"

echo "==> 2/4 建立 npx 缓存符号链接（loader 解析需要）"
# 找到当前 npx 缓存目录（dsh 实际安装位置）
NPX_ROOT=$(ls -dt "$NPM_NPX"/*/node_modules 2>/dev/null | head -1 || true)
if [ -z "$NPX_ROOT" ]; then
  echo "警告：未找到 npx 缓存目录，跳过 symlink（若 DSH 无法加载插件请手动处理）"
else
  ln -sfn "$PKG_DIR" "$NPX_ROOT/stitch-designer"
  echo "     symlink -> $NPX_ROOT/stitch-designer"
fi

echo "==> 3/4 写入 cordis.patch.yml（组合挂载）"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
if grep -q "stitch-designer" "$PATCH" 2>/dev/null; then
  echo "     cordis.patch.yml 已包含 stitch-designer，跳过"
else
  cat >> "$PATCH" <<EOF

# ── dsh-stitch-designer（Google Stitch AI 设计预览插件）────────────────
- insert:
    - id: stitch-designer
      name: 'stitch-designer'
EOF
  echo "     已追加到 cordis.patch.yml"
fi

echo "==> 4/4 配置 Stitch API key"
KEY_FILE="$HOME/.stitch/key"
if [ -f "$KEY_FILE" ] && [ -s "$KEY_FILE" ]; then
  echo "     API key 已存在：$KEY_FILE"
else
  echo "     ⚠️ 需要 Stitch API key："
  echo "       1. 浏览器打开 https://stitch.withgoogle.com 并登录"
  echo "       2. 点头像 → Stitch Settings → API key → Create key"
  echo "       3. 把完整 key（AQ. 开头）保存到：$KEY_FILE"
  echo "       命令：echo 'AQ.你的key' > ~/.stitch/key && chmod 600 ~/.stitch/key"
fi

echo ""
echo "✅ 安装完成！最后一步：重启 Deepseek Harness Web（dsh web），"
echo "   重启后会话标题栏会出现『AI 设计』按钮，即可使用。"
echo "   详细说明见 README.md"
