use serde::{Deserialize, Serialize};
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorDocument {
    pub id: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorMatch {
    pub id: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
    pub similarity: f32,
}

pub struct NativeVectorStore {
    documents: RwLock<Vec<VectorDocument>>,
}

impl NativeVectorStore {
    pub fn new() -> Self {
        Self {
            documents: RwLock::new(Vec::new()),
        }
    }

    pub fn insert(&self, doc: VectorDocument) {
        let mut guard = self.documents.write().unwrap();
        guard.push(doc);
    }

    pub fn insert_batch(&self, docs: Vec<VectorDocument>) {
        let mut guard = self.documents.write().unwrap();
        guard.extend(docs);
    }

    /// Calcul de similarité cosinus avec optimisation vectorielle
    pub fn search(&self, query_vector: &[f32], top_k: usize) -> Vec<VectorMatch> {
        let guard = self.documents.read().unwrap();
        if guard.is_empty() || query_vector.is_empty() {
            return Vec::new();
        }

        let mut matches: Vec<VectorMatch> = guard
            .iter()
            .map(|doc| {
                let similarity = Self::cosine_similarity(query_vector, &doc.embedding);
                VectorMatch {
                    id: doc.id.clone(),
                    file_path: doc.file_path.clone(),
                    start_line: doc.start_line,
                    end_line: doc.end_line,
                    text: doc.text.clone(),
                    similarity,
                }
            })
            .collect();

        matches.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        matches.truncate(top_k);
        matches
    }

    #[inline]
    fn cosine_similarity(v1: &[f32], v2: &[f32]) -> f32 {
        if v1.len() != v2.len() {
            return 0.0;
        }

        let mut dot = 0.0f32;
        let mut norm1 = 0.0f32;
        let mut norm2 = 0.0f32;

        for (a, b) in v1.iter().zip(v2.iter()) {
            dot += a * b;
            norm1 += a * a;
            norm2 += b * b;
        }

        let denom = norm1.sqrt() * norm2.sqrt();
        if denom == 0.0 {
            0.0
        } else {
            dot / denom
        }
    }

    pub fn count(&self) -> usize {
        self.documents.read().unwrap().len()
    }
}
