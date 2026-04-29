use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;

pub struct PtyHandle {
    pub writer: Box<dyn std::io::Write + Send>,
    pub reader_thread: Option<std::thread::JoinHandle<()>>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
}

pub fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
}

pub fn create_pty(
    cols: u16,
    rows: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<(PtyHandle, Box<dyn Read + Send>), String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell_path = shell.unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(&shell_path);

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Must drop slave so master reads work properly
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let handle = PtyHandle {
        writer,
        reader_thread: None,
        child,
        master: pair.master,
    };

    Ok((handle, reader))
}

pub fn resize_pty(master: &dyn portable_pty::MasterPty, cols: u16, rows: u16) -> Result<(), String> {
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))
}
