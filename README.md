# deepseek-harness-pdf-read · dsh-file-toolkit

DeepSeek Harness 侧栏的两个能力已经合并成一个插件 **`dsh-file-toolkit`**：

1. **PDF 预览**：用浏览器原生查看器（PDFium）渲染，字体密集的 LaTeX 文档也秒开；带查找与高亮。
2. **文件树右键菜单**：复制路径、复制/粘贴文件、打开、在资源管理器显示、重命名、新建文件夹、删除到回收站。

> DSH plugin that renders sidebar PDFs with the native viewer (plus highlighted search) and adds a file-tree context menu.

## 功能

### PDF

- 原生渲染：`<iframe>` + blob，Chromium PDFium 绘制，自带页面缓存；
- **查找**：右下角「查找」按钮，或 `Ctrl+F` / `Cmd+F` / `F3`（PDF 获得焦点时也生效）；
- **高亮**：搜索时 Host 用 PyMuPDF 生成一份带黄色高亮注释的副本交给原生查看器，`‹ ›` 在命中页之间跳转，「清除」回到无高亮版本；
- 不修改原文件，高亮副本只存在于内存。

### 文件树右键

| 菜单项 | 行为 |
|---|---|
| 打开 / 打开文件夹 | 系统默认程序 |
| 在资源管理器中显示 | `explorer /select` |
| 复制绝对路径 / 相对路径 / 文件名 | 写入剪贴板 |
| 复制文件 | 真正的文件剪贴板，可在资源管理器直接粘贴 |
| 粘贴文件到此 | 逐项复制，目标重名自动 `_copy`、`_copy1`…；源已删除则跳过并计数 |
| 新建文件夹… | 重名自动 `新建文件夹 2` |
| 重命名… | 页内输入框（Electron 没有 `window.prompt`） |
| 删除（移到回收站） | 二次确认 + `Microsoft.VisualBasic.FileIO` 回收站删除 |

## 安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：备份 profile 的 `package.json` → 复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-file-toolkit` → 写入 `dependencies` 与 `dsh.profile.bundles` → **移除旧的两个插件**（`dsh-pdf-native`、`dsh-copy-path`）。

然后**完全退出并重启 DSH**（Host 侧新增了 RPC 路由，刷新页面不够）。

卸载：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

## 实现

DSH 的两个扩展点：

- **PDF**：`documentPreviews.register({ id, extensions:["pdf"], priority:"external", loading:"bytes-complete" })`，正文注册在 keyed 槽位 `sidebar.right.tab.document`；`priority` 非 `builtin` 的实现排在前面。
- **文件树**：行上已有 `data-files-entry` / `data-files-path`，容器有 `data-files-root`；捕获阶段监听 `contextmenu` 即可。

Host 注册两条本机 RPC：

```
POST /dsh-pdf-native/rpc   { action: "searchPdf" | "highlightPdf", data, query }
POST /dsh-copy-path/rpc    { action: "copyFiles" | "pasteFiles" | "reveal" | "open" | "delete" | "rename" | "mkdir" }
```

PDF 文本索引与高亮由 **PyMuPDF** 完成（`python -c`，UTF-16 参数，编码问题已处理）；文件操作由 PowerShell 完成（`-Command` 单参数，避免转义）。

## 限制

- 查找是“所有命中同时高亮 + 按页跳转”，不是原生查看器那种逐条高亮；每次搜索会重建带注释副本（约 0.5 s）。
- 复制/粘贴/删除依赖 Windows PowerShell 与 `Microsoft.VisualBasic`；macOS/Linux 需要另写分支。
- 查找/highlight 依赖本机 Python + PyMuPDF。
- 菜单文案目前只有中文。

## License

MIT
