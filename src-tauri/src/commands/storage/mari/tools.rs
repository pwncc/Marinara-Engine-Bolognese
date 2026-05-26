use super::shell::MariShellSession;
use super::util;
use autoagents::async_trait;
use autoagents::core::tool::{ToolCallError, ToolRuntime, ToolT};
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::fmt;
use std::sync::Arc;

#[derive(Debug, Clone, Copy)]
enum PiToolKind {
    Read,
    Bash,
    Edit,
    Write,
}

#[derive(Clone)]
struct PiLikeTool {
    kind: PiToolKind,
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
        let result = match self.kind {
            PiToolKind::Read => self.tool_read(args).await,
            PiToolKind::Bash => self.tool_bash(args).await,
            PiToolKind::Edit => self.tool_edit(args).await,
            PiToolKind::Write => self.tool_write(args).await,
        };
        match result {
            Ok(value) => {
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
            PiToolKind::Read => "Read a text file from the virtual workspace. Supports optional 1-indexed offset and line limit.",
            PiToolKind::Bash => "Execute bash commands in the isolated virtual workspace. File changes are staged and returned as pendingChanges.",
            PiToolKind::Edit => "Edit a text file using exact text replacement. oldText must match exactly once.",
            PiToolKind::Write => "Create or overwrite a text file in the virtual workspace.",
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
        let content = self.session.read_text(path).await?;
        let lines: Vec<&str> = content.lines().collect();
        let selected = lines
            .iter()
            .skip(offset - 1)
            .take(limit.unwrap_or(usize::MAX))
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        Ok(
            json!({"path": util::resolve_virtual_path(path), "content": util::truncate_tool_text(&selected), "totalLines": lines.len()}),
        )
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
                required_str(&args, "content")?,
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

pub(crate) fn build_pi_like_tools(session: Arc<MariShellSession>) -> Vec<Arc<dyn ToolT>> {
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

fn tool_runtime_error(error: AppError) -> ToolCallError {
    ToolCallError::RuntimeError(Box::new(std::io::Error::other(error.to_string())))
}
