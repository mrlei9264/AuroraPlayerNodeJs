# libmpv 部署说明

Aurora Player 通过 `electron-mpv-video` 的原生 Node 插件调用 libmpv。libmpv 负责解封装、音视频解码、字幕、缓存和播放时钟；Electron 负责窗口、界面和画面呈现。

项目不会在播放时启动 FFmpeg CLI 转码。安装包内置 `ffprobe` 和 `ffmpeg`，仅用于媒体信息探测及视频封面截取，与 libmpv 播放运行时相互独立；开发环境如果内置二进制不存在，程序才会回退到系统 `PATH`。

## 部署结构

原生播放运行时由三部分组成：

```text
mpv_addon.node       针对当前 Electron ABI 构建的原生插件
libmpv-2.dll         Windows libmpv 运行库
其他依赖 DLL         所选 libmpv 构建附带的运行库
```

这些文件必须具有相同架构，并在运行时位于同一目录。项目安装脚本会将它们集中到：

```text
node_modules/electron-mpv-video/native/mpv-addon/build/Release/
```

当前项目仅支持 Windows x64。其他桌面平台没有维护可用的原生构建和发布流程。

## Windows x64 部署

### 1. 安装构建工具

安装以下组件：

- Node.js 20 或更高版本，推荐 Node.js 22。
- Python 3，供 node-gyp 使用。
- Visual Studio 2022/2026 或 Visual Studio Build Tools。
- “使用 C++ 的桌面开发”工作负载。
- 对应的 MSVC x64/x86 工具集和 Windows 10/11 SDK。

项目的 `scripts/patch-node-gyp-vs2026.mjs` 会为 `electron-mpv-video` 自带的 node-gyp 增加 Visual Studio 2026 与 v145 工具集识别。若存在 `.tools/python-3.13/python.exe`，`scripts/rebuild-mpv.mjs` 会优先使用该 Python。

可在 Visual Studio Installer 中确认 C++ 工作负载，也可在 “x64 Native Tools Command Prompt” 中检查：

```powershell
where.exe cl
where.exe link
where.exe dumpbin
```

### 2. 准备 libmpv SDK

下载 Windows x64 的 libmpv 开发包。开发包必须至少包含：

- `mpv/client.h`
- `mpv/render.h`
- `mpv/render_gl.h`
- `libmpv-2.dll` 或 `mpv-2.dll`
- 与 DLL 匹配的 MSVC 导入库 `mpv.lib`

默认目录如下：

```text
%USERPROFILE%\libmpv\
├─ include\
│  └─ mpv\
│     ├─ client.h
│     ├─ render.h
│     └─ render_gl.h
├─ lib\
│  └─ mpv.lib
└─ bin\
   ├─ libmpv-2.dll
   └─ 其他随构建提供的 DLL
```

不要混用不同架构或不同版本 SDK 的头文件、导入库和 DLL。

### 3. 没有 mpv.lib 时生成导入库

部分 mpv 开发包只提供 MinGW 的 `libmpv.dll.a`，但项目通过 MSVC 构建，需要 `mpv.lib`。首次准备环境时可执行：

```powershell
# 先安装依赖文件，但暂不运行原生安装脚本
npm install --ignore-scripts

# 在 Visual Studio x64 Native Tools Command Prompt 中执行
powershell -ExecutionPolicy Bypass `
  -File .\node_modules\electron-mpv-video\scripts\create-libmpv-import-lib.ps1
```

辅助脚本使用 `dumpbin.exe` 读取 DLL 导出表，并使用 `lib.exe` 生成 `%USERPROFILE%\libmpv\lib\mpv.lib`。完成后运行正常安装流程：

```powershell
npm install
```

### 4. 使用自定义 SDK 目录

在运行 `npm install` 或 `npm run mpv:rebuild` 的同一个终端中设置：

```powershell
$env:MPV_INCLUDE_DIR = 'D:\sdk\libmpv\include'
$env:MPV_LIB = 'D:\sdk\libmpv\lib\mpv.lib'
$env:MPV_RUNTIME_DIR = 'D:\sdk\libmpv\bin'

npm install
```

变量含义：

| 变量 | 要求 |
| --- | --- |
| `MPV_INCLUDE_DIR` | 目录内必须存在 `mpv/client.h` 等头文件 |
| `MPV_LIB` | `mpv.lib` 的完整文件路径 |
| `MPV_RUNTIME_DIR` | 包含 libmpv DLL 及其依赖 DLL 的目录 |

### 5. 原生模块构建过程

项目的 `postinstall` 执行：

```text
patch-package
└─ npm run mpv:rebuild
   ├─ patch-node-gyp-vs2026.mjs
   └─ rebuild-mpv.mjs
      └─ npm rebuild electron-mpv-video
```

`electron-mpv-video` 随后会：

1. 验证头文件、`mpv.lib` 和运行库目录。
2. 使用 node-gyp 为当前 Electron/Node ABI 构建 `mpv_addon.node`。
3. 将运行库目录中的所有 DLL 复制到原生插件旁。

仅在更换 Electron、Node ABI、Visual Studio 工具集、libmpv SDK 或原生补丁后需要手动重建：

```powershell
npm run mpv:rebuild
```

### 6. 检查开发部署结果

```powershell
$runtime = 'node_modules\electron-mpv-video\native\mpv-addon\build\Release'
Get-ChildItem $runtime
```

至少应看到：

```text
mpv_addon.node
libmpv-2.dll
```

若 libmpv 构建还依赖其他 DLL，也应出现在该目录。随后可运行：

```powershell
npm run dev
```

## 打包部署

`electron-builder.json` 包含两个关键设置：

```json
{
  "npmRebuild": false,
  "asarUnpack": [
    "node_modules/electron-mpv-video/native/mpv-addon/build/Release/**/*"
  ]
}
```

Windows 打包设置 `win.signAndEditExecutable: false`，避免 electron-builder 下载并解压包含符号链接的 `winCodeSign` 工具包。项目通过 `scripts/after-pack.mjs` 调用独立的 `rcedit`，将 ICO 图标写入打包后的应用 EXE，因此普通终端也能生成图标正确的安装版和免安装版。正式代码签名仍需另行配置证书与签名流程。

- `npmRebuild: false`：避免 electron-builder 再次重建全部生产依赖。libmpv 插件已经由 `postinstall` 按当前 Electron ABI 构建；重复重建还会错误触发 SFTP 的可选 `cpu-features` 模块。
- `asarUnpack`：原生插件和动态库不能直接从 `app.asar` 加载，必须保留在 `app.asar.unpacked` 中。

执行：

```powershell
npm run dist
```

Windows 解包应用中的最终位置应为：

```text
release\win-unpacked\resources\app.asar.unpacked\node_modules\
  electron-mpv-video\native\mpv-addon\build\Release\
  ├─ mpv_addon.node
  ├─ libmpv-2.dll
  └─ 其他依赖 DLL
```

可以在发布前检查：

```powershell
Get-ChildItem `
  'release\win-unpacked\resources\app.asar.unpacked\node_modules\electron-mpv-video\native\mpv-addon\build\Release'
```

发布应用不依赖用户机器的 `%USERPROFILE%\libmpv` 或系统 `PATH`；所需 DLL 必须已随安装包部署。

## CI 构建建议

CI 机器应在安装 npm 依赖前完成以下准备：

1. 安装目标平台原生编译工具。
2. 下载并校验固定版本的 libmpv SDK。
3. 设置 `MPV_INCLUDE_DIR`、`MPV_LIB`、`MPV_RUNTIME_DIR`。
4. 执行 `npm ci`，确认 `postinstall` 成功。
5. 检查 `build/Release` 中的原生插件和运行库。
6. 执行 `npm run dist`。

不要在一台机器上构建另一种架构的插件后直接复制使用；`mpv_addon.node`、Electron 和 libmpv 必须平台及架构一致。

## 常见错误

### Could not find any Visual Studio installation to use

node-gyp 没有找到可用的 C++ 工具链。确认已安装“使用 C++ 的桌面开发”、MSVC 工具集和 Windows SDK，然后在新的终端中重试。Visual Studio 2026 还需要确保 `npm run mpv:rebuild` 前已执行项目的兼容补丁脚本；项目命令会自动执行。

若错误模块是 `cpu-features` 且发生在 `npm run dist`，应确认 electron-builder 实际加载的是本项目的 `electron-builder.json`，日志中应出现：

```text
skipped dependencies rebuild  reason=npmRebuild is set to false
```

### libmpv headers、import library 或 runtime DLL not found

SDK 目录结构不正确，或者环境变量只在另一个终端中设置。逐项检查三个路径，并确认 `MPV_INCLUDE_DIR` 指向 `include` 而不是 `include/mpv`。

### The specified module could not be found

这不一定表示 `mpv_addon.node` 不存在，通常是插件旁缺少 libmpv 或其间接依赖 DLL。使用 `dumpbin /dependents libmpv-2.dll` 或依赖查看工具检查缺失项，并把同一 libmpv 构建附带的 DLL 一并放入 `Release` 目录。

### %1 is not a valid Win32 application

通常是架构不一致，例如 x64 Electron 加载了 x86 DLL，或插件不是为当前 Electron ABI 构建。清理原生模块构建目录后使用正确 SDK 重新执行 `npm run mpv:rebuild`。

### NODE_MODULE_VERSION 不匹配

原生插件是为另一个 Node/Electron ABI 编译的。不要使用普通 Node.js 进程构建后直接复制，重新执行项目提供的 `npm run mpv:rebuild`。

### DEP0060 或 DEP0190 警告

这些通常来自 node-gyp/electron-builder 的依赖链，属于工具弃用警告。只要后续没有构建错误，它们不会阻止 libmpv 部署；升级构建依赖后可再消除。

## 分发许可

libmpv 及其链接的 FFmpeg/编解码库不是本项目源码的一部分。当前项目还通过 `ffmpeg-static` 和 `ffprobe-static` 将媒体探测工具随应用分发；其中 `ffmpeg-static` 包含 GPL-3.0-or-later 许可的 FFmpeg 二进制。分发安装包前应核对实际二进制构建的 GPL/LGPL 许可、第三方声明和源码提供义务，并随产品提供适用的许可证文件。
