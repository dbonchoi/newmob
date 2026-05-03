use async_trait::async_trait;
use russh::keys::key::PublicKey;
use russh::{client, ChannelId};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::terminal::network::{establish_transport, NetworkSettings};

pub struct SshSession {
    pub handle: client::Handle<SshHandler>,
}

pub struct SshHandler {
    pub output_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>>>,
}

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: proper host key verification
        Ok(true)
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(tx) = self.output_tx.lock().await.as_ref() {
            let _ = tx.send(data.to_vec());
        }
        Ok(())
    }

    async fn extended_data(
        &mut self,
        _channel: ChannelId,
        _ext: u32,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(tx) = self.output_tx.lock().await.as_ref() {
            let _ = tx.send(data.to_vec());
        }
        Ok(())
    }
}

pub enum SshAuth {
    Password(String),
    PrivateKey(String),
    Agent,
}

fn build_client_config(network: Option<&NetworkSettings>) -> Arc<client::Config> {
    let mut cfg = client::Config::default();
    if let Some(n) = network {
        if let Some(d) = n.keepalive_duration() {
            cfg.keepalive_interval = Some(d);
            cfg.keepalive_max = 3;
        }
    }
    Arc::new(cfg)
}

async fn authenticate(handle: &mut client::Handle<SshHandler>, username: &str, auth: SshAuth) -> Result<(), String> {
    match auth {
        SshAuth::Password(password) => {
            let ok = handle
                .authenticate_password(username, &password)
                .await
                .map_err(|e| format!("SSH auth failed: {}", e))?;
            if !ok {
                return Err("SSH password authentication rejected".to_string());
            }
        }
        SshAuth::PrivateKey(key_path) => {
            let key_path = shellexpand::tilde(&key_path).to_string();
            let key = russh_keys::load_secret_key(&key_path, None)
                .map_err(|e| format!("Failed to load key {}: {}", key_path, e))?;
            let ok = handle
                .authenticate_publickey(username, Arc::new(key))
                .await
                .map_err(|e| format!("SSH key auth failed: {}", e))?;
            if !ok {
                return Err("SSH key authentication rejected".to_string());
            }
        }
        SshAuth::Agent => {
            return Err("SSH agent auth not yet implemented".to_string());
        }
    }
    Ok(())
}

pub async fn connect_ssh(
    host: &str,
    port: u16,
    username: &str,
    auth: SshAuth,
    cols: u16,
    rows: u16,
    network: Option<&NetworkSettings>,
) -> Result<
    (
        client::Handle<SshHandler>,
        russh::Channel<client::Msg>,
        tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    ),
    String,
> {
    let (output_tx, output_rx) = tokio::sync::mpsc::unbounded_channel();

    let config = build_client_config(network);

    let handler = SshHandler {
        output_tx: Arc::new(Mutex::new(Some(output_tx))),
    };

    let stream = establish_transport(host, port, network).await?;
    let mut handle = client::connect_stream(config, stream, handler)
        .await
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    authenticate(&mut handle, username, auth).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

    channel
        .request_pty(false, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|e| format!("Failed to request PTY: {}", e))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;

    Ok((handle, channel, output_rx))
}

/// Authenticate against the server and return the handle without opening a
/// PTY/shell. The SFTP module reuses this to open its own subsystem channel.
pub async fn connect_ssh_authenticated(
    host: &str,
    port: u16,
    username: &str,
    auth: SshAuth,
) -> Result<client::Handle<SshHandler>, String> {
    connect_ssh_authenticated_with(host, port, username, auth, None).await
}

/// Same as `connect_ssh_authenticated` but allows callers to pass through
/// per-session network settings (proxy, keep-alive, IP version, …).
pub async fn connect_ssh_authenticated_with(
    host: &str,
    port: u16,
    username: &str,
    auth: SshAuth,
    network: Option<&NetworkSettings>,
) -> Result<client::Handle<SshHandler>, String> {
    let config = build_client_config(network);
    let handler = SshHandler {
        output_tx: Arc::new(Mutex::new(None)),
    };

    let stream = establish_transport(host, port, network).await?;
    let mut handle = client::connect_stream(config, stream, handler)
        .await
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    authenticate(&mut handle, username, auth).await?;
    Ok(handle)
}
