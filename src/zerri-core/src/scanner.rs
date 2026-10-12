use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct FileEntry {
    pub path: String,
    pub content: String,
}

pub struct WorkspaceScanner {
    ignored_patterns: Vec<&'static str>,
}

impl WorkspaceScanner {
    pub fn new() -> Self {
        Self {
            ignored_patterns: vec![
                ".git",
                "node_modules",
                "target",
                "dist",
                "out",
                "out-build",
                ".vscode",
                ".bin",
                ".sqlite",
                ".png",
                ".jpg",
                ".jpeg",
                ".gif",
                ".zip",
                ".exe",
                ".dll",
                ".so",
                ".dylib",
            ],
        }
    }

    pub fn scan_dir<P: AsRef<Path>>(&self, root: P) -> Vec<FileEntry> {
        let entries: Vec<PathBuf> = WalkDir::new(root)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !self.ignored_patterns.iter().any(|pat| name == *pat)
            })
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect();

        // Lecture multi-threadée parallèle via Rayon sur tous les cœurs du CPU
        entries
            .par_iter()
            .filter_map(|path| {
                // Ignore les fichiers de plus de 2 Mo pour éviter d'exploser la mémoire
                if let Ok(metadata) = fs::metadata(path) {
                    if metadata.len() > 2 * 1024 * 1024 {
                        return None;
                    }
                }

                if let Ok(content) = fs::read_to_string(path) {
                    Some(FileEntry {
                        path: path.to_string_lossy().to_string(),
                        content,
                    })
                } else {
                    None
                }
            })
            .collect()
    }
}
