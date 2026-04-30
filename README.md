# NewMob

NewMob 是一个基于 Tauri 2 + React + TypeScript 的跨平台远程连接管理工具，目标是提供类似 MobaXterm 的桌面体验。

当前工程已包含本地终端、SSH 终端、会话/分组管理、OpenSSH 配置导入等基础能力；RDP、VNC、SFTP 等协议入口已在界面中预留。

## 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind CSS
- 桌面端：Tauri 2、Rust
- 终端：xterm.js、portable-pty、russh
- 状态与存储：Zustand、SQLite（rusqlite）

## 环境要求

- Node.js 18+
- pnpm
- Rust 1.77.2+
- Tauri 所需系统依赖

安装依赖：

```bash
pnpm install
```

## 开发

启动桌面应用开发模式：

```bash
pnpm tauri dev
```

仅启动前端 Vite 服务：

```bash
pnpm dev
```

Vite 默认端口为 `1420`，Tauri 开发模式会自动使用该端口。

## 构建与打包

构建前端静态资源：

```bash
pnpm build
```

构建产物输出到：

```text
dist/
```

打包 Tauri 桌面应用：

```bash
pnpm tauri build
```

该命令会先执行 `pnpm build`，再按当前平台生成桌面应用安装包/可执行文件。打包产物通常位于：

```text
src-tauri/target/release/bundle/
```

直接运行 release 可执行文件时，可在：

```text
src-tauri/target/release/
```

## 测试

```bash
pnpm test
```

## 目录结构

```text
src/                 React 前端代码
src/components/      UI 组件
src/layouts/         主布局
src/lib/             IPC 与工具函数
src/stores/          前端状态管理
src-tauri/           Tauri/Rust 后端代码
src-tauri/src/       Rust 模块
```
