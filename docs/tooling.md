# 工程工具

统一入口为 `scripts/tool.mjs`。下面的命令在工程根目录执行，所有路径参数也相对于工程根目录；带空格的路径加引号。

```powershell
npm run tool -- --help
npm run tool -- build --dry-run
```

`--dry-run` 只展示计划，不修改文件或执行构建、安装、发布。新增参数放在 npm 命令的 `--` 后面。

## 构建与清理

| 目的 | 命令 |
| --- | --- |
| 启动开发版 | `npm run dev` |
| 启动已有生产构建 | `npm start` |
| 增量构建全部应用代码 | `npm run build` |
| 清理旧产物后完整构建 | `npm run build:full` |
| 完整构建并重编译 mpv | `npm run build:full -- --native` |
| 仅构建主进程 / 渲染进程 | `npm run build:main` / `npm run build:renderer` |
| 仅构建 Preload | `npm run tool -- build --scope preload` |
| 检查环境 / 版本 | `npm run doctor` / `npm run version:check` |
| 显式检查 TypeScript | `npm run typecheck` |
| 清理构建产物和缓存 | `npm run clean` |

增量构建比较源码与产物哈希，缺失或被修改的产物会重建。记录位于 `.cache/aurora-tool/build.json`。`--full` 不重装依赖；只有加 `--native` 才重编译 mpv。重新安装依赖可使用 `npm ci`，环境准备见 [开发环境配置](libmpv-runtime.md)。

`clean` 只删除 `dist-main/`、`dist/renderer/` 和上述构建缓存，不删除 `release/`、`node_modules/`、`.tools/` 或应用数据。构建、打包和发布准备不会自动运行类型检查或测试。

## 使用 patch 文件

依赖补丁和工程源码补丁是两种操作：

| 类型 | 修改对象 | 工具 |
| --- | --- | --- |
| 依赖补丁 | `node_modules/` 中的依赖 | patch-package，读取工程 `patches/` |
| 源码补丁 | 工程中已由 Git 跟踪的文件 | `git apply`，使用指定 `.patch` |

### 依赖补丁

```powershell
npm run patch:apply                         # 应用 patches/ 中的补丁
npm run patch:apply -- --native              # 应用后重编译 mpv
npm run patch:apply -- --reverse             # 撤销这些补丁
npm run patch:create -- --package electron-mpv-video
```

生成补丁前，先修改对应依赖的源码或运行文件。生成时会排除包根部 `package.json` 和 `native/mpv-addon/build/`；不要将本机 DLL、OBJ、PDB 等编译文件纳入补丁。撤销后若要运行应用，需先恢复项目依赖的补丁。

### 工程源码补丁

```powershell
npm run tool -- patch create --base HEAD --out release/patches/change.patch
npm run tool -- patch apply --file release/patches/change.patch --check
npm run tool -- patch apply --file release/patches/change.patch
npm run tool -- patch apply --file release/patches/change.patch --reverse
```

导出范围是指定提交到当前工作区的已跟踪文件差异，支持二进制文件，不包含未跟踪文件。新文件需先由用户纳入 Git 跟踪范围。应用时会先检查能否应用；冲突则停止，不自动暂存或提交。导出的补丁应在对应基线工作区使用，不能直接应用回已经包含相同修改的工作区。

## 软件差分包

软件差分比较的是**打包后的完整应用目录**，与上面的源码 `.patch` 无关。以下以已准备好的 1.0.0、1.1.0 两个 `win-unpacked` 目录为例：

```powershell
npm run delta:create -- --base release/1.0.0-dir/win-unpacked --next release/1.1.0-dir/win-unpacked --out release/1.0.0-to-1.1.0

# 退出目标应用后，先检查，再应用
npm run delta:apply -- --patch release/1.0.0-to-1.1.0 --to "D:/Apps/Aurora Player" --check
npm run delta:apply -- --patch release/1.0.0-to-1.1.0 --to "D:/Apps/Aurora Player"
```

创建差分包的前提：

- 新旧目录均包含 `resources/app.asar`，来自未运行过的打包产物，且不含 `data/`。
- `--base` 不是安装 EXE；`--next` 也不是源码或 `dist/renderer/`。
- `--out` 是 `release/` 下的新目录。输出含 `delta-manifest.json` 与 `payload/`。

应用时会校验基线和载荷的 SHA-256。目标程序文件必须与基线一致，额外的用户数据保留；失败时尝试自动回滚，备份及恢复记录留在 `release/rollback/<id>/`。基线不符或发生文件/目录类型替换时，改用完整安装包。

这是文件级差分：变更的 `app.asar` 会整体包含，不能按二进制块缩小；需要退出应用后使用，也未接入应用内的自动更新。校验和用于检查损坏和基线一致性，不代替代码签名。

## 打包与发布

### 只生成本地产物

```powershell
npm run dist                    # NSIS 安装包
npm run dist:portable           # 便携版 EXE
npm run dist:dir                # 完整应用目录
npm run release                # 安装包 + 发布说明 + 校验文件
```

默认输出为 `release/<当前版本>-<nsis|portable|dir>/`。输出目录已非空时，会停止并提示换一个 `--out` 目录，例如：

```powershell
npm run release -- --full --out release/local-preview
```

| 产物 | 用途 |
| --- | --- |
| 安装或便携 EXE | 分发给用户 |
| `win-unpacked/` | 完整应用，也可保留为下一次差分的基线 |
| `release-notes.md` | 发布说明；`release` 生成，可用 `--notes-file` 指定已有 Markdown |
| `SHA256SUMS.txt` | 发布文件的 SHA-256 |
| `release-manifest.json` | 版本、提交、工作区状态和文件哈希 |

`dist` 和 `release` 都不会上传。`dir` 目标不生成安装 EXE，也不能直接用于 GitHub 发布。打包前需已有可用 mpv 原生产物，或显式增加 `--native`。

要在发布准备时附带差分包，加 `--base` 指向旧版完整目录；工具会额外生成 `delta/` 和 `.tar.gz`，压缩需要系统 `tar`：

```powershell
npm run release -- --base release/1.0.0-dir/win-unpacked --out release/next-with-delta
```

使用 `.tar.gz` 时先解压，再将其中含 `delta-manifest.json` 的目录传给 `delta apply --patch`。

### 发布到 GitHub

先完成并提交功能修改，再按以下顺序发布。版本号和仓库名按实际情况替换；需要事先安装并登录 GitHub CLI（`gh auth login`）。

```powershell
# 1. 更新并提交版本，确保工作区没有其他未提交修改
npm run version:set -- 1.1.0
git add package.json package-lock.json
git commit -m "release: v1.1.0"

# 2. 从该干净提交生成正式产物；输出目录需为空
npm run release -- --full --out release/1.1.0-release

# 3. 创建本地标签，再推送提交和标签
npm run tool -- version tag
git push origin HEAD
git push origin v1.1.0

# 4. 上传并创建 GitHub 草稿
npm run release:publish -- --dir release/1.1.0-release --repo mrlei9264/AuroraPlayerNodeJs
```

创建草稿后，在 GitHub 审阅并发布。若首次创建就要公开，在最后一条命令加 `--live`；该命令不会覆盖已有 Release。带预发布标识的版本会自动标记为 prerelease。

上传前会核对当前版本、干净工作区、产物清单、文件哈希和本地标签；`gh --verify-tag` 要求目标仓库已有该标签。工具不会自动提交或推送代码。

也可用 `npm run tool -- version bump patch` 递增补丁版本；将 `patch` 换成 `minor` 或 `major` 可递增次版本或主版本。`release --version ...` 适合本地试打包：它会先修改版本，产生未提交变更；正式上传仍应先提交，再重新准备产物。
