mod index;
mod scanner;
mod vault;

use index::NativeIndex;
use scanner::WorkspaceScanner;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::Arc;
use vault::SecureVault;

#[derive(Deserialize)]
struct RpcRequest {
    id: u64,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct RpcResponse {
    id: u64,
    result: Option<Value>,
    error: Option<String>,
}

#[tokio::main]
async fn main() {
    let index = Arc::new(NativeIndex::new());
    let scanner = WorkspaceScanner::new();

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        if let Ok(line_str) = line {
            if line_str.trim().is_empty() {
                continue;
            }

            let req: Result<RpcRequest, _> = serde_json::from_str(&line_str);
            let response = match req {
                Ok(req) => handle_rpc(&req, &index, &scanner).await,
                Err(e) => RpcResponse {
                    id: 0,
                    result: None,
                    error: Some(format!("Invalid JSON-RPC format: {}", e)),
                },
            };

            if let Ok(serialized) = serde_json::to_string(&response) {
                let _ = writeln!(stdout, "{}", serialized);
                let _ = stdout.flush();
            }
        }
    }
}

async fn handle_rpc(
    req: &RpcRequest,
    index: &Arc<NativeIndex>,
    scanner: &WorkspaceScanner,
) -> RpcResponse {
    match req.method.as_str() {
        "ping" => RpcResponse {
            id: req.id,
            result: Some(json!({ "status": "ok", "version": "1.0.0-native-rust" })),
            error: None,
        },

        "scan_and_index" => {
            let root = req
                .params
                .as_ref()
                .and_then(|p| p.get("root"))
                .and_then(|v| v.as_str())
                .unwrap_or(".");

            let entries = scanner.scan_dir(root);
            let file_count = entries.len();

            for entry in entries {
                index.index_file(&entry.path, &entry.content);
            }

            RpcResponse {
                id: req.id,
                result: Some(json!({
                    "filesIndexed": file_count,
                    "snippetsTotal": index.total_snippets()
                })),
                error: None,
            }
        }

        "search_codebase" => {
            let query = req
                .params
                .as_ref()
                .and_then(|p| p.get("query"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let top_k = req
                .params
                .as_ref()
                .and_then(|p| p.get("topK"))
                .and_then(|v| v.as_u64())
                .unwrap_or(8) as usize;

            let hits = index.search(query, top_k);
            RpcResponse {
                id: req.id,
                result: Some(json!({ "hits": hits })),
                error: None,
            }
        }

        "vault_set" => {
            let key = req
                .params
                .as_ref()
                .and_then(|p| p.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let secret = req
                .params
                .as_ref()
                .and_then(|p| p.get("secret"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match SecureVault::set_secret(key, secret) {
                Ok(_) => RpcResponse {
                    id: req.id,
                    result: Some(json!({ "success": true })),
                    error: None,
                },
                Err(e) => RpcResponse {
                    id: req.id,
                    result: None,
                    error: Some(e),
                },
            }
        }

        "vault_get" => {
            let key = req
                .params
                .as_ref()
                .and_then(|p| p.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match SecureVault::get_secret(key) {
                Ok(secret) => RpcResponse {
                    id: req.id,
                    result: Some(json!({ "secret": secret })),
                    error: None,
                },
                Err(e) => RpcResponse {
                    id: req.id,
                    result: None,
                    error: Some(e),
                },
            }
        }

        "vault_delete" => {
            let key = req
                .params
                .as_ref()
                .and_then(|p| p.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match SecureVault::delete_secret(key) {
                Ok(_) => RpcResponse {
                    id: req.id,
                    result: Some(json!({ "success": true })),
                    error: None,
                },
                Err(e) => RpcResponse {
                    id: req.id,
                    result: None,
                    error: Some(e),
                },
            }
        }

        _ => RpcResponse {
            id: req.id,
            result: None,
            error: Some(format!("Unknown method: {}", req.method)),
        },
    }
}
