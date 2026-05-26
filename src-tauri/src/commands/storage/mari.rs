#[path = "mari/actions.rs"]
mod actions;
#[path = "mari/agent.rs"]
mod agent;
#[path = "mari/file_changes.rs"]
mod file_changes;
#[path = "mari/prompt.rs"]
mod prompt;
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
use autoagents::core::agent::memory::SlidingWindowMemory;
use autoagents::core::agent::prebuilt::executor::ReActAgent;
use autoagents::core::agent::task::Task;
use autoagents::core::agent::{AgentBuilder, DirectAgent};
use autoagents::llm::LLMProvider;
use marinara_core::{AppError, AppResult};
use prompt::build_task_prompt;
use serde_json::{json, Value};
use shell::MariShellSession;
use std::sync::Arc;
use tools::build_pi_like_tools;
use types::MariPromptRequest;
use workspace::build_mari_workspace_seed;

pub(crate) const MARI_TEXT_ATTACHMENT_CHAR_LIMIT: usize = 60_000;
pub(crate) const MARI_TOOL_TEXT_LIMIT: usize = 32_000;
pub(crate) const MARI_METADATA_STRING_LIMIT: usize = 4_000;
pub(crate) const MARI_SYSTEM_PROMPT: &str = "You are Professor Mari, a coding-style agent inside a virtual Marinara workspace containing the user's creative library. Reply plainly and helpfully. Use tools to inspect /workspace/index.md and folders like /workspace/characters, /workspace/personas, /workspace/lorebooks, and /workspace/prompts before answering questions about the user's data. Visible paths use descriptive names; internal storage IDs are hidden and tracked by Marinara. File changes are staged for user review after your commands; do not ask for approval before making staged edits.";
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

pub(crate) async fn professor_mari_prompt(
    state: &AppState,
    body: Value,
    trace_channel: tauri::ipc::Channel<Value>,
) -> AppResult<Value> {
    let input: MariPromptRequest =
        serde_json::from_value(body).map_err(|error| AppError::invalid_input(error.to_string()))?;
    let connection_value = resolve_llm_connection_for_request(
        state,
        &json!({
            "connectionId": input.connection_id,
        }),
    )?;
    let connection = llm_connection_from_value(&connection_value)?;
    let (content, action, trace) = run_mari_agent(state, connection, &input, trace_channel).await?;

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

async fn run_mari_agent(
    state: &AppState,
    connection: marinara_llm::LlmConnection,
    input: &MariPromptRequest,
    trace_channel: tauri::ipc::Channel<Value>,
) -> AppResult<(String, Value, Vec<Value>)> {
    let workspace_seed = build_mari_workspace_seed(state)?;
    let session = MariShellSession::new(input, workspace_seed, trace_channel).await?;
    let tools = build_pi_like_tools(session.clone());
    let llm: Arc<dyn LLMProvider> = Arc::new(MarinaraLlmProvider::new(connection, session.clone()));
    let agent = ReActAgent::with_max_turns(ProfessorMariAgent { tools }, 8);
    let agent_handle = AgentBuilder::<_, DirectAgent>::new(agent)
        .llm(llm)
        .memory(Box::new(SlidingWindowMemory::new(12)))
        .build()
        .await
        .map_err(|error| AppError::new("mari_agent_failed", error.to_string()))?;

    let result = agent_handle
        .agent
        .run(Task::new(build_task_prompt(input)))
        .await
        .map_err(|error| AppError::new("mari_agent_failed", error.to_string()))?;
    let content = result.trim();
    let content = if content.is_empty() {
        "I couldn't produce a response from the selected model.".to_string()
    } else {
        content.to_string()
    };
    Ok((
        content,
        actions::staged_mari_action_contract(state, &session).await?,
        session.trace_events(),
    ))
}
