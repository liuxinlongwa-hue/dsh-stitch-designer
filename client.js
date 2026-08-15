// Google Stitch 设计预览面板 —— Client 端
// 会话头部"AI 设计"按钮 → 弹出面板显示最新设计预览图（实时拉取 /stitch/api/state）。
// 迭代流程：在对话里提出修改需求 → 模型调 Stitch 编辑 → 面板点刷新看到新版预览。
window.__ModuleLoader__.load({
  id: 'stitch-designer',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    var CSS_ID = 'stitch-designer/panel.css';
    var css = [
      '.std-root{position:relative;display:inline-flex;align-items:center}',
      '.std-trigger{min-height:28px;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));background:transparent;color:var(--dsw-alias-label-secondary, inherit);font-size:12px;line-height:18px;cursor:pointer}',
      '.std-trigger:hover,.std-trigger:focus-visible{color:var(--dsw-alias-label-primary, inherit);background:var(--dsw-alias-fill-l2, rgba(128,128,128,.08))}',
      '.std-dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#4285F4,#34A853);flex:none}',
      '.std-panel{position:fixed;top:calc(var(--dsw-header-h, 48px) + 8px);right:16px;z-index:1000;width:min(460px, calc(100vw - 32px));max-height:min(680px, calc(100vh - 96px));display:flex;flex-direction:column;background:var(--dsw-specific-menu, #1b1b1f);border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));border-radius:12px;box-shadow:var(--dsw-shadow-lv3, 0 8px 30px rgba(0,0,0,.35));overflow:hidden}',
      '.std-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2));font-size:13px;font-weight:600}',
      '.std-head-actions{display:flex;gap:6px;align-items:center}',
      '.std-btn{padding:2px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));background:transparent;color:var(--dsw-alias-label-tertiary, inherit);font-size:12px;cursor:pointer}',
      '.std-btn:hover{color:var(--dsw-alias-label-primary, inherit)}',
      '.std-body{overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2, rgba(128,128,128,.4))}',
      '.std-meta{font-size:11px;color:var(--dsw-alias-label-tertiary, inherit);display:flex;gap:10px;flex-wrap:wrap;padding:0 2px}',
      '.std-tag{padding:1px 8px;border-radius:99px;background:var(--dsw-alias-fill-l2, rgba(128,128,128,.1));font-size:11px;color:var(--dsw-alias-label-secondary, inherit)}',
      '.std-img-wrap{display:flex;justify-content:center;background:var(--dsw-alias-fill-l2, rgba(128,128,128,.06));border-radius:10px;padding:8px;min-height:120px}',
      '.std-img{max-width:100%;max-height:min(480px, calc(100vh - 240px));border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.25)}',
      '.std-empty{padding:26px 12px;text-align:center;color:var(--dsw-alias-label-tertiary, inherit);font-size:13px;line-height:1.6}',
      '.std-hint{padding:8px 10px;border-radius:8px;background:var(--dsw-alias-fill-l2, rgba(128,128,128,.07));font-size:12px;color:var(--dsw-alias-label-secondary, inherit);line-height:1.6}',
      '.std-err{padding:10px 12px;text-align:center;color:var(--dsw-alias-danger-fg, #ef4444);font-size:12px}'
    ].join('');

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
      var tag = document.createElement('style');
      tag.dataset.plugin = 'stitch-designer';
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    function DesignerPanel(props) {
      var open = React.useState(false);
      var opened = open[0];
      var setOpened = open[1];
      var state = React.useState(null);
      var data = state[0];
      var setData = state[1];
      var err = React.useState('');
      var errorText = err[0];
      var setErr = err[1];

      function refresh() {
        setErr('');
        fetch('/stitch/api/state', { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) { if (d.ok) { setData(d); } else { setErr(d.error || '加载失败'); } })
          .catch(function (e) { setErr(String((e && e.message) || e)); });
      }

      function toggle() {
        var next = !opened;
        setOpened(next);
        if (next) refresh();
      }

      var trigger = React.createElement(
        'button',
        { className: 'std-trigger', onClick: toggle, title: 'AI 设计（Stitch 预览）', 'aria-label': 'AI 设计预览' },
        React.createElement('span', { className: 'std-dot' }),
        'AI 设计'
      );

      if (!opened) return trigger;

      var body;
      if (errorText) {
        body = React.createElement('div', { className: 'std-err' }, '加载失败: ' + errorText);
      } else if (!data) {
        body = React.createElement('div', { className: 'std-empty' }, '加载中…');
      } else {
        var last = data.screens && data.screens[0];
        var meta = React.createElement('div', { className: 'std-meta' },
          React.createElement('span', { className: 'std-tag' }, '项目 ' + String(data.projectId || '').slice(-6)),
          last ? React.createElement('span', { className: 'std-tag' }, last.deviceType || 'MOBILE') : null,
          last ? React.createElement('span', { className: 'std-tag' }, (last.width || '') + '×' + (last.height || '')) : null,
          last && last.title ? React.createElement('span', { className: 'std-tag' }, last.title) : null
        );
        var preview = last && last.preview
          ? React.createElement('div', { className: 'std-img-wrap' },
              React.createElement('img', { className: 'std-img', src: last.preview + '?t=' + Date.now(), alt: '设计预览', onClick: function () { window.open(last.preview, '_blank'); } }))
          : React.createElement('div', { className: 'std-empty' }, '还没有设计，直接在对话里告诉我需求（如：帮我设计一个回收小程序首页，APP 端）');
        var hint = React.createElement('div', { className: 'std-hint' },
          '💡 怎么用：在对话里告诉我设计需求（APP / Web / 软件界面均可）→ 生成后这里实时预览。不满意就在对话里说哪里要改（如"颜色换浅一点、品类改成四个"）→ 我改完点刷新看新版。点预览图可看大图。确定满意后我可以导出 1:1 的 HTML 成品（支持打包成 EXE）。');
        body = React.createElement(React.Fragment, null, meta, preview, hint);
      }

      return React.createElement(
        'div',
        { className: 'std-root' },
        trigger,
        React.createElement(
          'div',
          { className: 'std-panel', role: 'dialog', 'aria-label': 'AI 设计预览' },
          React.createElement(
            'div',
            { className: 'std-head' },
            React.createElement('span', null, 'AI 设计 · Stitch 预览'),
            React.createElement('span', { className: 'std-head-actions' },
              React.createElement('button', { className: 'std-btn', onClick: refresh }, '刷新'),
              React.createElement('button', { className: 'std-btn', onClick: function () { setOpened(false); } }, '关闭')
            )
          ),
          React.createElement('div', { className: 'std-body' }, body)
        )
      );
    }

    var inject = ['slots'];

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'stitch-designer',
            order: 40
          }, DesignerPanel);
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
