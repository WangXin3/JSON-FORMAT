# JSON FORMAT

一个完全在本机处理数据的 Windows JSON 工具。采用 Tauri 2、React、TypeScript、CodeMirror 6 和 SQLite。

## 使用

- 左侧输入原始 JSON，右侧自动显示格式化结果。按 `Ctrl+Enter` 或点击“格式化”主动处理并保存历史。
- 左侧支持在 key 或字符串内部单击定位光标、拖选部分字符、插入和删除。编辑使用原生文本选区；外部内容同步只修改差异片段，保留未受影响的光标和选区。
- “去除转义”支持 `"{\"a\":1}"` 和 `{\"a\":1}`，每次只解码一层。成功后可用撤销按钮或 `Ctrl+Z` 恢复。
- 右侧对象和数组可逐个折叠，也可全部展开、全部收起。数组收起后显示直接元素数量，例如 `[ … 12 项 ]`；嵌套数组分别计数，折叠不会影响复制的完整内容。
- “复制格式化”保留缩进与换行；“复制压缩”只删除字符串外的空白，保留字符串内部的空格及转义。
- 行号开关同时作用于两侧。支持 2 / 4 空格缩进，设置会在重启后保留。
- 历史记录支持摘要搜索、恢复、删除、清空；相同原始文本去重。最多 100 条、总内容 50 MB，超过后清理最早记录。可在偏好设置中关闭新记录保存。
- 拖动中间分隔线调整宽度，双击复位。分隔线也支持方向键调整，`Home` 复位。编辑器支持 `Ctrl+F` 查找。

默认载入示例用于体验，示例不会自动写入历史。自动预览不会产生历史记录；只有主动成功处理时保存。

## 开发与构建

需要 Node.js 22.12+、Rust stable（MSVC，本次使用 1.99.1）、Visual Studio C++ Build Tools 和 Windows SDK。运行桌面版需要 Microsoft Edge WebView2 Runtime，安装程序会检测并在缺失时下载安装。

```powershell
npm install
npm run desktop:dev
npm run desktop:build
```

Windows 构建脚本会发现现有的 Visual Studio 和 SDK，并为当前构建进程设置路径；如果项目里有 `.toolchain/cargo`、`.toolchain/rustup`，会优先使用这些项目内工具，不修改系统 PATH。

构建产物：

```text
src-tauri/target/release/json-format-desktop.exe
src-tauri/target/release/bundle/nsis/JSON FORMAT_0.1.2_x64-setup.exe
```

构建脚本也会将应用和安装包复制到项目根目录的 `release/` 文件夹，并提供带版本号的应用文件。若旧版应用仍在运行，可以直接打开带版本号的新文件，不必打断旧窗口中的编辑。

也可以仅预览界面：

```powershell
npm run dev
```

打开 <http://127.0.0.1:1420>。网页预览使用 IndexedDB，桌面应用使用 SQLite；这两处的历史和设置相互独立。

## 数据处理

- 校验使用 `jsonc-parser` 的严格 JSON 模式，拒绝注释、尾随逗号等扩展语法。
- 格式化只改空白，压缩按词法标记拼接，保留大整数、精确小数写法、重复键及键顺序。
- 格式化修改一次拼接，避免逐条修改大字符串导致平方级开销。
- 解析、转义处理和格式化在 Web Worker 中进行；300 ms 防抖，结果按请求序号检查，防止旧结果覆盖新输入。
- 默认自动预览上限 512 KB；更大的内容手动格式化。单次输入上限 10 MB。极深嵌套内容可能被处理器拒绝。
- 右侧一键收起使用完整文档的折叠范围，不依赖编辑器是否已解析到屏幕外内容。
- 无效输入会显示首个错误的行列号，右侧旧结果被清除，复制功能禁用。

桌面数据位于当前用户的应用配置目录，标识为 `com.jsonformat.desktop`，数据库文件为 `json-format.db`。不会向服务端上传 JSON。

## 验证

```powershell
npm test
npm run build
```

测试包含字符选区和光标保留、精度和词法保留、严格 JSON 校验、控制字符和路径转义、一层解码、错误定位、折叠范围、大文本处理、历史去重、容量清理、删除及设置持久化。浏览器交互另需验证 key 内字符拖选与替换、折叠、复制、错误状态和历史恢复；桌面应用另需验证 SQLite 与系统剪贴板。

## 目录

```text
src/
  App.tsx                    界面与交互
  components/JsonEditor.tsx  CodeMirror 编辑器
  components/Dialog.tsx      历史抽屉与设置弹窗
  core/json.ts               保留原始数值写法的 JSON 处理
  core/json.worker.ts        后台处理入口
  core/processor.ts          Worker 请求管理
  core/storage.ts            桌面 SQLite / 网页 IndexedDB 与剪贴板
src-tauri/                   Rust 桌面入口、权限、迁移、打包配置
scripts/desktop.ps1          Windows 构建环境准备
```
