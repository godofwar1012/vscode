use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSnippet {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
    pub symbols: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub snippet: CodeSnippet,
    pub score: f32,
}

pub struct NativeIndex {
    snippets: RwLock<Vec<CodeSnippet>>,
    inverted_index: RwLock<HashMap<String, HashSet<usize>>>,
    doc_lengths: RwLock<Vec<usize>>,
    symbol_regex: Regex,
}

impl NativeIndex {
    pub fn new() -> Self {
        let symbol_regex = Regex::new(r"(?m)(?:class|fn|function|def|struct|enum|interface|type|const|let|var)\s+([a-zA-Z0-9_$]+)").unwrap();
        Self {
            snippets: RwLock::new(Vec::new()),
            inverted_index: RwLock::new(HashMap::new()),
            doc_lengths: RwLock::new(Vec::new()),
            symbol_regex,
        }
    }

    pub fn index_file(&self, file_path: &str, content: &str) {
        let lines: Vec<&str> = content.lines().collect();
        let chunk_size = 40;
        let overlap = 10;

        let mut local_snippets = Vec::new();
        let mut i = 0;
        while i < lines.len() {
            let end = (i + chunk_size).min(lines.len());
            let chunk_lines = &lines[i..end];
            let chunk_text = chunk_lines.join("\n");

            let mut symbols = Vec::new();
            for cap in self.symbol_regex.captures_iter(&chunk_text) {
                if let Some(m) = cap.get(1) {
                    symbols.push(m.as_str().to_string());
                }
            }

            local_snippets.push(CodeSnippet {
                file_path: file_path.to_string(),
                start_line: i + 1,
                end_line: end,
                content: chunk_text,
                symbols,
            });

            if end == lines.len() {
                break;
            }
            i += chunk_size - overlap;
        }

        let mut snippets_guard = self.snippets.write().unwrap();
        let mut inverted_guard = self.inverted_index.write().unwrap();
        let mut lengths_guard = self.doc_lengths.write().unwrap();

        for snippet in local_snippets {
            let doc_idx = snippets_guard.len();
            let terms = self.tokenize(&snippet.content);
            lengths_guard.push(terms.len());

            for term in terms {
                inverted_guard
                    .entry(term)
                    .or_insert_with(HashSet::new)
                    .insert(doc_idx);
            }

            snippets_guard.push(snippet);
        }
    }

    pub fn search(&self, query: &str, top_k: usize) -> Vec<SearchHit> {
        let query_terms = self.tokenize(query);
        if query_terms.is_empty() {
            return Vec::new();
        }

        let snippets_guard = self.snippets.read().unwrap();
        let inverted_guard = self.inverted_index.read().unwrap();
        let lengths_guard = self.doc_lengths.read().unwrap();

        let total_docs = snippets_guard.len();
        if total_docs == 0 {
            return Vec::new();
        }

        let total_len: usize = lengths_guard.iter().sum();
        let avg_len = total_len as f32 / total_docs as f32;

        let k1 = 1.2f32;
        let b = 0.75f32;
        let mut scores: HashMap<usize, f32> = HashMap::new();

        for term in &query_terms {
            if let Some(postings) = inverted_guard.get(term) {
                let doc_freq = postings.len() as f32;
                let idf = ((total_docs as f32 - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0).ln();

                for &doc_idx in postings {
                    let doc_len = lengths_guard[doc_idx] as f32;
                    let tf = 1.0f32; // Term frequency approximation
                    let score = idf * ((tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * (doc_len / avg_len))));

                    *scores.entry(doc_idx).or_insert(0.0) += score;
                }
            }
        }

        let mut hits: Vec<SearchHit> = scores
            .into_iter()
            .map(|(idx, score)| SearchHit {
                snippet: snippets_guard[idx].clone(),
                score,
            })
            .collect();

        hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(top_k);
        hits
    }

    fn tokenize(&self, text: &str) -> Vec<String> {
        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '$')
            .filter(|w| w.len() > 2)
            .map(|s| s.to_string())
            .collect()
    }

    pub fn total_snippets(&self) -> usize {
        self.snippets.read().unwrap().len()
    }
}
