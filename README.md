# deepseek-harness-pdf-read

把 **DeepSeek Harness（DSH）右侧栏的 PDF 预览** 换成浏览器原生 PDF 查看器（Chromium / PDFium）渲染，替代内置的 pdf.js。

> DSH plugin that renders sidebar PDF previews with the browser's native PDF viewer instead of pdf.js.

## 为什么

DSH 侧栏原本用 pdf.js 逐页渲染，并额外构建文本层、注册嵌入字体。对字体密集的 LaTeX 文档（数学/物理讲义、公式多、每页十几个字体子集），单页要几十到几百毫秒，翻页和回翻都有明显等待。

浏览器原生查看器是 C++ 实现，只做光栅化，并且自己缓存已渲染页面，同样的文件基本是秒开。本插件把 PDF 字节直接交给它。

## 效果

- 侧栏 PDF 变成**浏览器自带的 PDF 工具栏**（页码、缩放、下载、打印）
- 翻页 / 回翻不再重新排版，直接出图
- 内置 pdf.js 实现保持原样，插件卸载即回退

## 安装

需要 DSH Desktop，且 profile 位于默认路径（`%USERPROFILE%\.dsh\profiles\desktop`）。

```powershell
git clone https://github.com/jack851-web/deepseek-harness-pdf-read.git
cd deepseek-harness-pdf-read
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

然后**完全退出并重启 DSH**（插件在启动时加载，刷新页面不够）。

`install.ps1` 会：

1. 备份 profile 的 `package.json`；
2. 把插件复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-pdf-native`；
3. 在 profile 的 `dependencies` 和 `dsh.profile.bundles` 写入 `dsh-pdf-native`。

手动安装等价于上面三步，插件目录放在 `node_modules/dsh-pdf-native`。

## 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

重启 DSH 后回到内置 pdf.js 渲染器。若插件导致 DSH 无法启动，编辑
`%USERPROFILE%\.dsh\profiles\desktop\package.json`，删掉 `"dsh-pdf-native"`
两处（`dependencies` 与 `dsh.profile.bundles`），并删除
`node_modules\dsh-pdf-native`，即可恢复。

## 原理

DSH 侧栏正文由 `documentPreviews` 注册表 + keyed 槽位分发：

1. 注册表按 `rank = priority === "builtin" ? 0 : 1` 排序，任何非 `builtin` 的实现排在前面；
2. 本插件注册 id `dsh-pdf-native/pdf`、`priority: "external"`，声明 `extensions: ["pdf"]`、`loading: "bytes-complete"`；
3. 侧栏用实现 id 作为 key 渲染 `sidebar.right.tab.document` 槽位；
4. 正文组件把完整字节包成 `Blob` → `URL.createObjectURL` → `<iframe>`，交给原生查看器。

全部逻辑在 `lib/client.js`（浏览器端预构建产物），Host 端 `lib/index.js` 是空实现，不改 DSH 本体。

## 限制

- 依赖页面允许 `blob:` 进入 iframe。若某些版本白屏，需要改成 Host 侧签名路由（类似 `@crosery/dsh-viewer` 的做法）。
- 只覆盖侧栏 PDF 正文；聊天里的文件卡片由 `@crosery/dsh-viewer` 处理，本来就是原生渲染。
- 原生查看器不提供"记住阅读位置/自定义翻页按钮"，这些要另做外层控件。

## 兼容性

在 Windows + DSH Desktop（内置 pdf.js 6.3.289 的版本）上验证。

## License

MIT
