use super::file_changes::{self, MariFileChange};
use super::prompt;
use super::types::MariPromptRequest;
use super::util;
use super::workspace::{MariWorkspaceBinding, MariWorkspaceSeed};
use super::MARI_SYSTEM_PROMPT;
use bashkit::{
    async_trait as bashkit_async_trait, Bash, DirEntry, FileSystem, FileSystemExt, FileType,
    InMemoryFs, Metadata,
};
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tokio::sync::Mutex;

#[derive(Clone)]
pub(crate) struct MariShellSession {
    fs: Arc<TrackingFs>,
    bash: Arc<Mutex<Bash>>,
    initial_files: Arc<RwLock<BTreeMap<String, Vec<u8>>>>,
    pub(crate) manifest: Arc<BTreeMap<String, MariWorkspaceBinding>>,
    trace: Arc<RwLock<Vec<Value>>>,
    trace_channel: tauri::ipc::Channel<Value>,
}

impl MariShellSession {
    pub(crate) async fn new(
        input: &MariPromptRequest,
        workspace_seed: MariWorkspaceSeed,
        trace_channel: tauri::ipc::Channel<Value>,
    ) -> AppResult<Arc<Self>> {
        let fs = Arc::new(TrackingFs::new());
        fs.add_text_file("/workspace/system-prompt.md", MARI_SYSTEM_PROMPT);
        fs.add_text_file("/workspace/README.md", PROF_MARI_WORKSPACE_README);
        if let Some(persona) = prompt::build_persona_context(input.persona.as_ref()) {
            fs.add_text_file("/workspace/active-persona.md", &persona);
        }
        for file in &workspace_seed.files {
            fs.add_text_file(&file.path, &file.content);
        }
        for file in &input.workspace_files {
            let path = util::resolve_virtual_path(&file.path);
            fs.add_text_file(&path, &file.content);
        }
        for attachment in &input.attachments {
            if !attachment.r#type.to_ascii_lowercase().starts_with("image/") {
                let safe_name = util::sanitize_filename(&attachment.name);
                fs.add_text_file(
                    format!("/workspace/attachments/{safe_name}").as_str(),
                    &attachment.content,
                );
            }
        }
        let bash = Bash::builder()
            .fs(fs.clone())
            .cwd("/workspace")
            .env("HOME", "/workspace")
            .env("USER", "prof-mari")
            .build();
        let session = Arc::new(Self {
            fs,
            bash: Arc::new(Mutex::new(bash)),
            initial_files: Arc::new(RwLock::new(BTreeMap::new())),
            manifest: Arc::new(workspace_seed.bindings),
            trace: Arc::new(RwLock::new(Vec::new())),
            trace_channel,
        });
        let initial = session.snapshot_review_files().await?;
        *session.initial_files.write().unwrap() = initial;
        Ok(session)
    }

    pub(crate) async fn exec_bash(&self, command: &str) -> AppResult<Value> {
        let mut bash = self.bash.lock().await;
        let output = bash
            .exec(command)
            .await
            .map_err(|error| AppError::new("mari_bash_failed", error.to_string()))?;
        drop(bash);
        Ok(json!({
            "stdout": util::truncate_tool_text(&output.stdout),
            "stderr": util::truncate_tool_text(&output.stderr),
            "exitCode": output.exit_code,
            "pendingChanges": self.pending_changes().await?,
        }))
    }

    pub(crate) async fn read_text(&self, path: &str) -> AppResult<String> {
        let path = util::resolve_virtual_path(path);
        let bytes = self
            .fs
            .read_file(Path::new(&path))
            .await
            .map_err(|error| AppError::new("mari_read_failed", error.to_string()))?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    pub(crate) async fn write_text(&self, path: &str, content: &str) -> AppResult<Value> {
        let path = util::resolve_virtual_path(path);
        ensure_parent_dirs(&self.fs, Path::new(&path)).await?;
        self.fs
            .write_file(Path::new(&path), content.as_bytes())
            .await
            .map_err(|error| AppError::new("mari_write_failed", error.to_string()))?;
        Ok(json!({ "path": path, "pendingChanges": self.pending_changes().await? }))
    }

    pub(crate) async fn edit_text(
        &self,
        path: &str,
        old_text: &str,
        new_text: &str,
    ) -> AppResult<Value> {
        let path = util::resolve_virtual_path(path);
        let current = self.read_text(&path).await?;
        let matches = current.matches(old_text).count();
        if matches != 1 {
            return Err(AppError::invalid_input(format!(
                "edit expected oldText to match exactly once, found {matches} matches"
            )));
        }
        let updated = current.replacen(old_text, new_text, 1);
        self.write_text(&path, &updated).await
    }

    pub(crate) async fn pending_file_changes(&self) -> AppResult<Vec<MariFileChange>> {
        let current = self.snapshot_review_files().await?;
        let initial = self.initial_files.read().unwrap().clone();
        Ok(file_changes::diff_file_maps_full(&initial, &current))
    }

    pub(crate) async fn pending_changes(&self) -> AppResult<Vec<Value>> {
        Ok(self
            .pending_file_changes()
            .await?
            .iter()
            .map(file_changes::file_change_summary)
            .collect())
    }

    pub(crate) fn record_trace(&self, event: Value) {
        self.trace.write().unwrap().push(event.clone());
        let _ = self
            .trace_channel
            .send(json!({ "type": "trace", "event": event }));
    }

    pub(crate) fn trace_events(&self) -> Vec<Value> {
        self.trace.read().unwrap().clone()
    }

    pub(crate) fn manifest_summary(&self) -> Value {
        let mut by_entity: BTreeMap<&str, usize> = BTreeMap::new();
        let mut text_field_bindings = 0usize;
        for binding in self.manifest.values() {
            *by_entity.entry(binding.entity.as_str()).or_default() += 1;
            if binding
                .field
                .as_deref()
                .is_some_and(|field| field != "metadata")
            {
                text_field_bindings += 1;
            }
            let _ = binding.id.as_str();
        }
        json!({
            "boundFiles": self.manifest.len(),
            "textFieldBindings": text_field_bindings,
            "byEntity": by_entity,
        })
    }

    async fn snapshot_review_files(&self) -> AppResult<BTreeMap<String, Vec<u8>>> {
        let mut files = BTreeMap::new();
        collect_files_recursive(&self.fs, Path::new("/workspace"), &mut files).await?;
        Ok(files)
    }
}

const PROF_MARI_WORKSPACE_README: &str = "# Prof Mari virtual workspace\n\nThis is an isolated bash workspace populated from the user's Marinara creative library. Start at `/workspace/index.md`, then inspect folders such as `characters/`, `personas/`, `lorebooks/`, and `prompts/`. Paths are descriptive and duplicate-safe; Marinara tracks hidden storage IDs internally. Changes remain staged for user review.\n\nTo create a new top-level character, persona, lorebook, prompt, or group, create a new folder under the matching collection and write `metadata.json` plus any supported text field files shown by nearby records. For characters, put the name in `metadata.json` under `data.name`; use files like `description.md`, `personality.md`, and `first_mes.md` for long text.\n";

struct TrackingFs {
    inner: InMemoryFs,
}

impl fmt::Debug for TrackingFs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TrackingFs").finish()
    }
}

impl TrackingFs {
    fn new() -> Self {
        Self {
            inner: InMemoryFs::new(),
        }
    }

    fn add_text_file(&self, path: &str, content: &str) {
        self.inner.add_file(path, content.as_bytes(), 0o644);
    }
}

#[bashkit_async_trait]
impl FileSystemExt for TrackingFs {
    fn usage(&self) -> bashkit::FsUsage {
        self.inner.usage()
    }

    fn limits(&self) -> bashkit::FsLimits {
        self.inner.limits()
    }

    fn vfs_snapshot(&self) -> Option<bashkit::VfsSnapshot> {
        self.inner.vfs_snapshot()
    }

    fn vfs_restore(&self, snapshot: &bashkit::VfsSnapshot) -> bashkit::Result<()> {
        self.inner.vfs_restore(snapshot)
    }
}

#[bashkit_async_trait]
impl FileSystem for TrackingFs {
    async fn read_file(&self, path: &Path) -> bashkit::Result<Vec<u8>> {
        self.inner.read_file(path).await
    }
    async fn write_file(&self, path: &Path, content: &[u8]) -> bashkit::Result<()> {
        self.inner.write_file(path, content).await
    }
    async fn append_file(&self, path: &Path, content: &[u8]) -> bashkit::Result<()> {
        self.inner.append_file(path, content).await
    }
    async fn mkdir(&self, path: &Path, recursive: bool) -> bashkit::Result<()> {
        self.inner.mkdir(path, recursive).await
    }
    async fn remove(&self, path: &Path, recursive: bool) -> bashkit::Result<()> {
        self.inner.remove(path, recursive).await
    }
    async fn stat(&self, path: &Path) -> bashkit::Result<Metadata> {
        self.inner.stat(path).await
    }
    async fn read_dir(&self, path: &Path) -> bashkit::Result<Vec<DirEntry>> {
        self.inner.read_dir(path).await
    }
    async fn exists(&self, path: &Path) -> bashkit::Result<bool> {
        self.inner.exists(path).await
    }
    async fn rename(&self, from: &Path, to: &Path) -> bashkit::Result<()> {
        self.inner.rename(from, to).await
    }
    async fn copy(&self, from: &Path, to: &Path) -> bashkit::Result<()> {
        self.inner.copy(from, to).await
    }
    async fn symlink(&self, target: &Path, link: &Path) -> bashkit::Result<()> {
        self.inner.symlink(target, link).await
    }
    async fn read_link(&self, path: &Path) -> bashkit::Result<PathBuf> {
        self.inner.read_link(path).await
    }
    async fn chmod(&self, path: &Path, mode: u32) -> bashkit::Result<()> {
        self.inner.chmod(path, mode).await
    }
    async fn set_modified_time(&self, path: &Path, time: SystemTime) -> bashkit::Result<()> {
        self.inner.set_modified_time(path, time).await
    }
}

async fn ensure_parent_dirs(fs: &TrackingFs, path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs.mkdir(parent, true)
            .await
            .map_err(|error| AppError::new("mari_mkdir_failed", error.to_string()))?;
    }
    Ok(())
}

async fn collect_files_recursive(
    fs: &TrackingFs,
    path: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> AppResult<()> {
    if !fs
        .exists(path)
        .await
        .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?
    {
        return Ok(());
    }
    let meta = fs
        .stat(path)
        .await
        .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?;
    if meta.file_type == FileType::File {
        let content = fs
            .read_file(path)
            .await
            .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?;
        files.insert(path.to_string_lossy().to_string(), content);
        return Ok(());
    }
    if meta.file_type == FileType::Directory {
        for entry in fs
            .read_dir(path)
            .await
            .map_err(|error| AppError::new("mari_fs_failed", error.to_string()))?
        {
            let child = path.join(entry.name);
            Box::pin(collect_files_recursive(fs, &child, files)).await?;
        }
    }
    Ok(())
}
