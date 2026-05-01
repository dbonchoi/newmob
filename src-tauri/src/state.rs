use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::RwLock;

use crate::terminal::ActiveTerminal;

pub struct AppState {
    pub terminals: Arc<RwLock<HashMap<String, ActiveTerminal>>>,
    pub db: Mutex<rusqlite::Connection>,
}

impl AppState {
    pub fn new(db: rusqlite::Connection) -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            db: Mutex::new(db),
        }
    }
}
