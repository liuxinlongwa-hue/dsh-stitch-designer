#!/usr/bin/env bash
# =============================================================
# dsh-stitch-designer 一键安装脚本（macOS / Linux）
#   Google Stitch AI 设计预览插件 for DeepSeek Harness (DSH)
#
# 用法：  bash install.sh                 # 安装
#        bash install.sh --uninstall      # 卸载
# =============================================================
set -euo pipefail

ACTION="${1:-install}"

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
PKG_NAME="stitch-designer"

echo "==> dsh-stitch-designer install script"
echo "    DSH_HOME: $DSH_HOME / profile: $PROFILE"

# -------------------------------------------------------------
# 卸载
# -------------------------------------------------------------
if [ "$ACTION" = "--uninstall" ] || [ "$ACTION" = "uninstall" ]; then
  echo "==> 卸载插件"
  PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
  if [ -f "$PATCH" ]; then
    python3 - "$PATCH" <<'PY' 2>/dev/null || true
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
lines = s.splitlines(keepends=True)
out, skip = [], False
for ln in lines:
    if skip:
        if ln.strip() == '- insert:':
            skip = False
        continue
    out.append(ln)
    if 'stitch-designer' in ln:
        while out and not out[-1].strip().startswith('- insert:'):
            out.pop()
        if out and out[-1].strip().startswith('- insert:'):
            out.pop()
        skip = True
open(p, 'w', encoding='utf-8').writelines(out)
print('    已从 cordis.patch.yml 移除 stitch-designer')
PY
  fi
  rm -rf "$DSH_HOME/profiles/$PROFILE/node_modules/$PKG_NAME"
  find "$HOME/.npm/_npx" -maxdepth 3 -name "$PKG_NAME" -type l -delete 2>/dev/null || true
  echo "✅ 已卸载。重启 DSH 后生效。"
  exit 0
fi

# -------------------------------------------------------------
# 安装
# -------------------------------------------------------------
echo "==> 1/4 复制插件到 DSH profile node_modules"
PKG_DIR="$DSH_HOME/profiles/$PROFILE/node_modules/$PKG_NAME"
mkdir -p "$PKG_DIR"
cp plugin.js client.js package.json "$PKG_DIR/"
echo "    -> $PKG_DIR"

echo "==> 2/4 建立 npx 缓存符号链接（loader 解析需要）"
NPX_ROOT=$(ls -dt "$HOME/.npm/_npx"/*/node_modules 2>/dev/null | head -1 || true)
if [ -z "$NPX_ROOT" ]; then
  echo "    警告：未找到 npx 缓存目录，跳过 symlink（DSH 若无法加载插件请手动处理）"
else
  ln -sfn "$PKG_DIR" "$NPX_ROOT/$PKG_NAME"
  echo "    symlink -> $NPX_ROOT/$PKG_NAME"
fi

echo "==> 3/4 写入 cordis.patch.yml（组合挂载）"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
if grep -q "$PKG_NAME" "$PATCH" 2>/dev/null; then
  echo "    cordis.patch.yml 已包含 $PKG_NAME，跳过"
else
  cat >> "$PATCH" <<EOF

# ── dsh-stitch-designer（Google Stitch AI 设计预览插件）────────────────
- insert:
    - id: stitch-designer
      name: 'stitch-designer'
EOF
  echo "    已追加到 cordis.patch.yml"
fi

echo "==> 4/4 检查 Stitch API key"
KEY_FILE="$HOME/.stitch/key"
if [ -f "$KEY_FILE" ] && [ -s "$KEY_FILE" ]; then
  echo "    API key 已存在：$KEY_FILE"
else
  echo "    ⚠️ 需要 Stitch API key（免费，每日 400 额度）："
  echo "       1. 浏览器打开 https://stitch.withgoogle.com 并登录"
  echo "       2. 点头像 → Stitch Settings → API key → Create key"
  echo "       3. 保存完整 key（AQ. 开头）："
  echo "          echo 'AQ.你的key' > ~/.stitch/key && chmod 600 ~/.stitch/key"
fi

echo ""
echo "✅ 安装完成！最后一步：重启 Deepseek Harness Web（dsh web），"
echo "   重启后会话标题栏出现『AI 设计』按钮即可使用。"
echo "   详细说明见 README.md；卸载：bash install.sh --uninstall"
