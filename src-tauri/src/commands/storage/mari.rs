#[path = "mari/actions.rs"]
mod actions;
#[path = "mari/agent.rs"]
mod agent;
#[path = "mari/file_changes.rs"]
mod file_changes;
#[path = "mari/prompt.rs"]
mod prompt;
#[path = "mari/session_memory.rs"]
mod session_memory;
#[path = "mari/shell.rs"]
mod shell;
#[path = "mari/tools.rs"]
mod tools;
#[path = "mari/types.rs"]
mod types;
#[path = "mari/util.rs"]
mod util;
#[path = "mari/workspace.rs"]
mod workspace;

use super::llm::{llm_connection_from_value, resolve_llm_connection_for_request};
use crate::state::AppState;
use agent::{MarinaraLlmProvider, ProfessorMariAgent};
use autoagents::core::agent::prebuilt::executor::ReActAgent;
use autoagents::core::agent::task::Task;
use autoagents::core::agent::{AgentBuilder, DirectAgent};
use autoagents::llm::LLMProvider;
use marinara_core::{AppError, AppResult};
use prompt::build_task_prompt;
use serde_json::{json, Value};
use session_memory::{reset_mari_session_memory, MariSessionMemory};
use shell::MariShellSession;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tools::{build_pi_like_tools, review_final_changes};
use types::MariPromptRequest;
use workspace::build_mari_workspace_seed;

pub(crate) const MARI_TEXT_ATTACHMENT_CHAR_LIMIT: usize = 60_000;
pub(crate) const MARI_TOOL_TEXT_LIMIT: usize = 32_000;
pub(crate) const MARI_METADATA_STRING_LIMIT: usize = 4_000;
pub(crate) const MARI_MODEL_OUTPUT_TOKENS: u64 = 0;
pub(crate) const MARI_AGENT_MIN_TURNS: usize = 4;
pub(crate) const MARI_AGENT_MAX_TURNS: usize = 128;
pub(crate) const MARI_AGENT_DEFAULT_TURNS: usize = 48;
pub(crate) const MARI_SESSION_MEMORY_MIN_WINDOW: usize = 20;
pub(crate) const MARI_SESSION_MEMORY_MAX_WINDOW: usize = 200;
pub(crate) const MARI_SESSION_MEMORY_DEFAULT_WINDOW: usize = 80;
pub(crate) const MARI_CHARACTER_PROMPT: &str =
    "You are Professor Mari: warm, direct, and practical.";

pub(crate) fn mari_system_prompt() -> &'static str {
    static PROMPT: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PROMPT
        .get_or_init(|| {
            let date = chrono::Utc::now().format("%Y-%m-%d");
            format!(
                r#"{character}

You are an expert coding assistant operating inside Professor Mari, a Marinara creative-library agent harness. You help users by reading files, executing commands, editing records, and writing new files.

Available tools:
- read: Read file contents or virtual workspace directories
- bash: Execute Bashkit commands for inspection and simple file operations
- edit: Make precise file edits with exact text replacement
- write: Create or overwrite one text file

Guidelines:
- Use bash for inspection/file operations like ls, find, grep, and mkdir.
- Do not use Python; the workspace only exposes explicit tools and Bashkit builtins.
- Use multiple write calls for bulk record/file creation instead of long bash here-docs; visible library changes are approval-gated after each mutating tool call.
- Use read to examine files instead of cat or sed.
- Use edit for precise changes; oldText must match exactly.
- Use write only for one new file or one complete rewrite.
- Be conversational in your responses. After tools and approvals, explain what happened and what you did, not only raw save counts.
- Show file paths clearly when working with files.
- Do not edit generated FORMAT.md or index.md files.
- The latest user message is authoritative; use previous conversation only as context.
- When continuing earlier library work, verify remembered workspace paths still exist before writing nested records.
- Approval decisions are tool results, not user chat messages. If a change is approved, continue or reply naturally; do not stop at a bare save count. If a change is rejected, acknowledge it and revise or ask what to change.

The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory.

<available_skills>
  <skill>
    <name>lorebooks</name>
    <description>Create, edit, inspect, or organize lorebooks and lorebook entries.</description>
    <location>/workspace/skills/lorebooks/SKILL.md</location>
  </skill>
  <skill>
    <name>characters</name>
    <description>Create, edit, inspect, or organize character records.</description>
    <location>/workspace/skills/characters/SKILL.md</location>
  </skill>
  <skill>
    <name>personas</name>
    <description>Create, edit, inspect, or organize user personas.</description>
    <location>/workspace/skills/personas/SKILL.md</location>
  </skill>
  <skill>
    <name>prompts</name>
    <description>Create, edit, inspect, or organize prompt presets, sections, groups, and variables.</description>
    <location>/workspace/skills/prompts/SKILL.md</location>
  </skill>
</available_skills>

Current date: {date}
Current working directory: /workspace"#,
                character = MARI_CHARACTER_PROMPT,
                date = date,
            )
        })
        .as_str()
}
pub(crate) const MARI_STORAGE_ACTION_ENTITIES: &[&str] = &[
    "characters",
    "character-groups",
    "personas",
    "persona-groups",
    "lorebooks",
    "lorebook-entries",
    "prompts",
    "prompt-sections",
    "prompt-groups",
    "prompt-variables",
];

pub(crate) async fn professor_mari_prompt(state: &AppState, body: Value) -> AppResult<Value> {
    professor_mari_prompt_with_events(state, body, None).await
}

pub(crate) async fn professor_mari_prompt_with_events(
    state: &AppState,
    body: Value,
    trace_channel: Option<tauri::ipc::Channel<Value>>,
) -> AppResult<Value> {
    let input: MariPromptRequest =
        serde_json::from_value(body).map_err(|error| AppError::invalid_input(error.to_string()))?;
    let Some(connection_id) = input
        .connection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return Err(AppError::invalid_input(
            "No connection set for this chat! Click the \"chains\" icon in the input box to select one.",
        ));
    };
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let (content, action, trace) = run_mari_agent(state, connection, &input, trace_channel).await?;

    if content.trim().is_empty() {
        return Err(AppError::new(
            "mari_empty_response",
            "Professor Mari returned an empty response. Try again or select a different connection.",
        ));
    }

    Ok(json!({
        "content": content,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "action": action,
        "trace": trace,
    }))
}

pub(crate) fn professor_mari_apply_staged_changes(
    state: &AppState,
    action: Value,
) -> AppResult<Value> {
    actions::professor_mari_apply_staged_changes(state, action)
}

pub(crate) fn professor_mari_resolve_approval(
    state: &AppState,
    approval_id: String,
    approved: bool,
) -> AppResult<Value> {
    state.resolve_mari_approval(&approval_id, approved)?;
    Ok(json!({
        "resolved": true,
        "approvalId": approval_id,
        "approved": approved,
    }))
}

pub(crate) fn professor_mari_reset_session(state: &AppState) -> AppResult<Value> {
    reset_mari_session_memory(&state.data_dir)?;
    Ok(json!({ "reset": true }))
}

async fn run_mari_agent(
    state: &AppState,
    connection: marinara_llm::LlmConnection,
    input: &MariPromptRequest,
    trace_channel: Option<tauri::ipc::Channel<Value>>,
) -> AppResult<(String, Value, Vec<Value>)> {
    let workspace_seed = build_mari_workspace_seed(state)?;
    let debug_log_path = create_mari_debug_log_path(&state.data_dir)?;
    let session =
        MariShellSession::new(input, workspace_seed, trace_channel, Some(debug_log_path)).await?;
    let task_prompt = build_task_prompt(input);
    session.record_debug_log(
        "session_start",
        json!({
            "request": prompt_request_log_value(input),
            "debugLogPath": session.debug_log_path().map(|path| path.to_string_lossy().to_string()),
        }),
    );
    session.record_debug_log("task_prompt", json!({ "prompt": task_prompt }));
    if let Some(path) = session.debug_log_path() {
        session.record_trace(json!({
            "type": "debug_log",
            "label": "Debug log",
            "status": "success",
            "summary": format!("Full Professor Mari run log: {}", path.to_string_lossy()),
            "content": path.to_string_lossy().to_string(),
        }));
    }
    let max_turns = mari_agent_max_turns(input);
    let memory_window = mari_session_memory_window(input);
    let memory = MariSessionMemory::load(&state.data_dir, memory_window)?;
    memory.seed_from_prompt_messages_if_empty(&input.messages)?;
    session.record_debug_log(
        "backend_session",
        json!({
            "memoryMessageCount": memory.len()?,
            "maxTurns": max_turns,
            "memoryWindow": memory_window,
        }),
    );
    let session_memory = memory.clone();
    let tools = build_pi_like_tools(state.clone(), session.clone());
    let llm: Arc<dyn LLMProvider> = Arc::new(MarinaraLlmProvider::new(connection, session.clone()));
    let agent = ReActAgent::with_max_turns(ProfessorMariAgent { tools }, max_turns);
    let agent_handle = AgentBuilder::<_, DirectAgent>::new(agent)
        .llm(llm)
        .memory(Box::new(memory))
        .build()
        .await
        .map_err(|error| AppError::new("mari_agent_failed", error.to_string()))?;

    let result = agent_handle
        .agent
        .run(Task::new(task_prompt))
        .await
        .map_err(|error| AppError::new("mari_agent_failed", error.to_string()))?;
    let content = result.trim();
    session.record_debug_log("agent_result", json!({ "content": content }));
    if content.is_empty() {
        let action = mark_action_not_approval_required(
            actions::staged_mari_action_contract(state, &session).await?,
            "Professor Mari stopped before producing a final answer, so staged workspace changes were not sent for approval.",
        );
        session.record_debug_log("final_action", action.clone());
        if action_change_count(&action) > 0 {
            session.record_trace(json!({
                "type": "changes_not_saved",
                "label": "Changes not saved",
                "status": "error",
                "summary": incomplete_agent_summary(&action),
            }));
        }
        let content = incomplete_agent_response(&action);
        session_memory.record_final_assistant_text(&content)?;
        return Ok((content, action, session.trace_events()));
    }

    let (action, approval_outcome) = review_final_changes(state, &session).await?;
    session.record_debug_log("final_action", action.clone());
    let content = final_response_content(content.to_string(), &action, approval_outcome.as_ref());
    session_memory.record_final_assistant_text(&content)?;
    Ok((content, action, session.trace_events()))
}

fn mari_agent_max_turns(input: &MariPromptRequest) -> usize {
    input
        .preferences
        .max_turns
        .unwrap_or(MARI_AGENT_DEFAULT_TURNS)
        .clamp(MARI_AGENT_MIN_TURNS, MARI_AGENT_MAX_TURNS)
}

fn mari_session_memory_window(input: &MariPromptRequest) -> usize {
    input
        .preferences
        .memory_window
        .unwrap_or(MARI_SESSION_MEMORY_DEFAULT_WINDOW)
        .clamp(MARI_SESSION_MEMORY_MIN_WINDOW, MARI_SESSION_MEMORY_MAX_WINDOW)
}

fn mark_action_not_approval_required(mut action: Value, reason: &str) -> Value {
    if let Value::Object(object) = &mut action {
        object.insert("approvalRequired".to_string(), json!(false));
        object.insert("notSavedReason".to_string(), json!(reason));
    }
    action
}

fn incomplete_agent_response(action: &Value) -> String {
    if action_change_count(action) == 0 {
        return "I couldn't produce a response from the selected model.".to_string();
    }
    format!(
        "I stopped before producing a final answer, so I did not ask for approval and nothing was saved. {} Please try again; I will keep the requested count in view before saving.",
        incomplete_agent_summary(action)
    )
}

fn incomplete_agent_summary(action: &Value) -> String {
    format!(
        "The hidden workspace had {} possible library update{} staged from {} file change{}, but that may be incomplete.",
        action_storage_count(action),
        plural(action_storage_count(action)),
        action_change_count(action),
        plural(action_change_count(action))
    )
}

fn final_response_content(
    content: String,
    action: &Value,
    approval_outcome: Option<&Value>,
) -> String {
    if let Some(outcome) = approval_outcome {
        if outcome
            .get("approved")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let summary = applied_entity_summary(outcome).unwrap_or_else(|| {
                outcome
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or("Library changes were saved.")
                    .to_string()
            });
            let content = content.trim();
            if content.is_empty() {
                return format!("Saved: {summary}");
            }
            return format!("{content}\n\nSaved: {summary}");
        }
        let content = content.trim();
        if content.is_empty() {
            return "No changes were saved because the library update was rejected.".to_string();
        }
        return format!("{content}\n\nNo changes were saved because the library update was rejected.");
    }

    let change_count = action_change_count(action);
    let storage_count = action_storage_count(action);
    let unmapped_count = action_unmapped_count(action);
    if change_count > 0 && storage_count > 0 && unmapped_count == 0 {
        return "I staged valid library changes, but no approval channel was available, so nothing was saved.".to_string();
    }
    if change_count > 0 && (storage_count == 0 || unmapped_count > 0) {
        return format!(
            "I made workspace changes, but they are not in a valid state to save to the library yet. Nothing was saved. {}",
            final_action_issue_summary(action)
        );
    }
    content
}

fn applied_entity_summary(outcome: &Value) -> Option<String> {
    let results = outcome
        .get("applied")
        .and_then(|applied| applied.get("results"))
        .and_then(Value::as_array)?;
    if results.is_empty() {
        return None;
    }
    let mut counts = BTreeMap::<String, usize>::new();
    let mut order = Vec::<String>::new();
    for result in results {
        let Some(entity) = result.get("entity").and_then(Value::as_str) else {
            continue;
        };
        if !counts.contains_key(entity) {
            order.push(entity.to_string());
        }
        *counts.entry(entity.to_string()).or_default() += 1;
    }
    if counts.is_empty() {
        return None;
    }
    let parts = order
        .iter()
        .filter_map(|entity| {
            let count = counts.get(entity)?;
            Some(format!(
                "{count} {}",
                entity_display_name(entity, *count)
            ))
        })
        .collect::<Vec<_>>();
    Some(format!("{}.", human_join(&parts)))
}

fn entity_display_name(entity: &str, count: usize) -> &'static str {
    match (entity, count == 1) {
        ("characters", true) => "character",
        ("characters", false) => "characters",
        ("character-groups", true) => "character group",
        ("character-groups", false) => "character groups",
        ("personas", true) => "persona",
        ("personas", false) => "personas",
        ("persona-groups", true) => "persona group",
        ("persona-groups", false) => "persona groups",
        ("lorebooks", true) => "lorebook",
        ("lorebooks", false) => "lorebooks",
        ("lorebook-entries", true) => "lorebook entry",
        ("lorebook-entries", false) => "lorebook entries",
        ("prompts", true) => "prompt preset",
        ("prompts", false) => "prompt presets",
        ("prompt-sections", true) => "prompt section",
        ("prompt-sections", false) => "prompt sections",
        ("prompt-groups", true) => "prompt group",
        ("prompt-groups", false) => "prompt groups",
        ("prompt-variables", true) => "prompt variable",
        ("prompt-variables", false) => "prompt variables",
        (_, true) => "library update",
        (_, false) => "library updates",
    }
}

fn human_join(parts: &[String]) -> String {
    match parts.len() {
        0 => String::new(),
        1 => parts[0].clone(),
        2 => format!("{} and {}", parts[0], parts[1]),
        _ => {
            let mut text = parts[..parts.len() - 1].join(", ");
            text.push_str(", and ");
            text.push_str(&parts[parts.len() - 1]);
            text
        }
    }
}

fn action_change_count(action: &Value) -> usize {
    action
        .get("changes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn action_storage_count(action: &Value) -> usize {
    action
        .get("storageActions")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn action_unmapped_count(action: &Value) -> usize {
    action
        .get("unmappedChanges")
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

fn final_action_issue_summary(action: &Value) -> String {
    let Some(unmapped) = action.get("unmappedChanges").and_then(Value::as_array) else {
        return "".to_string();
    };
    if unmapped.is_empty() {
        return "".to_string();
    }
    let items = unmapped
        .iter()
        .take(3)
        .filter_map(|change| {
            let path = change.get("path").and_then(Value::as_str)?;
            let reason = change
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("not mapped to a storage field");
            Some(format!("`{path}`: {reason}"))
        })
        .collect::<Vec<_>>();
    if items.is_empty() {
        "".to_string()
    } else {
        format!("Issues: {}", items.join("; "))
    }
}

fn create_mari_debug_log_path(data_dir: &Path) -> AppResult<PathBuf> {
    let dir = data_dir.join("professor-mari-logs");
    std::fs::create_dir_all(&dir).map_err(|error| {
        AppError::new(
            "mari_debug_log_failed",
            format!("Could not create Professor Mari log directory: {error}"),
        )
    })?;
    let filename = format!(
        "mari-{}-{}.jsonl",
        chrono::Utc::now().format("%Y%m%d-%H%M%S%.3f"),
        marinara_core::new_id()
    );
    Ok(dir.join(filename))
}

fn prompt_request_log_value(input: &MariPromptRequest) -> Value {
    json!({
        "userMessage": input.user_message,
        "messages": input.messages.iter().map(|message| json!({
            "role": message.role,
            "content": message.content,
        })).collect::<Vec<_>>(),
        "compactedSummary": input.compacted_summary,
        "connectionId": input.connection_id,
        "preferences": {
            "maxTurns": input.preferences.max_turns,
            "memoryWindow": input.preferences.memory_window,
        },
        "persona": input.persona.as_ref().map(|persona| json!({
            "name": persona.name,
            "comment": persona.comment,
            "description": persona.description,
            "personality": persona.personality,
            "scenario": persona.scenario,
            "backstory": persona.backstory,
            "appearance": persona.appearance,
        })),
        "attachments": input.attachments.iter().map(|attachment| json!({
            "name": attachment.name,
            "type": attachment.r#type,
            "size": attachment.size,
            "content": attachment.content,
        })).collect::<Vec<_>>(),
        "workspaceFiles": input.workspace_files.iter().map(|file| json!({
            "path": file.path,
            "content": file.content,
        })).collect::<Vec<_>>(),
    })
}
