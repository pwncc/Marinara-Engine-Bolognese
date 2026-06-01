use super::actions;
use super::shell::MariShellSession;
use super::util;
use super::workspace;
use crate::state::AppState;
use autoagents::async_trait;
use autoagents::core::tool::{ToolCallError, ToolRuntime, ToolT};
use marinara_core::{AppError, AppResult};
use serde_json::{json, Map, Value};
use std::fmt;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
enum PiToolKind {
    Read,
    Bash,
    Edit,
    Write,
}

impl PiToolKind {
    fn can_mutate(self) -> bool {
        !matches!(self, Self::Read)
    }
}

#[derive(Clone)]
struct PiLikeTool {
    kind: PiToolKind,
    state: AppState,
    session: Arc<MariShellSession>,
}

impl fmt::Debug for PiLikeTool {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PiLikeTool")
            .field("kind", &self.kind)
            .finish()
    }
}

#[async_trait]
impl ToolRuntime for PiLikeTool {
    async fn execute(&self, args: Value) -> Result<Value, ToolCallError> {
        let started_at = chrono::Utc::now().to_rfc3339();
        let tool_name = self.name().to_string();
        let args_for_trace = summarize_tool_args(&tool_name, &args);
        self.session.record_debug_log(
            "tool_start",
            json!({
                "tool": &tool_name,
                "startedAt": &started_at,
                "arguments": &args,
            }),
        );
        let result = self.execute_with_review(args, &tool_name).await;
        match result {
            Ok(value) => {
                self.session.record_debug_log(
                    "tool_result",
                    json!({
                        "tool": &tool_name,
                        "startedAt": &started_at,
                        "finishedAt": chrono::Utc::now().to_rfc3339(),
                        "result": &value,
                    }),
                );
                self.session.record_trace(json!({
                    "type": "tool_result",
                    "label": tool_label(&tool_name),
                    "tool": tool_name,
                    "startedAt": started_at,
                    "finishedAt": chrono::Utc::now().to_rfc3339(),
                    "arguments": args_for_trace,
                    "result": summarize_tool_result(&value),
                    "status": "success",
                }));
                Ok(value)
            }
            Err(error) => {
                let message = error.message.clone();
                self.session.record_debug_log(
                    "tool_error",
                    json!({
                        "tool": &tool_name,
                        "startedAt": &started_at,
                        "finishedAt": chrono::Utc::now().to_rfc3339(),
                        "error": &message,
                    }),
                );
                self.session.record_trace(json!({
                    "type": "tool_result",
                    "label": tool_label(&tool_name),
                    "tool": tool_name,
                    "startedAt": started_at,
                    "finishedAt": chrono::Utc::now().to_rfc3339(),
                    "arguments": args_for_trace,
                    "error": message,
                    "status": "error",
                }));
                Err(tool_runtime_error(error))
            }
        }
    }
}

impl ToolT for PiLikeTool {
    fn name(&self) -> &str {
        match self.kind {
            PiToolKind::Read => "read",
            PiToolKind::Bash => "bash",
            PiToolKind::Edit => "edit",
            PiToolKind::Write => "write",
        }
    }

    fn description(&self) -> &str {
        match self.kind {
            PiToolKind::Read => "Read a file or directory from the virtual workspace. Directory paths return index.md when present, otherwise a listing. Supports optional 1-indexed offset and line limit.",
            PiToolKind::Bash => "Execute bash commands in the isolated virtual workspace. Visible library changes are approval-gated after the command finishes.",
            PiToolKind::Edit => "Edit a text file using exact text replacement. oldText must match exactly once. Visible library changes are approval-gated after the edit finishes.",
            PiToolKind::Write => "Create or overwrite a text file in the virtual workspace. Visible library changes are approval-gated after the write finishes.",
        }
    }

    fn args_schema(&self) -> Value {
        match self.kind {
            PiToolKind::Read => {
                json!({"type":"object","properties":{"path":{"type":"string"},"offset":{"type":"integer","minimum":1},"limit":{"type":"integer","minimum":1}},"required":["path"]})
            }
            PiToolKind::Bash => {
                json!({"type":"object","properties":{"command":{"type":"string"}},"required":["command"]})
            }
            PiToolKind::Edit => {
                json!({"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"}},"required":["path","oldText","newText"]})
            }
            PiToolKind::Write => {
                json!({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})
            }
        }
    }
}

impl PiLikeTool {
    async fn execute_with_review(&self, args: Value, tool_name: &str) -> AppResult<Value> {
        if !self.kind.can_mutate() {
            return self.execute_inner(args).await;
        }

        let _guard = self.session.tool_review_guard().await;
        let before_vfs = self.session.vfs_snapshot()?;
        let value = match self.execute_inner(args).await {
            Ok(value) => value,
            Err(error) => {
                self.session.restore_vfs_snapshot(&before_vfs)?;
                return Err(error);
            }
        };

        let action = actions::staged_mari_action_contract(&self.state, &self.session).await?;
        if change_count(&action) == 0 {
            return Ok(value);
        }
        if storage_action_count(&action) == 0 {
            if unmapped_change_count(&action) > 0 {
                self.session.record_trace(json!({
                    "type": "changes_not_visible",
                    "label": "No library changes",
                    "tool": tool_name,
                    "status": "success",
                    "summary": "Workspace changes did not map to visible library records, so no approval was needed.",
                    "error": unmapped_change_details(&action),
                }));
            }
            self.session.accept_current_as_baseline().await?;
            return Ok(value);
        }

        let (_, outcome) = review_staged_changes(
            &self.state,
            &self.session,
            tool_name,
            &format!("Review {} changes", tool_label(tool_name).to_ascii_lowercase()),
        )
        .await?;
        let Some(outcome) = outcome else {
            return Ok(value);
        };
        if !outcome
            .get("approved")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            self.session.restore_vfs_snapshot(&before_vfs)?;
            self.session.accept_current_as_baseline().await?;
        }
        Ok(with_approval_outcome(value, outcome))
    }

    async fn execute_inner(&self, args: Value) -> AppResult<Value> {
        match self.kind {
            PiToolKind::Read => self.tool_read(args).await,
            PiToolKind::Bash => self.tool_bash(args).await,
            PiToolKind::Edit => self.tool_edit(args).await,
            PiToolKind::Write => self.tool_write(args).await,
        }
    }

    async fn tool_read(&self, args: Value) -> AppResult<Value> {
        let path = required_str(&args, "path")?;
        let offset = args
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as usize;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map(|v| v.max(1) as usize);
        self.session.read_for_tool(path, offset, limit).await
    }

    async fn tool_bash(&self, args: Value) -> AppResult<Value> {
        self.session
            .exec_bash(required_str(&args, "command")?)
            .await
    }

    async fn tool_edit(&self, args: Value) -> AppResult<Value> {
        self.session
            .edit_text(
                required_str(&args, "path")?,
                required_str(&args, "oldText")?,
                required_str(&args, "newText")?,
            )
            .await
    }

    async fn tool_write(&self, args: Value) -> AppResult<Value> {
        self.session
            .write_text(
                required_str(&args, "path")?,
                required_string_value(&args, "content")?,
            )
            .await
    }
}

fn tool_label(name: &str) -> String {
    match name {
        "read" => "Read file",
        "bash" => "Run bash",
        "edit" => "Edit file",
        "write" => "Write file",
        _ => "Use tool",
    }
    .to_string()
}

fn summarize_tool_args(tool: &str, args: &Value) -> Value {
    match tool {
        "read" => json!({
            "path": args.get("path").cloned().unwrap_or(Value::Null),
            "offset": args.get("offset").cloned().unwrap_or(Value::Null),
            "limit": args.get("limit").cloned().unwrap_or(Value::Null),
        }),
        "bash" => json!({
            "command": args.get("command").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
        }),
        "edit" => json!({
            "path": args.get("path").cloned().unwrap_or(Value::Null),
            "oldText": args.get("oldText").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
            "newText": args.get("newText").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
        }),
        "write" => json!({
            "path": args.get("path").cloned().unwrap_or(Value::Null),
            "content": args.get("content").and_then(Value::as_str).map(util::truncate_tool_text).unwrap_or_default(),
        }),
        _ => args.clone(),
    }
}

fn summarize_tool_result(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let next = match value {
                        Value::String(text) => Value::String(util::truncate_tool_text(text)),
                        _ => value.clone(),
                    };
                    (key.clone(), next)
                })
                .collect(),
        ),
        Value::String(text) => Value::String(util::truncate_tool_text(text)),
        _ => value.clone(),
    }
}

fn with_approval_outcome(value: Value, outcome: Value) -> Value {
    let approved = outcome
        .get("approved")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let status = if approved { "approved" } else { "rejected" };
    let message = if approved {
        "User approved this tool call. Visible library changes were applied."
    } else {
        "User rejected this tool call. Visible library changes were not applied."
    };
    let mut response = Map::new();
    response.insert("approval".to_string(), json!(status));
    response.insert("message".to_string(), json!(message));
    if let Some(path) = value.get("path").and_then(Value::as_str) {
        response.insert("path".to_string(), json!(path));
    }
    if let Some(exit_code) = value.get("exitCode") {
        response.insert("exitCode".to_string(), exit_code.clone());
    }
    if let Some(stdout) = value.get("stdout") {
        response.insert("stdout".to_string(), stdout.clone());
    }
    if let Some(stderr) = value.get("stderr") {
        response.insert("stderr".to_string(), stderr.clone());
    }
    Value::Object(response)
}

fn apply_storage_actions_if_needed(state: &AppState, action: &Value) -> AppResult<Value> {
    if storage_action_count(action) == 0 {
        return Err(AppError::invalid_input(
            "No creative-library storage changes were available to apply",
        ));
    }
    actions::professor_mari_apply_staged_changes(state, action.clone())
}

pub(crate) async fn review_final_changes(
    state: &AppState,
    session: &Arc<MariShellSession>,
) -> AppResult<(Value, Option<Value>)> {
    review_staged_changes(state, session, "final_review", "Review library changes").await
}

async fn review_staged_changes(
    state: &AppState,
    session: &Arc<MariShellSession>,
    tool_name: &str,
    label: &str,
) -> AppResult<(Value, Option<Value>)> {
    let action = actions::staged_mari_action_contract(state, session).await?;
    if change_count(&action) == 0 {
        return Ok((action, None));
    }

    if storage_action_count(&action) == 0 {
        session.record_trace(json!({
            "type": "changes_not_visible",
            "label": "No library changes",
            "status": "success",
            "summary": approval_summary(&action),
            "error": unmapped_change_details(&action),
        }));
        return Ok((action, None));
    }

    if !session.has_stream_events() {
        session.record_trace(json!({
            "type": "approval_required",
            "label": label,
            "status": "waiting",
            "summary": approval_summary(&action),
        }));
        return Ok((action, None));
    }

    let approval_id = session.next_approval_id(tool_name);
    let requested_at = chrono::Utc::now().to_rfc3339();
    let receiver = state.register_mari_approval(&approval_id)?;
    let approval = json!({
        "id": approval_id,
        "tool": tool_name,
        "label": label,
        "requestedAt": requested_at,
        "action": &action,
        "result": Value::Null,
    });
    session.record_debug_log("approval_request", approval.clone());
    session.record_trace(json!({
        "type": "approval_request",
        "label": label,
        "tool": tool_name,
        "status": "waiting",
        "summary": approval_summary(&action),
        "approvalId": approval_id,
    }));

    if let Err(error) = session.send_stream_event(json!({
        "type": "approval_request",
        "approval": approval,
    })) {
        state.cancel_mari_approval(&approval_id);
        return Err(error);
    }

    let approved = receiver.await.map_err(|_| {
        AppError::new(
            "mari_approval_cancelled",
            "Professor Mari approval was cancelled before a decision was received",
        )
    })?;

    if !approved {
        let outcome = approval_outcome(&approval_id, false, &action, None, None);
        session.record_debug_log(
            "approval_resolved",
            json!({
                "approvalId": &approval_id,
                "approved": false,
                "outcome": &outcome,
            }),
        );
        session.record_trace(json!({
            "type": "approval_resolved",
            "label": "Changes rejected",
            "tool": tool_name,
            "status": "rejected",
            "summary": "No library changes were saved. The rejected workspace draft was not carried into another approval request.",
            "approvalId": approval_id,
        }));
        let _ = session.send_stream_event(json!({
            "type": "approval_resolved",
            "approvalId": approval_id,
            "approved": false,
            "outcome": outcome,
        }));
        return Ok((action, Some(outcome)));
    }

    session.record_debug_log("storage_apply_start", json!({ "action": &action }));
    let apply_result = match apply_storage_actions_if_needed(state, &action) {
        Ok(result) => result,
        Err(error) => {
            let message = error.message.clone();
            session.record_debug_log("storage_apply_error", json!({ "error": &message }));
            let _ = session.send_stream_event(json!({
                "type": "approval_resolved",
                "approvalId": approval_id,
                "approved": true,
                "error": message,
            }));
            return Err(error);
        }
    };
    session.record_debug_log("storage_apply_result", json!({ "result": &apply_result }));
    absorb_storage_action_bindings(session, &action, &apply_result);
    session.accept_current_as_baseline().await?;
    let outcome = approval_outcome(&approval_id, true, &action, Some(&apply_result), None);
    session.record_debug_log(
        "approval_resolved",
        json!({
            "approvalId": &approval_id,
            "approved": true,
            "outcome": &outcome,
            "applyResult": &apply_result,
        }),
    );
    session.record_trace(json!({
        "type": "approval_resolved",
        "label": "Changes approved",
        "tool": tool_name,
        "status": "approved",
        "summary": approval_summary(&action),
        "approvalId": approval_id,
    }));
    let _ = session.send_stream_event(json!({
        "type": "approval_resolved",
        "approvalId": approval_id,
        "approved": true,
        "outcome": outcome,
        "applied": summarize_apply_result(&apply_result),
    }));
    Ok((action, Some(outcome)))
}

fn approval_outcome(
    approval_id: &str,
    approved: bool,
    action: &Value,
    apply_result: Option<&Value>,
    error: Option<&str>,
) -> Value {
    json!({
        "id": approval_id,
        "status": if approved { "approved" } else { "rejected" },
        "approved": approved,
        "changeCount": change_count(action),
        "storageActionCount": storage_action_count(action),
        "unmappedChangeCount": unmapped_change_count(action),
        "summary": approval_summary(action),
        "applied": apply_result.map(summarize_apply_result).unwrap_or(Value::Null),
        "error": error,
    })
}

fn summarize_apply_result(value: &Value) -> Value {
    json!({
        "applied": value.get("applied").and_then(Value::as_u64).unwrap_or_default(),
        "appliedAt": value.get("appliedAt").cloned().unwrap_or(Value::Null),
        "results": value
            .get("results")
            .and_then(Value::as_array)
            .map(|results| {
                results
                    .iter()
                    .map(|result| json!({
                        "type": result.get("type").cloned().unwrap_or(Value::Null),
                        "entity": result.get("entity").cloned().unwrap_or(Value::Null),
                        "id": result
                            .get("id")
                            .cloned()
                            .or_else(|| result.get("record").and_then(|record| record.get("id")).cloned())
                            .unwrap_or(Value::Null),
                    }))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    })
}

fn approval_summary(action: &Value) -> String {
    let changes = change_count(action);
    let storage_actions = storage_action_count(action);
    let unmapped = unmapped_change_count(action);
    match (storage_actions, unmapped) {
        (0, 0) => format!("{changes} workspace file change{} ready for review before Mari's next step.", plural(changes)),
        (0, _) => format!(
            "{changes} workspace file change{} need review; {unmapped} cannot be applied to storage automatically.",
            plural(changes)
        ),
        (_, 0) => format!(
            "{storage_actions} library update{} from {changes} file change{}.",
            plural(storage_actions),
            plural(changes)
        ),
        _ => format!(
            "{storage_actions} library update{} plus {unmapped} workspace-only change{}.",
            plural(storage_actions),
            plural(unmapped)
        ),
    }
}

fn change_count(action: &Value) -> usize {
    action
        .get("changes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn storage_action_count(action: &Value) -> usize {
    action
        .get("storageActions")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn unmapped_change_count(action: &Value) -> usize {
    action
        .get("unmappedChanges")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn unmapped_change_details(action: &Value) -> String {
    let Some(unmapped) = action.get("unmappedChanges").and_then(Value::as_array) else {
        return String::new();
    };
    if unmapped.is_empty() {
        return String::new();
    }
    let details = unmapped
        .iter()
        .take(3)
        .map(|change| {
            let path = change
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("unknown path");
            let reason = change
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("not mapped to a storage field");
            format!(" `{path}`: {reason}")
        })
        .collect::<Vec<_>>()
        .join(";");
    let more = unmapped.len().saturating_sub(3);
    if more > 0 {
        format!(" Unmapped changes:{details}; and {more} more.")
    } else {
        format!(" Unmapped changes:{details}.")
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

fn absorb_storage_action_bindings(
    session: &MariShellSession,
    action: &Value,
    apply_result: &Value,
) {
    let Some(storage_actions) = action.get("storageActions").and_then(Value::as_array) else {
        return;
    };
    let results = apply_result
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for (index, storage_action) in storage_actions.iter().enumerate() {
        let Some(entity) = storage_action.get("entity").and_then(Value::as_str) else {
            continue;
        };
        let id = storage_action
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| {
                results
                    .get(index)
                    .and_then(|result| result.get("record"))
                    .and_then(|record| record.get("id"))
                    .and_then(Value::as_str)
            });
        let Some(id) = id else {
            continue;
        };
        let Some(paths) = storage_action.get("paths").and_then(Value::as_array) else {
            continue;
        };
        for path in paths.iter().filter_map(Value::as_str) {
            if let Some(field) = field_for_workspace_path(entity, path) {
                session.bind_workspace_file(
                    util::resolve_virtual_path(path),
                    entity.to_string(),
                    id.to_string(),
                    field.to_string(),
                );
            }
        }
        add_generated_child_scaffolds(session, storage_action, entity);
    }
}

fn add_generated_child_scaffolds(session: &MariShellSession, storage_action: &Value, entity: &str) {
    if storage_action.get("type").and_then(Value::as_str) != Some("create_record") {
        return;
    }
    let Some(folder_path) = storage_action
        .get("paths")
        .and_then(Value::as_array)
        .and_then(|paths| paths.iter().filter_map(Value::as_str).next())
        .and_then(record_folder_for_file_path)
    else {
        return;
    };

    match entity {
        "lorebooks" => add_generated_collection_scaffold(
            session,
            &format!("{folder_path}/entries"),
            "entries",
            "lorebook-entries",
        ),
        "prompts" => {
            add_generated_collection_scaffold(
                session,
                &format!("{folder_path}/sections"),
                "sections",
                "prompt-sections",
            );
            add_generated_collection_scaffold(
                session,
                &format!("{folder_path}/groups"),
                "groups",
                "prompt-groups",
            );
            add_generated_collection_scaffold(
                session,
                &format!("{folder_path}/variables"),
                "variables",
                "prompt-variables",
            );
        }
        _ => {}
    }
}

fn add_generated_collection_scaffold(
    session: &MariShellSession,
    folder_path: &str,
    collection_name: &str,
    child_entity: &str,
) {
    session.add_generated_text_file(
        format!("{folder_path}/FORMAT.md"),
        workspace::format_guide_for_entity(child_entity),
    );
    session.add_generated_text_file(
        format!("{folder_path}/index.md"),
        workspace::collection_index_title(collection_name, Vec::new()),
    );
}

fn record_folder_for_file_path(path: &str) -> Option<String> {
    let normalized = util::normalize_virtual_path(path);
    normalized
        .rsplit_once('/')
        .map(|(folder, _)| folder.to_string())
}

fn field_for_workspace_path(entity: &str, path: &str) -> Option<&'static str> {
    let file_name = path.rsplit('/').next()?;
    if file_name == "metadata.json" {
        return Some("metadata");
    }
    if file_name == "keys.txt" {
        return Some("keys");
    }
    let stem = file_name.strip_suffix(".md")?;
    let field = workspace_text_fields_for_entity(entity)
        .iter()
        .copied()
        .find(|field| workspace::field_file_name(field) == stem)?;
    match (entity, field) {
        ("prompt-sections", "prompt" | "text") => Some("content"),
        _ => Some(field),
    }
}

fn workspace_text_fields_for_entity(entity: &str) -> &'static [&'static str] {
    match entity {
        "characters" => &[
            "data.description",
            "data.personality",
            "data.scenario",
            "data.first_mes",
            "data.mes_example",
            "data.creator_notes",
            "data.system_prompt",
            "data.post_history_instructions",
            "data.extensions.backstory",
            "data.extensions.appearance",
        ],
        "character-groups" => &["description", "notes"],
        "personas" => &[
            "description",
            "personality",
            "scenario",
            "backstory",
            "appearance",
            "firstMessage",
            "greeting",
            "notes",
        ],
        "persona-groups" => &["description", "notes"],
        "lorebooks" => &["description", "content", "notes"],
        "lorebook-entries" => &["content", "comment", "description", "notes", "keys"],
        "prompts" => &["description", "prompt", "systemPrompt", "notes"],
        "prompt-sections" => &["prompt", "content", "text", "description"],
        "prompt-groups" => &["description", "notes"],
        "prompt-variables" => &["value", "content", "text", "description"],
        _ => &[],
    }
}

pub(crate) fn build_pi_like_tools(
    state: AppState,
    session: Arc<MariShellSession>,
) -> Vec<Arc<dyn ToolT>> {
    [
        PiToolKind::Read,
        PiToolKind::Bash,
        PiToolKind::Edit,
        PiToolKind::Write,
    ]
    .into_iter()
    .map(|kind| {
        Arc::new(PiLikeTool {
            kind,
            state: state.clone(),
            session: session.clone(),
        }) as Arc<dyn ToolT>
    })
    .collect()
}

fn required_str<'a>(value: &'a Value, key: &str) -> AppResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input(format!("missing required string field `{key}`")))
}

fn required_string_value<'a>(value: &'a Value, key: &str) -> AppResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input(format!("missing required string field `{key}`")))
}

fn tool_runtime_error(error: AppError) -> ToolCallError {
    ToolCallError::RuntimeError(Box::new(std::io::Error::other(error.to_string())))
}
