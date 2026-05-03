//! Session-attached local port forwarders.
//!
//! When an SSH terminal opens with `networkSettings.localForwards`
//! configured, we spin up a tiny `tokio::net::TcpListener` per row and
//! forward each accepted connection over the same SSH handle that hosts
//! the terminal channel. The spawned listener (and its in-flight client
//! bridges) are tracked so `close_terminal` can `.abort()` them.
//!
//! Each listener owns a `tokio::task::JoinSet` of bridge tasks; aborting
//! the listener drops the `JoinSet`, which in turn aborts every accepted
//! connection's bridge so no traffic outlives the terminal.

use std::sync::Arc;

use russh::ChannelMsg;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::{JoinHandle, JoinSet};

use crate::terminal::network::{parse_endpoint, NetworkForward};
use crate::terminal::ssh::SshHandler;

/// Spawn one listener per `local → remote` row. Returns the join handles
/// of the listener tasks. Dropping a listener task drops its child
/// `JoinSet`, which aborts all in-flight bridge tasks owned by that
/// listener.
pub fn spawn_local_forwards(
    handle: Arc<russh::client::Handle<SshHandler>>,
    forwards: &[NetworkForward],
) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::with_capacity(forwards.len());
    for f in forwards {
        let (lhost, lport) = match parse_endpoint(&f.local) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("local forward '{}' → '{}': {}", f.local, f.remote, e);
                continue;
            }
        };
        let (rhost, rport) = match parse_endpoint(&f.remote) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("local forward '{}' → '{}': {}", f.local, f.remote, e);
                continue;
            }
        };
        let h = handle.clone();
        let task = tokio::spawn(async move {
            if let Err(e) = run_listener(h, lhost.clone(), lport, rhost.clone(), rport).await {
                tracing::warn!(
                    "session forward {}:{} → {}:{} stopped: {}",
                    lhost, lport, rhost, rport, e
                );
            }
        });
        handles.push(task);
    }
    handles
}

async fn run_listener(
    handle: Arc<russh::client::Handle<SshHandler>>,
    lhost: String,
    lport: u16,
    rhost: String,
    rport: u16,
) -> Result<(), String> {
    let listener = TcpListener::bind((lhost.as_str(), lport))
        .await
        .map_err(|e| format!("bind {}:{}: {}", lhost, lport, e))?;
    tracing::info!(
        "session forward listening on {}:{} → {}:{}",
        lhost, lport, rhost, rport
    );

    // The JoinSet owns every accepted-connection bridge. When this
    // listener task is aborted (e.g. on `close_terminal`), the JoinSet
    // drops and aborts all in-flight bridge futures.
    let mut bridges: JoinSet<()> = JoinSet::new();

    loop {
        // Periodically reap finished bridges so the JoinSet doesn't grow
        // unbounded across long-lived listeners.
        while bridges.try_join_next().is_some() {}

        let (mut stream, peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("session forward accept failed: {}", e);
                continue;
            }
        };
        let h = handle.clone();
        let rh = rhost.clone();
        bridges.spawn(async move {
            let originator = peer.ip().to_string();
            let originator_port = peer.port() as u32;
            let channel = match h
                .channel_open_direct_tcpip(rh.as_str(), rport as u32, originator.as_str(), originator_port)
                .await
            {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!("direct-tcpip open failed: {}", e);
                    let _ = stream.shutdown().await;
                    return;
                }
            };
            if let Err(e) = bridge(&mut stream, channel).await {
                tracing::debug!("session forward bridge ended: {}", e);
            }
        });
    }
}

async fn bridge(
    stream: &mut tokio::net::TcpStream,
    mut channel: russh::Channel<russh::client::Msg>,
) -> Result<(), String> {
    let (mut rx, mut tx) = stream.split();
    let mut buf = vec![0u8; 16 * 1024];
    let mut local_eof = false;
    let mut remote_eof = false;
    while !(local_eof && remote_eof) {
        tokio::select! {
            n = rx.read(&mut buf), if !local_eof => {
                let n = n.map_err(|e| format!("local read: {}", e))?;
                if n == 0 {
                    local_eof = true;
                    let _ = channel.eof().await;
                } else if let Err(e) = channel.data(&buf[..n]).await {
                    return Err(format!("ssh write: {}", e));
                }
            }
            msg = channel.wait(), if !remote_eof => {
                let Some(m) = msg else {
                    remote_eof = true;
                    let _ = tx.shutdown().await;
                    continue;
                };
                match m {
                    ChannelMsg::Data { data } => {
                        tx.write_all(&data).await.map_err(|e| format!("local write: {}", e))?;
                    }
                    ChannelMsg::ExtendedData { data, .. } => {
                        tx.write_all(&data).await.map_err(|e| format!("local write: {}", e))?;
                    }
                    ChannelMsg::Eof | ChannelMsg::Close => {
                        remote_eof = true;
                        let _ = tx.shutdown().await;
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
