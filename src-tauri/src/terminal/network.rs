//! Per-session network settings: proxy chain, keep-alive, TCP_NODELAY,
//! IP-version preference, and local port forwarding rows.
//!
//! Frontend marshals these as `networkSettings` on the IPC payload; we
//! deserialize once per connect and apply them when establishing the
//! TCP socket and when configuring the russh client.

use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpStream};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkForward {
    pub local: String,
    pub remote: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    #[serde(default = "default_proxy_kind")]
    pub proxy_kind: String,
    #[serde(default)]
    pub proxy_host: String,
    #[serde(default)]
    pub proxy_port: u16,
    #[serde(default)]
    pub proxy_user: String,
    #[serde(default)]
    pub proxy_pass: String,
    #[serde(default = "default_true")]
    pub keep_alive: bool,
    #[serde(default)]
    pub keep_alive_interval_secs: u64,
    #[serde(default = "default_true")]
    pub tcp_nodelay: bool,
    #[serde(default = "default_ip_version")]
    pub ip_version: String,
    #[serde(default)]
    pub local_forwards: Vec<NetworkForward>,
}

fn default_proxy_kind() -> String { "none".into() }
fn default_ip_version() -> String { "auto".into() }
fn default_true() -> bool { true }

impl NetworkSettings {
    /// Parse a JSON blob coming from the frontend. Returns `None` for
    /// missing/empty input or unparseable JSON; the caller should treat
    /// that as "use defaults / no proxy".
    pub fn from_json(raw: Option<&str>) -> Option<Self> {
        let s = raw?.trim();
        if s.is_empty() { return None; }
        match serde_json::from_str::<Self>(s) {
            Ok(v) => Some(v),
            Err(e) => {
                tracing::warn!("invalid networkSettings JSON: {}", e);
                None
            }
        }
    }

    pub fn keepalive_duration(&self) -> Option<Duration> {
        if self.keep_alive && self.keep_alive_interval_secs > 0 {
            Some(Duration::from_secs(self.keep_alive_interval_secs))
        } else {
            None
        }
    }
}

/// Resolve `host:port` honouring the IP-version preference, then connect
/// to the first address that succeeds. Returns the underlying TCP stream;
/// the caller is expected to layer SSH (or a proxy hop) on top.
async fn open_tcp_filtered(
    host: &str,
    port: u16,
    ip_version: &str,
) -> Result<TcpStream, String> {
    let mut addrs: Vec<std::net::SocketAddr> = lookup_host((host, port))
        .await
        .map_err(|e| format!("DNS lookup for {}:{} failed: {}", host, port, e))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("No addresses resolved for {}:{}", host, port));
    }
    match ip_version {
        "ipv4" => addrs.retain(|a| a.is_ipv4()),
        "ipv6" => addrs.retain(|a| a.is_ipv6()),
        _ => addrs.sort_by_key(|a| !a.is_ipv4()), // auto: prefer v4 first
    }
    if addrs.is_empty() {
        return Err(format!("No matching IP{} addresses for {}", ip_version, host));
    }
    let mut last_err: Option<std::io::Error> = None;
    for a in addrs {
        match TcpStream::connect(a).await {
            Ok(s) => return Ok(s),
            Err(e) => last_err = Some(e),
        }
    }
    Err(format!(
        "Could not connect to {}:{}: {}",
        host,
        port,
        last_err.map(|e| e.to_string()).unwrap_or_else(|| "no addresses".into()),
    ))
}

/// Establish the TCP transport for an SSH connection, applying proxy hop
/// (HTTP CONNECT or SOCKS5), TCP_NODELAY, and IP-version preference per
/// the supplied `NetworkSettings`. When `network` is `None` this is a
/// direct TCP connect with `nodelay=true`.
pub async fn establish_transport(
    host: &str,
    port: u16,
    network: Option<&NetworkSettings>,
) -> Result<TcpStream, String> {
    let ip_pref = network.map(|n| n.ip_version.as_str()).unwrap_or("auto");
    let proxy_kind = network.map(|n| n.proxy_kind.as_str()).unwrap_or("none");
    let nodelay = network.map(|n| n.tcp_nodelay).unwrap_or(true);

    let stream = match proxy_kind {
        "" | "none" => open_tcp_filtered(host, port, ip_pref).await?,
        "http" => {
            let n = network.unwrap();
            require_proxy(n)?;
            let mut s = open_tcp_filtered(&n.proxy_host, n.proxy_port, ip_pref).await?;
            s.set_nodelay(nodelay).map_err(|e| format!("set_nodelay: {}", e))?;
            http_connect_handshake(&mut s, host, port, &n.proxy_user, &n.proxy_pass).await?;
            s
        }
        "socks5" => {
            let n = network.unwrap();
            require_proxy(n)?;
            let mut s = open_tcp_filtered(&n.proxy_host, n.proxy_port, ip_pref).await?;
            s.set_nodelay(nodelay).map_err(|e| format!("set_nodelay: {}", e))?;
            socks5_handshake(&mut s, host, port, &n.proxy_user, &n.proxy_pass).await?;
            s
        }
        other => {
            return Err(format!(
                "Proxy type '{}' is not implemented in this build (supported: none, http, socks5).",
                other,
            ))
        }
    };

    stream
        .set_nodelay(nodelay)
        .map_err(|e| format!("set_nodelay: {}", e))?;
    Ok(stream)
}

fn require_proxy(n: &NetworkSettings) -> Result<(), String> {
    if n.proxy_host.trim().is_empty() {
        return Err("Proxy host is empty".into());
    }
    if n.proxy_port == 0 {
        return Err("Proxy port must be greater than 0".into());
    }
    Ok(())
}

async fn http_connect_handshake(
    s: &mut TcpStream,
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
) -> Result<(), String> {
    let mut req = format!(
        "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Connection: keep-alive\r\n",
        host = host,
        port = port,
    );
    if !user.is_empty() {
        let token = B64.encode(format!("{}:{}", user, pass));
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", token));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes())
        .await
        .map_err(|e| format!("proxy write: {}", e))?;

    let mut buf: Vec<u8> = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    loop {
        let n = s
            .read(&mut byte)
            .await
            .map_err(|e| format!("proxy read: {}", e))?;
        if n == 0 {
            return Err("Proxy closed connection during CONNECT handshake".into());
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err("Proxy CONNECT response exceeded 8KB".into());
        }
    }
    let resp = String::from_utf8_lossy(&buf);
    let status = resp.lines().next().unwrap_or("").to_string();
    // "HTTP/1.1 200 Connection Established"
    let parts: Vec<&str> = status.split_whitespace().collect();
    if parts.len() < 2 || parts[1] != "200" {
        return Err(format!("HTTP proxy rejected CONNECT: {}", status));
    }
    Ok(())
}

async fn socks5_handshake(
    s: &mut TcpStream,
    host: &str,
    port: u16,
    user: &str,
    pass: &str,
) -> Result<(), String> {
    let methods: Vec<u8> = if user.is_empty() { vec![0x00] } else { vec![0x00, 0x02] };
    let mut greet = vec![0x05u8, methods.len() as u8];
    greet.extend_from_slice(&methods);
    s.write_all(&greet).await.map_err(|e| format!("socks write: {}", e))?;

    let mut sel = [0u8; 2];
    s.read_exact(&mut sel).await.map_err(|e| format!("socks read: {}", e))?;
    if sel[0] != 0x05 {
        return Err("SOCKS5: bad version in greeting".into());
    }
    match sel[1] {
        0x00 => {}
        0x02 => {
            let u = user.as_bytes();
            let p = pass.as_bytes();
            if u.len() > 255 || p.len() > 255 {
                return Err("SOCKS5 user/pass too long (>255 bytes)".into());
            }
            let mut auth = vec![0x01u8, u.len() as u8];
            auth.extend_from_slice(u);
            auth.push(p.len() as u8);
            auth.extend_from_slice(p);
            s.write_all(&auth).await.map_err(|e| format!("socks auth: {}", e))?;
            let mut ack = [0u8; 2];
            s.read_exact(&mut ack).await.map_err(|e| format!("socks auth read: {}", e))?;
            if ack[1] != 0x00 {
                return Err("SOCKS5 username/password rejected".into());
            }
        }
        0xff => return Err("SOCKS5 server requires an auth method we don't support".into()),
        m => return Err(format!("SOCKS5 unsupported auth method 0x{:02x}", m)),
    }

    let host_bytes = host.as_bytes();
    if host_bytes.len() > 255 {
        return Err("SOCKS5 destination host too long (>255 bytes)".into());
    }
    let mut req: Vec<u8> = vec![0x05, 0x01, 0x00, 0x03, host_bytes.len() as u8];
    req.extend_from_slice(host_bytes);
    req.extend_from_slice(&port.to_be_bytes());
    s.write_all(&req).await.map_err(|e| format!("socks request: {}", e))?;

    let mut head = [0u8; 4];
    s.read_exact(&mut head).await.map_err(|e| format!("socks reply: {}", e))?;
    if head[0] != 0x05 {
        return Err("SOCKS5: bad version in reply".into());
    }
    if head[1] != 0x00 {
        return Err(format!("SOCKS5 connect failed (rep=0x{:02x})", head[1]));
    }
    let skip = match head[3] {
        0x01 => 4usize,
        0x04 => 16,
        0x03 => {
            let mut l = [0u8; 1];
            s.read_exact(&mut l).await.map_err(|e| format!("socks bnd: {}", e))?;
            l[0] as usize
        }
        other => return Err(format!("SOCKS5 unknown ATYP 0x{:02x}", other)),
    };
    let mut bnd = vec![0u8; skip + 2];
    s.read_exact(&mut bnd).await.map_err(|e| format!("socks bnd: {}", e))?;
    Ok(())
}

/// Parse a `host:port` row from the local-port-forwarding table. Returns
/// `(host, port)` on success, or an error suitable for surfacing to the
/// user as the reason a single forward could not be started.
pub fn parse_endpoint(s: &str) -> Result<(String, u16), String> {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix('[') {
        // [::1]:22 - IPv6 literal in brackets
        if let Some(idx) = rest.rfind(']') {
            let host = &rest[..idx];
            let after = &rest[idx + 1..];
            let port_str = after.strip_prefix(':').ok_or_else(|| format!("missing port in '{}'", s))?;
            let port: u16 = port_str.parse().map_err(|_| format!("invalid port in '{}'", s))?;
            return Ok((host.to_string(), port));
        }
        return Err(format!("unbalanced brackets in '{}'", s));
    }
    let (host, port_str) = s
        .rsplit_once(':')
        .ok_or_else(|| format!("expected host:port, got '{}'", s))?;
    if host.is_empty() {
        return Err(format!("empty host in '{}'", s));
    }
    let port: u16 = port_str
        .parse()
        .map_err(|_| format!("invalid port in '{}'", s))?;
    Ok((host.to_string(), port))
}
