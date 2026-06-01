use super::types::MariPromptMessage;
use autoagents::async_trait;
use autoagents::core::agent::memory::{MemoryProvider, MemoryType};
use autoagents::llm::chat::{ChatMessage, ChatRole, MessageType};
use autoagents::llm::error::LLMError;
use marinara_core::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MARI_SESSION_MEMORY_DIR: &str = "professor-mari-session";
const MARI_SESSION_MEMORY_FILE: &str = "current-session.json";

#[derive(Clone)]
pub(crate) struct MariSessionMemory {
    path: PathBuf,
    messages: Arc<Mutex<VecDeque<ChatMessage>>>,
    window_size: usize,
}

impl MariSessionMemory {
    pub(crate) fn load(data_dir: &Path, window_size: usize) -> AppResult<Self> {
        let path = mari_session_memory_path(data_dir);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "mari_session_memory_failed",
                    format!("Could not create Professor Mari session directory: {error}"),
                )
            })?;
        }
        let mut messages = if path.exists() {
            let text = std::fs::read_to_string(&path).map_err(|error| {
                AppError::new(
                    "mari_session_memory_failed",
                    format!("Could not read Professor Mari session memory: {error}"),
                )
            })?;
            serde_json::from_str::<Vec<ChatMessage>>(&text)
                .map(VecDeque::from)
                .unwrap_or_default()
        } else {
            VecDeque::new()
        };
        sanitize_loaded_messages(&mut messages);
        let memory = Self {
            path,
            messages: Arc::new(Mutex::new(messages)),
            window_size: window_size.max(1),
        };
        memory.trim_and_persist()?;
        Ok(memory)
    }

    pub(crate) fn seed_from_prompt_messages_if_empty(
        &self,
        messages: &[MariPromptMessage],
    ) -> AppResult<()> {
        let mut guard = self.messages.lock().map_err(|_| {
            AppError::new(
                "mari_session_memory_failed",
                "Professor Mari session memory is unavailable",
            )
        })?;
        if !guard.is_empty() {
            return Ok(());
        }
        for message in messages {
            let Some(role) = role_from_prompt_message(&message.role) else {
                continue;
            };
            let content = message.content.trim();
            if content.is_empty() {
                continue;
            }
            guard.push_back(ChatMessage {
                role,
                message_type: MessageType::Text,
                content: content.to_string(),
            });
        }
        self.trim_locked(&mut guard);
        self.persist_locked(&guard)
    }

    pub(crate) fn len(&self) -> AppResult<usize> {
        Ok(self
            .messages
            .lock()
            .map_err(|_| {
                AppError::new(
                    "mari_session_memory_failed",
                    "Professor Mari session memory is unavailable",
                )
            })?
            .len())
    }

    pub(crate) fn record_final_assistant_text(&self, content: &str) -> AppResult<()> {
        if content.trim().is_empty() {
            return Ok(());
        }
        let mut guard = self.messages.lock().map_err(|_| {
            AppError::new(
                "mari_session_memory_failed",
                "Professor Mari session memory is unavailable",
            )
        })?;
        if let Some(message) = guard.back_mut() {
            if message.role == ChatRole::Assistant && message.message_type == MessageType::Text {
                message.content = content.to_string();
                return self.persist_locked(&guard);
            }
        }
        guard.push_back(ChatMessage {
            role: ChatRole::Assistant,
            message_type: MessageType::Text,
            content: content.to_string(),
        });
        self.trim_locked(&mut guard);
        self.persist_locked(&guard)
    }

    fn trim_and_persist(&self) -> AppResult<()> {
        let mut guard = self.messages.lock().map_err(|_| {
            AppError::new(
                "mari_session_memory_failed",
                "Professor Mari session memory is unavailable",
            )
        })?;
        self.trim_locked(&mut guard);
        self.persist_locked(&guard)
    }

    fn trim_locked(&self, messages: &mut VecDeque<ChatMessage>) {
        while messages.len() > self.window_size {
            messages.pop_front();
        }
    }

    fn persist_locked(&self, messages: &VecDeque<ChatMessage>) -> AppResult<()> {
        let values = messages.iter().cloned().collect::<Vec<_>>();
        let text = serde_json::to_string_pretty(&values).map_err(|error| {
            AppError::new(
                "mari_session_memory_failed",
                format!("Could not serialize Professor Mari session memory: {error}"),
            )
        })?;
        std::fs::write(&self.path, text).map_err(|error| {
            AppError::new(
                "mari_session_memory_failed",
                format!("Could not write Professor Mari session memory: {error}"),
            )
        })
    }

    fn provider_error(error: impl std::fmt::Display) -> LLMError {
        LLMError::ProviderError(format!("Professor Mari session memory failed: {error}"))
    }
}

#[async_trait]
impl MemoryProvider for MariSessionMemory {
    async fn remember(&mut self, message: &ChatMessage) -> Result<(), LLMError> {
        let mut guard = self.messages.lock().map_err(Self::provider_error)?;
        guard.push_back(message.clone());
        self.trim_locked(&mut guard);
        self.persist_locked(&guard).map_err(Self::provider_error)
    }

    async fn recall(
        &self,
        _query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<ChatMessage>, LLMError> {
        let guard = self.messages.lock().map_err(Self::provider_error)?;
        let limit = limit.unwrap_or(guard.len());
        let start = guard.len().saturating_sub(limit);
        Ok(guard.iter().skip(start).cloned().collect())
    }

    async fn clear(&mut self) -> Result<(), LLMError> {
        let mut guard = self.messages.lock().map_err(Self::provider_error)?;
        guard.clear();
        self.persist_locked(&guard).map_err(Self::provider_error)
    }

    fn memory_type(&self) -> MemoryType {
        MemoryType::Custom
    }

    fn size(&self) -> usize {
        self.messages
            .lock()
            .map(|messages| messages.len())
            .unwrap_or(0)
    }

    fn clone_box(&self) -> Box<dyn MemoryProvider> {
        Box::new(self.clone())
    }

    fn id(&self) -> Option<String> {
        Some(self.path.to_string_lossy().to_string())
    }

    fn export(&self) -> Vec<ChatMessage> {
        self.messages
            .lock()
            .map(|messages| messages.iter().cloned().collect())
            .unwrap_or_default()
    }
}

fn sanitize_loaded_messages(messages: &mut VecDeque<ChatMessage>) {
    for message in messages.iter_mut() {
        let MessageType::ToolResult(tool_results) = &mut message.message_type else {
            continue;
        };
        for tool_result in tool_results {
            tool_result.function.arguments =
                sanitize_tool_result_arguments(&tool_result.function.arguments);
        }
    }
    if messages.back().is_some_and(|message| {
        matches!(
            &message.message_type,
            MessageType::ToolResult(_) | MessageType::ToolUse(_)
        )
    }) {
        messages.push_back(ChatMessage {
            role: ChatRole::Assistant,
            message_type: MessageType::Text,
            content: "Previous Professor Mari tool work ended without a final assistant message. Treat the current library state as the source of truth before continuing.".to_string(),
        });
    }
}

fn sanitize_tool_result_arguments(arguments: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<Value>(arguments) else {
        return arguments.to_string();
    };
    let Value::Object(object) = &mut value else {
        return arguments.to_string();
    };
    let Some(pending_changes) = object.remove("pendingChanges") else {
        return arguments.to_string();
    };
    let pending_count = pending_changes.as_array().map_or(0, Vec::len);
    object.insert("pendingChangeCount".to_string(), json!(pending_count));
    object.insert("pendingChangesOmitted".to_string(), json!(true));
    object
        .entry("staged".to_string())
        .or_insert_with(|| json!(true));
    serde_json::to_string(&value).unwrap_or_else(|_| arguments.to_string())
}

pub(crate) fn reset_mari_session_memory(data_dir: &Path) -> AppResult<()> {
    let path = mari_session_memory_path(data_dir);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|error| {
            AppError::new(
                "mari_session_memory_failed",
                format!("Could not reset Professor Mari session memory: {error}"),
            )
        })?;
    }
    Ok(())
}

pub(crate) fn mari_session_memory_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join(MARI_SESSION_MEMORY_DIR)
        .join(MARI_SESSION_MEMORY_FILE)
}

fn role_from_prompt_message(role: &str) -> Option<ChatRole> {
    match role {
        "user" => Some(ChatRole::User),
        "assistant" => Some(ChatRole::Assistant),
        _ => None,
    }
}
