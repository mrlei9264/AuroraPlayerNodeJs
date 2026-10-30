# Aurora Player

基于 Electron、React 和 libmpv 的桌面媒体播放器。当前维护 **Windows x64** 的开发和发布流程。

![Aurora Player](docs/assets/aurora-player-hero.png)

## 功能

- 播放本地与网络视频、音频和图片，支持字幕、多轨道、章节和进度记忆。
- 管理媒体库、合集、播放列表和收藏。
- 浏览 HTTP/HTTPS、WebDAV、SMB、FTP/FTPS、SFTP 来源，导入媒体或下载文件。
- 内置 FFmpeg/FFprobe，用于媒体信息探测和视频封面生成。

## 从源码运行

先按 [开发环境配置](docs/libmpv-runtime.md) 准备 Node.js、C++ 编译工具、Python 和 libmpv SDK，再在工程根目录执行：

```powershell
npm install
npm run dev
```

安装会自动应用依赖补丁并编译 mpv 插件。渲染进程支持热更新；修改主进程或 Preload 后需重启开发命令。

## 常用命令

所有工程命令统一由 [scripts/tool.mjs](scripts/tool.mjs) 执行。

| 目的 | 命令 |
| --- | --- |
| 增量构建 | `npm run build` |
| 完整构建 JS 和静态资源 | `npm run build:full` |
| 同时重建 mpv 插件 | `npm run build:full -- --native` |
| 生成安装包 | `npm run dist` |
| 生成便携版 | `npm run dist:portable` |
| 准备本地发布产物和校验文件 | `npm run release` |
| 查看全部参数 | `npm run tool -- --help` |

默认打包产物位于 `release/<版本>-<目标>/`。已有非空输出目录不会被覆盖。源码补丁、软件差分包和 GitHub 发布的操作步骤见 [工程工具](docs/tooling.md)。

## 文档与目录

| 文档 | 内容 |
| --- | --- |
| [开发环境配置](docs/libmpv-runtime.md) | SDK 路径、原生构建与常见安装错误 |
| [工程工具](docs/tooling.md) | 构建、补丁、差分包、版本与发布 |
| [软件架构](docs/architecture.md) | 模块职责、播放流程与数据存储 |

```text
src/main       主进程：媒体库、网络、下载和系统服务
src/preload    界面与主进程之间的 API 桥接
src/renderer   React 页面、播放界面与样式
src/shared     IPC 名称与共享类型
scripts        统一工程工具
docs           项目文档
```

开发版的数据保存在工程根目录的 `data/`，打包版保存在应用 EXE 所在目录的 `data/`。应用目录需可写。原始媒体不会迁入该目录。备份个人设置和媒体库时，先退出应用，再复制整个 `data/`。

## 许可与第三方名称

项目源码使用 [MIT License](LICENSE)。libmpv、FFmpeg/FFprobe 等第三方组件按各自许可证分发；`ffmpeg-static` 标注为 GPL-3.0-or-later。发布安装包时，应保留第三方许可，并按实际二进制的许可处理相应源码提供要求。

Dolby、DTS 等名称仅用于描述媒体格式，不代表认证、合作或背书。本项目不包含其 Logo；加入第三方 Logo 或认证标识前需取得相应授权。相关名称归各自权利人所有，参见 [Dolby 许可说明](https://professional.dolby.com/licensing/)与 [DTS 条款](https://dts.com/terms-conditions/)。
