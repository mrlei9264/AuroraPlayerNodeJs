# Windows x64 开发环境

本文用于从源码安装或重新编译。使用已打包的应用不需要 Node.js、编译工具或单独安装 libmpv。

## 1. 准备工具和 SDK

需要 Node.js 20+、npm、Python 3，以及 Visual Studio 2022/2026 或 Build Tools。Visual Studio 中需安装“使用 C++ 的桌面开发”、MSVC x64/x86 工具集和 Windows 10/11 SDK。

准备同一套 Windows x64 libmpv SDK。本文按当前打包配置使用 `libmpv-2.dll`，目录默认如下：

```text
%USERPROFILE%/libmpv/
├─ include/mpv/
│  ├─ client.h
│  ├─ render.h
│  └─ render_gl.h
├─ lib/mpv.lib
└─ bin/
   ├─ libmpv-2.dll
   └─ 该构建附带的其他 DLL
```

`mpv.lib` 是 MSVC 导入库，不能直接用 MinGW 的 `libmpv.dll.a` 代替。头文件、导入库和 DLL 应来自匹配的 SDK，且均为 x64。

SDK 放在其他位置时，在安装依赖的同一个 PowerShell 窗口设置：

```powershell
$env:MPV_INCLUDE_DIR = 'D:/sdk/libmpv/include'
$env:MPV_LIB = 'D:/sdk/libmpv/lib/mpv.lib'
$env:MPV_RUNTIME_DIR = 'D:/sdk/libmpv/bin'
```

`MPV_INCLUDE_DIR` 指向 `include`，不是 `include/mpv`；`MPV_LIB` 指向文件；`MPV_RUNTIME_DIR` 指向包含全部配套 DLL 的目录。环境变量默认仅对当前终端有效。

## 2. 安装并启动

在工程根目录执行：

```powershell
npm install
npm run dev
```

根项目的 `postinstall` 会应用 `patches/`、补充 node-gyp 的 VS 2026/v145 识别，再重建 mpv 插件。Python 优先使用 `PYTHON` / `NODE_GYP_FORCE_PYTHON`；均未设置时，尝试使用已有的 `.tools/python-3.13/python.exe`。

### 缺少 mpv.lib，或安装提前卡在原生编译

在 Visual Studio 的 **x64 开发者 PowerShell** 中分步执行。先设置上面的 SDK 路径，再运行：

```powershell
# 仅展开依赖，暂不执行任何安装脚本
npm install --ignore-scripts

# 仅在缺少 mpv.lib 时执行；需要 dumpbin.exe 和 lib.exe
powershell -ExecutionPolicy Bypass -File ./node_modules/electron-mpv-video/scripts/create-libmpv-import-lib.ps1

# 先应用项目补丁和 VS 兼容处理，再编译 mpv
npm run tool -- postinstall

# 补跑此前跳过的依赖安装脚本，包括 Electron 和 FFmpeg 下载
npm rebuild
npm run dev
```

已有 `mpv.lib` 时跳过生成导入库的那一行。VS 2026 的依赖安装若在根项目 `postinstall` 之前就触发 node-gyp，也可采用这组步骤。

## 3. 重建与产物

更换 Electron、原生依赖、libmpv SDK、架构或编译工具，或修改原生补丁后，执行：

```powershell
npm run mpv:rebuild
```

仅修改 React、CSS 或普通 TypeScript 时，无需重编译原生插件。

开发产物位于 `node_modules/electron-mpv-video/native/mpv-addon/build/Release/`，应包含 `mpv_addon.node`、`libmpv-2.dll` 和 SDK 配套 DLL。可查看目录：

```powershell
Get-ChildItem node_modules/electron-mpv-video/native/mpv-addon/build/Release
```

打包时不会自动重建原生依赖。`electron-builder.json` 使用 `npmRebuild: false`，并将原生插件和 libmpv DLL 放入 `resources/app.asar.unpacked/`。EXE 图标与版本资源由统一工具的 `afterPack` 写入；这一步不等于代码签名。

安装包、便携版和发布操作见 [工程工具](tooling.md#打包与发布)。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 找不到 Visual Studio | 安装 C++ 工作负载、MSVC 和 SDK；VS 2026 提前编译失败时使用上面的分步安装 |
| 找不到 headers / import library / runtime DLL | 检查当前终端的三个 `MPV_*` 路径和文件是否存在 |
| `The specified module could not be found` | 除 `.node` 外，还需检查它旁边的 libmpv 及间接依赖 DLL；可用 `dumpbin /dependents` 查看 |
| `%1 is not a valid Win32 application` | 检查是否混用了 x86/x64 文件 |
| `NODE_MODULE_VERSION` 不匹配 | 使用当前开发环境执行 `npm run mpv:rebuild` |
| 补丁应用失败 | 确认依赖版本与 lockfile 一致；不要将旧补丁强行应用到新依赖版本 |
| ffprobe 无结果、轨道信息为空 | 查看 `data/logs/aurora.log` 的 `probe` 日志；远程文件还需检查来源连接 |
| 截帧报 `spawn ...ffmpeg.exe ENOENT` | 缺少 FFmpeg 二进制。执行 `npm rebuild ffmpeg-static` 补装；修复后重新生成缩略图 |
| 拼接图报 `Stream ends prematurely` / `partial file` | 查看同条日志的 `remoteBytes` 和读取限额说明；也可能是来源连接中断，不能仅凭此错误认定视频损坏 |

环境快速检查命令为 `npm run doctor`。它检查文件和版本状态，不替代实际编译或播放验证。
