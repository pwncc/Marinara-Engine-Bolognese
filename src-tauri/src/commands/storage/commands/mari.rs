use super::mari;
use crate::state::AppState;
use marinara_core::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn professor_mari_prompt(
    state: State<'_, AppState>,
    request: Value,
    on_event: tauri::ipc::Channel<Value>,
) -> Result<Value, AppError> {
    mari::professor_mari_prompt(&state, request, on_event).await
}

#[tauri::command]
pub fn professor_mari_apply_staged_changes(
    state: State<'_, AppState>,
    action: Value,
) -> Result<Value, AppError> {
    mari::professor_mari_apply_staged_changes(&state, action)
}
