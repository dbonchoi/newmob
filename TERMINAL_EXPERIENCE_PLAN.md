# NewMob Terminal Experience Plan

> 目标：让 local terminal 与 SSH session terminal 共用同一套接近 MobaXterm 的终端渲染、右键菜单、常规操作和配置模型。本文档基于 MobaXterm SSH terminal 右键菜单截图制定。

## 1. Scope

### 1.1 Shared terminal surface

Local terminal 与 SSH terminal 应共享：

- xterm.js 渲染能力：ANSI/VT 序列、256 色/true color、alternate screen、鼠标模式、CJK 宽字符、链接识别、resize reflow、IME 输入。
- 一致的右键菜单：复制、粘贴、查找、字体、显示、语法高亮、日志、特殊命令、事件日志。
- 一致的配置读取：字体、字号、光标、主题、scrollback、复制粘贴策略、只读模式、日志策略。
- 一致的运行态状态：connected/disconnected、read-only、fullscreen、logging、syntax mode。

### 1.2 Differences by backend

- Local terminal 可以实现真实 OS signal（SIGINT/SIGTERM/SIGKILL 等）。
- SSH terminal 优先使用 SSH channel 能力；不支持的 signal 以禁用态展示，SIGINT 可退化为发送 Ctrl+C。
- SSH terminal 后续应关联 SFTP、SSH keepalive、jump host、agent forwarding、X11 等会话设置。

## 2. Target Right-Click Menu

```text
Copy
Copy All
Copy formatted text (RTF)
Paste                              Shift+Insert
Find                               Ctrl+Shift+F

Font settings >
  Use font "Consolas"
  Use font "JetBrains Mono"
  Use font "Cascadia Code"
  Display font ligatures
  Increase font size               Ctrl+MouseWheelUp
  Decrease font size               Ctrl+MouseWheelDown
  Reset font size to default        Ctrl+0

Terminal display >
  Reset terminal output
  Clear terminal scrollback
  Set terminal title
  Toggle terminal scrollbar
  Fullscreen terminal               F11
  Read-only terminal

Syntax highlighting >
  Default
  Error/Warning/Success keywords
  Unix shell script
  Cisco (network configuration)
  Perl syntax
  SQL syntax

Execute macro                       Ctrl+Space
Record new macro
Record terminal output to file
Save to file                        Ctrl+Shift+S
Print                               Ctrl+Shift+P

Receive file using Z-modem
Send file using Z-modem

Change current terminal settings...
Special Command >
  Break
  SIGINT (Interrupt)
  SIGTERM (Terminate)
  SIGKILL (Kill)
  SIGQUIT (Quit)
  SIGHUP (Hangup)
  More signals >
  IGNORE message

Event Log
```

## 3. Delivery Plan

### P0 - Core terminal operations

- Add terminal context menu with MobaXterm-like grouping and shortcut labels.
- Implement Copy, Copy All, Paste, and Find.
- Implement font family switching, font size increase/decrease/reset, and ligature toggle.
- Implement Reset terminal output, Clear terminal scrollback, Set terminal title, Toggle scrollbar, Fullscreen terminal, and Read-only terminal.
- Add keyboard shortcuts: Shift+Insert, Ctrl+Shift+F, F11, Ctrl+0, Ctrl+MouseWheel font resize.
- Keep unsupported items visible but disabled so the intended product shape is clear.

### P1 - Persistence and export

- Persist `TerminalProfile` globally and per session.
- Wire Session Editor terminal settings into `TerminalPanel`.
- Implement Save to file and Record terminal output to file.
- Add Event Log view for connection, resize, auth, disconnect, error, and reconnect events.
- Implement basic keyword highlighting for error/warning/success.

### P2 - Advanced compatibility

- Implement formatted copy as HTML/RTF where the platform clipboard supports it.
- Implement macro recording/playback.
- Add Z-modem send/receive.
- Implement backend-specific special commands:
  - Local: real OS signal delivery.
  - SSH: SSH channel signal/break where supported, Ctrl+C fallback for SIGINT.
- Add SFTP-aware actions for SSH sessions.

## 4. Proposed TerminalProfile

```ts
export interface TerminalProfile {
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  theme: string;
  scrollback: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  showScrollbar: boolean;
  copyOnSelect: boolean;
  rightClickBehavior: "menu" | "paste" | "copy-or-paste";
  readOnly: boolean;
  bracketedPaste: boolean;
  multilinePasteConfirm: boolean;
  syntaxMode: "default" | "keywords" | "shell" | "cisco" | "perl" | "sql";
  loggingEnabled: boolean;
  logPath?: string;
}
```

## 5. Acceptance Criteria

- Local terminal and SSH terminal both show the same context menu.
- Copy/Paste/Find works without reconnecting or remounting the terminal.
- Font and display changes apply live to the current terminal.
- Read-only mode prevents user input from being written to the PTY/SSH channel while output still renders.
- Fullscreen mode stays within the app and restores layout cleanly.
- Disabled future items are visually disabled and do not execute placeholder behavior.

