mod ast_graph;
mod index;
mod reranker;
mod scanner;
mod vault;
mod vector_index;

use ast_graph::AstDependencyGraph;
use index::NativeIndex;
use reranker::HybridReranker;
use scanner::WorkspaceScanner;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::Arc;
use vault::SecureVault;
use vector_index::{NativeVectorStore, VectorDocument};

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
    let vector_store = Arc::new(NativeVectorStore::new());
    let ast_graph = Arc::new(AstDependencyGraph::new());
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
                Ok(req) => handle_rpc(&req, &index, &vector_store, &ast_graph, &scanner).await,
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
    vector_store: &Arc<NativeVectorStore>,
    ast_graph: &Arc<AstDependencyGraph>,
    scanner: &WorkspaceScanner,
) -> RpcResponse {
    match req.method.as_str() {
        "ping" => RpcResponse {
            id: req.id,
            result: Some(json!({ "status": "ok", "version": "1.1.0-native-rust-rag" })),
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
                ast_graph.analyze_file(&entry.path, &entry.content);
            }

            RpcResponse {
                id: req.id,
                result: Some(json!({
                    "filesIndexed": file_count,
                    "snippetsTotal": index.total_snippets(),
                    "astSummary": ast_graph.get_summary()
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

        "vector_insert" => {
            if let Some(params) = &req.params {
                if let Ok(doc) = serde_json::from_value::<VectorDocument>(params.clone()) {
                    vector_store.insert(doc);
                    return RpcResponse {
                        id: req.id,
                        result: Some(json!({ "success": true, "total": vector_store.count() })),
                        error: None,
                    };
                }
            }
            RpcResponse {
                id: req.id,
                result: None,
                error: Some("Paramètres de document vectoriel invalides".to_string()),
            }
        }

        "vector_search" => {
            let vector = req
                .params
                .as_ref()
                .and_then(|p| p.get("vector"))
                .and_then(|v| serde_json::from_value::<Vec<f32>>(v.clone()).ok())
                .unwrap_or_default();

            let top_k = req
                .params
                .as_ref()
                .and_then(|p| p.get("topK"))
                .and_then(|v| v.as_u64())
                .unwrap_or(5) as usize;

            let matches = vector_store.search(&vector, top_k);
            RpcResponse {
                id: req.id,
                result: Some(json!({ "matches": matches })),
                error: None,
            }
        }

        "hybrid_search" => {
            let query = req
                .params
                .as_ref()
                .and_then(|p| p.get("query"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let vector = req
                .params
                .as_ref()
                .and_then(|p| p.get("vector"))
                .and_then(|v| serde_json::from_value::<Vec<f32>>(v.clone()).ok())
                .unwrap_or_default();

            let top_k = req
                .params
                .as_ref()
                .and_then(|p| p.get("topK"))
                .and_then(|v| v.as_u64())
                .unwrap_or(8) as usize;

            let bm25_hits = index.search(query, top_k * 2);
            let vector_matches = vector_store.search(&vector, top_k * 2);
            let ranked = HybridReranker::fuse_and_rerank(&bm25_hits, &vector_matches, top_k);

            RpcResponse {
                id: req.id,
                result: Some(json!({ "ranked": ranked })),
                error: None,
            }
        }

        "ast_find_definition" => {
            let symbol = req
                .params
                .as_ref()
                .and_then(|p| p.get("symbol"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let defs = ast_graph.find_definition(symbol);
            RpcResponse {
                id: req.id,
                result: Some(json!({ "definitions": defs })),
                error: None,
            }
        }

        "ast_get_dependencies" => {
            let file = req
                .params
                .as_ref()
                .and_then(|p| p.get("file"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let deps = ast_graph.get_file_dependencies(file);
            RpcResponse {
                id: req.id,
                result: Some(json!({ "dependencies": deps })),
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
