use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolDefinition {
    pub name: String,
    pub kind: String, // "class" | "function" | "interface" | "struct" | "type"
    pub file_path: String,
    pub line_number: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AstGraphSummary {
    pub total_symbols: usize,
    pub total_files_mapped: usize,
    pub total_dependencies: usize,
}

pub struct AstDependencyGraph {
    /// Nom du symbole -> Liste de ses définitions
    symbol_table: RwLock<HashMap<String, Vec<SymbolDefinition>>>,
    /// Fichier -> Ensemble des fichiers ou modules qu'il importe
    file_imports: RwLock<HashMap<String, HashSet<String>>>,
    import_regex: Regex,
    symbol_regex: Regex,
}

impl AstDependencyGraph {
    pub fn new() -> Self {
        let import_regex = Regex::new(r#"(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)|use\s+([a-zA-Z0-9_:]+))"#).unwrap();
        let symbol_regex = Regex::new(r#"(?m)^\s*(?:export\s+)?(class|function|interface|type|struct|enum|fn)\s+([a-zA-Z0-9_$]+)"#).unwrap();

        Self {
            symbol_table: RwLock::new(HashMap::new()),
            file_imports: RwLock::new(HashMap::new()),
            import_regex,
            symbol_regex,
        }
    }

    pub fn analyze_file(&self, file_path: &str, content: &str) {
        let mut local_imports = HashSet::new();

        // 1. Extraction des imports
        for cap in self.import_regex.captures_iter(content) {
            if let Some(m) = cap.get(1).or_else(|| cap.get(2)).or_else(|| cap.get(3)) {
                local_imports.insert(m.as_str().to_string());
            }
        }

        // 2. Extraction des définitions de symboles
        let mut local_symbols = Vec::new();
        for (line_idx, line) in content.lines().enumerate() {
            if let Some(cap) = self.symbol_regex.captures(line) {
                if let (Some(kind), Some(name)) = (cap.get(1), cap.get(2)) {
                    local_symbols.push(SymbolDefinition {
                        name: name.as_str().to_string(),
                        kind: kind.as_str().to_string(),
                        file_path: file_path.to_string(),
                        line_number: line_idx + 1,
                    });
                }
            }
        }

        // Mise à jour de la table globale
        let mut symbol_guard = self.symbol_table.write().unwrap();
        for sym in local_symbols {
            symbol_guard
                .entry(sym.name.clone())
                .or_insert_with(Vec::new)
                .push(sym);
        }

        let mut imports_guard = self.file_imports.write().unwrap();
        imports_guard.insert(file_path.to_string(), local_imports);
    }

    pub fn find_definition(&self, symbol_name: &str) -> Vec<SymbolDefinition> {
        self.symbol_table
            .read()
            .unwrap()
            .get(symbol_name)
            .cloned()
            .unwrap_or_default()
    }

    pub fn get_file_dependencies(&self, file_path: &str) -> Vec<String> {
        self.file_imports
            .read()
            .unwrap()
            .get(file_path)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn get_summary(&self) -> AstGraphSummary {
        let symbol_guard = self.symbol_table.read().unwrap();
        let imports_guard = self.file_imports.read().unwrap();

        let total_symbols = symbol_guard.values().map(|v| v.len()).sum();
        let total_dependencies = imports_guard.values().map(|v| v.len()).sum();

        AstGraphSummary {
            total_symbols,
            total_files_mapped: imports_guard.len(),
            total_dependencies,
        }
    }
}
