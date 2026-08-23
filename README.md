# Aurora Player

Aurora Player 是一款基于 Electron、React 和 libmpv 的桌面媒体播放器，用于统一浏览和播放本地媒体与网络媒体。

![Aurora Player](docs/assets/aurora-player-hero.png)

## 功能简介

- 播放视频、音频和图片，支持播放进度记忆、章节、字幕与多轨道。
- 管理本地媒体库、合集、播放列表和最近播放记录。
- 浏览 HTTP/HTTPS、WebDAV、SMB、FTP/FTPS、SFTP 网络媒体。
- 支持网络文件与目录下载、暂停继续、多线程和限速。
- 读取媒体标签及同目录 NFO，并可从配置的来源获取视频信息。
- 安装包内置 FFmpeg/FFprobe，用于媒体探测和封面截取，不要求系统额外安装。
- 提供主题、字号、中英文、通知中心和性能 HUD 等界面设置。

## 快速开始

运行环境需要 Node.js 20 以上版本。视频播放依赖与当前平台、架构匹配的 libmpv SDK；首次安装前请先阅读 [libmpv 部署说明](docs/libmpv-runtime.md)。

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建应用
npm run dist       # 生成安装包
```

## 项目文档

- [软件架构与 Mermaid 架构图](docs/architecture.md)
- [libmpv 开发与发布部署](docs/libmpv-runtime.md)

## 主要目录

```text
src/main       Electron 主进程、媒体库、网络协议和系统服务
src/preload    主进程与界面之间的安全桥接
src/renderer   React 页面、播放器和界面样式
src/shared     IPC 通道及共享类型
scripts        开发、构建和原生模块脚本
docs           项目说明文档
```

应用运行数据保存在程序目录下的 `data/`，包括设置、媒体库数据库、凭据、日志、下载文件和临时封面。打包结果输出到 `release/`。

安装包内的 FFmpeg/FFprobe 是独立的第三方运行时，不属于本项目 MIT 代码；分发前请同时保留并核对 `ffmpeg-static` 所附的 GPL-3.0-or-later 许可及其他第三方声明。

## License

MIT
