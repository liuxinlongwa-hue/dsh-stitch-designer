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
      '.std-select{padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));background:var(--dsw-specific-menu, #1b1b1f);color:var(--dsw-alias-label-primary, inherit);font-size:12px;line-height:18px;max-width:100%}',
      '.std-body{overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2, rgba(128,128,128,.4))}',
      '.std-meta{font-size:11px;color:var(--dsw-alias-label-tertiary, inherit);display:flex;gap:10px;flex-wrap:wrap;padding:0 2px}',
      '.std-tag{padding:1px 8px;border-radius:99px;background:var(--dsw-alias-fill-l2, rgba(128,128,128,.1));font-size:11px;color:var(--dsw-alias-label-secondary, inherit)}',
      '.std-img-wrap{display:flex;justify-content:center;background:var(--dsw-alias-fill-l2, rgba(128,128,128,.06));border-radius:10px;padding:8px;min-height:120px}',
      '.std-img{max-width:100%;max-height:min(480px, calc(100vh - 240px));border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.25)}',
      '.std-thumbs{display:flex;gap:8px;overflow-x:auto;padding:2px 0;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2, rgba(128,128,128,.4))}',
      '.std-thumb{width:56px;height:96px;object-fit:cover;border-radius:6px;border:2px solid transparent;cursor:pointer;flex:none;opacity:.75;transition:opacity .15s}',
      '.std-thumb:hover{opacity:1}',
      '.std-thumb-on{border-color:var(--dsw-alias-accent, #4285F4);opacity:1}',
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
      var sel = React.useState('');
      var selectedId = sel[0];
      var setSelectedId = sel[1];
      var idx = React.useState(0);
      var currentIdx = idx[0];
      var setCurrentIdx = idx[1];

      function refresh(projectId) {
        setErr('');
        var q = projectId ? ('?projectId=' + encodeURIComponent(projectId)) : '';
        fetch('/stitch/api/state' + q, { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) {
            if (d.ok) {
              setData(d);
              if (d.projectId) setSelectedId(d.projectId);
            } else { setErr(d.error || '加载失败'); }
          })
          .catch(function (e) { setErr(String((e && e.message) || e)); });
      }

      function toggle() {
        var next = !opened;
        setOpened(next);
        if (next) refresh();
      }

      function onProjectChange(e) {
        var pid = e && e.target ? e.target.value : e;
        if (!pid) return;
        setSelectedId(pid);
        setCurrentIdx(0);
        refresh(pid);
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
        // 项目切换器
        var projectOptions = (data.projects || []).map(function (p) {
          return React.createElement('option', { key: p.id, value: p.id },
            (p.title || ('项目 ' + String(p.id).slice(-6))) + (p.id === data.projectId ? ' ✓' : ''));
        });
        var projectPicker = React.createElement('div', { className: 'std-meta', style: { alignItems: 'center', gap: 6 } },
          React.createElement('span', { className: 'std-tag' }, '项目'),
          React.createElement('select', {
            className: 'std-select',
            value: selectedId || data.projectId || '',
            onChange: onProjectChange,
            style: { flex: 1, minWidth: 0 }
          },
            React.createElement('option', { value: '' }, '选择项目…'),
            projectOptions
          )
        );
        var screens = data.screens || [];
        var total = screens.length;
        var cur = currentIdx < total ? screens[currentIdx] : screens[0];
        var meta = React.createElement('div', { className: 'std-meta' },
          React.createElement('span', { className: 'std-tag' }, data.projectTitle || ('项目 ' + String(data.projectId || '').slice(-6))),
          total > 0 ? React.createElement('span', { className: 'std-tag' }, '共 ' + total + ' 张') : null,
          cur ? React.createElement('span', { className: 'std-tag' }, cur.deviceType || 'MOBILE') : null,
          cur ? React.createElement('span', { className: 'std-tag' }, (cur.width || '') + '×' + (cur.height || '')) : null,
          cur && cur.title ? React.createElement('span', { className: 'std-tag' }, cur.title) : null
        );
        var preview;
        if (cur && cur.preview) {
          preview = React.createElement('div', { className: 'std-img-wrap' },
            React.createElement('img', { className: 'std-img', src: cur.preview + '?t=' + Date.now(), alt: '设计预览', onClick: function () { window.open(cur.preview, '_blank'); } }));
        } else {
          preview = React.createElement('div', { className: 'std-empty' },
            '该项目还没有设计。在对话里告诉我需求（如：帮我设计一个回收小程序首页，APP 端）→ 生成后这里实时预览。或在上方切换查看其他项目。');
        }
        // 缩略图条（多图）
        var thumbs = null;
        if (total > 1) {
          thumbs = React.createElement('div', { className: 'std-thumbs' },
            screens.map(function (s, i) {
              var cls = 'std-thumb' + (i === currentIdx ? ' std-thumb-on' : '');
              return React.createElement('img', {
                key: s.id || i,
                className: cls,
                src: s.preview + '?t=' + Date.now(),
                alt: s.title || ('设计 ' + (i + 1)),
                onClick: function () { setCurrentIdx(i); }
              });
            })
          );
        }
        var actions = null;
        if (cur && cur.htmlUrl) {
          actions = React.createElement('div', { className: 'std-meta', style: { marginTop: 4 } },
            React.createElement('button', {
              className: 'std-btn',
              onClick: function () {
                fetch('/stitch/api/html/' + cur.id, { cache: 'no-store' })
                  .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
                  .then(function (d) {
                    if (d.ok && d.html) { window.open(d.html, '_blank'); }
                    else { alert('导出失败: ' + (d.error || '未知错误')); }
                  })
                  .catch(function (e) { alert('导出失败: ' + ((e && e.message) || e)); });
              }
            }, '📄 导出 1:1 HTML 源码'),
            React.createElement('button', { className: 'std-btn', onClick: function () { window.open(cur.preview, '_blank'); } }, '🔍 查看大图')
          );
        }
        var hint = React.createElement('div', { className: 'std-hint' },
          '💡 怎么用：在对话里告诉我设计需求（APP / Web / 软件界面均可）→ 生成后这里实时预览。不满意就在对话里说哪里要改（如"颜色换浅一点、品类改成四个"）→ 我改完点刷新看新版。每个设计都自带 1:1 HTML 源码（可直接开发/打包 EXE），点上方"导出 HTML 源码"即可获取；需要转成微信小程序或 Vue 也可以直接告诉我。');
        body = React.createElement(React.Fragment, null, projectPicker, meta, preview, thumbs, actions, hint);
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
              React.createElement('button', { className: 'std-btn', onClick: function () { refresh(selectedId || data && data.projectId); } }, '刷新'),
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
