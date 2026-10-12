use crate::index::SearchHit;
use crate::vector_index::VectorMatch;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedSnippet {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
    pub score: f32,
    pub bm25_rank: Option<usize>,
    pub vector_rank: Option<usize>,
}

pub struct HybridReranker;

impl HybridReranker {
    /// Reciprocal Rank Fusion (RRF) combinant les résultats BM25 et sémantiques
    pub fn fuse_and_rerank(
        bm25_hits: &[SearchHit],
        vector_hits: &[VectorMatch],
        top_k: usize,
    ) -> Vec<RankedSnippet> {
        let rrf_k = 60.0f32;
        let mut snippet_map = std::collections::HashMap::new();

        // 1. Enregistrement des rangs BM25
        for (rank, hit) in bm25_hits.iter().enumerate() {
            let key = format!("{}:{}-{}", hit.snippet.file_path, hit.snippet.start_line, hit.snippet.end_line);
            let rrf_score = 1.0 / (rrf_k + (rank as f32) + 1.0);
            snippet_map.insert(
                key,
                (
                    hit.snippet.file_path.clone(),
                    hit.snippet.start_line,
                    hit.snippet.end_line,
                    hit.snippet.content.clone(),
                    rrf_score,
                    Some(rank + 1),
                    None,
                ),
            );
        }

        // 2. Fusion avec les rangs vectoriels
        for (rank, hit) in vector_hits.iter().enumerate() {
            let key = format!("{}:{}-{}", hit.file_path, hit.start_line, hit.end_line);
            let rrf_score = 1.0 / (rrf_k + (rank as f32) + 1.0);

            if let Some(entry) = snippet_map.get_mut(&key) {
                entry.4 += rrf_score;
                entry.6 = Some(rank + 1);
            } else {
                snippet_map.insert(
                    key,
                    (
                        hit.file_path.clone(),
                        hit.start_line,
                        hit.end_line,
                        hit.text.clone(),
                        rrf_score,
                        None,
                        Some(rank + 1),
                    ),
                );
            }
        }

        let mut ranked: Vec<RankedSnippet> = snippet_map
            .into_iter()
            .map(|(_, (file_path, start_line, end_line, content, score, bm25_rank, vector_rank))| {
                RankedSnippet {
                    file_path,
                    start_line,
                    end_line,
                    content,
                    score,
                    bm25_rank,
                    vector_rank,
                }
            })
            .collect();

        ranked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(top_k);
        ranked
    }
}
