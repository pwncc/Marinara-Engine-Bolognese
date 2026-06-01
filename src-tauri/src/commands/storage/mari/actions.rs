use super::file_changes::{self, MariFileChange};
use super::shell::MariShellSession;
use super::util;
use super::workspace::{self, MariWorkspaceBinding};
use super::MARI_STORAGE_ACTION_ENTITIES;
use crate::state::AppState;
use crate::storage_commands::shared;
use marinara_core::{new_id, AppError, AppResult};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn professor_mari_apply_staged_changes(
    state: &AppState,
    action: Value,
) -> AppResult<Value> {
    let storage_actions = extract_storage_actions(&action)?;
    let prepared = storage_actions
        .iter()
        .map(prepare_mari_storage_action)
        .collect::<AppResult<Vec<_>>>()?;
    if prepared.is_empty() {
        return Err(AppError::invalid_input(
            "No applicable Professor Mari storage changes were provided",
        ));
    }

    let mut results = Vec::with_capacity(prepared.len());
    for action in prepared {
        match action {
            PreparedMariStorageAction::Create { entity, draft } => {
                let record = state
                    .storage
                    .create(&entity, shared::with_entity_defaults(&entity, draft)?)?;
                results
                    .push(json!({ "type": "create_record", "entity": entity, "record": record }));
            }
            PreparedMariStorageAction::Edit { entity, id, patch } => {
                let record = state.storage.patch(
                    &entity,
                    &id,
                    shared::normalize_update_patch(&entity, patch)?,
                )?;
                results.push(
                    json!({ "type": "edit_record", "entity": entity, "id": id, "record": record }),
                );
            }
        }
    }

    Ok(json!({
        "applied": results.len(),
        "appliedAt": chrono::Utc::now().to_rfc3339(),
        "results": results,
    }))
}

#[derive(Debug)]
enum PreparedMariStorageAction {
    Create {
        entity: String,
        draft: Value,
    },
    Edit {
        entity: String,
        id: String,
        patch: Value,
    },
}

#[derive(Debug, Clone)]
struct MariExistingRecordDraft {
    before: Value,
    after: Value,
    paths: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct MariParentLink {
    entity: String,
    id: String,
    folder_path: String,
    foreign_key: String,
    order_field: Option<String>,
}

#[derive(Debug, Clone)]
struct MariNewRecordDraft {
    entity: String,
    label: String,
    draft: Value,
    paths: BTreeSet<String>,
    parent: Option<MariParentLink>,
}

#[derive(Debug, Clone)]
struct MariNewRecordTarget {
    entity: String,
    folder_path: String,
    label: String,
    field: String,
    parent_folder_path: Option<String>,
    parent_entity: Option<String>,
    parent_foreign_key: Option<String>,
    parent_order_field: Option<String>,
}

fn extract_storage_actions(action: &Value) -> AppResult<Vec<Value>> {
    if let Some(actions) = action.get("storageActions").and_then(Value::as_array) {
        return Ok(actions.to_vec());
    }
    if matches!(
        action.get("type").and_then(Value::as_str),
        Some("create_record" | "edit_record")
    ) {
        return Ok(vec![action.clone()]);
    }
    Err(AppError::invalid_input(
        "Professor Mari action did not include storageActions",
    ))
}

fn prepare_mari_storage_action(action: &Value) -> AppResult<PreparedMariStorageAction> {
    let object = action.as_object().ok_or_else(|| {
        AppError::invalid_input("Professor Mari storage action must be an object")
    })?;
    let action_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input("Professor Mari storage action is missing type"))?;
    let entity = object
        .get("entity")
        .and_then(Value::as_str)
        .filter(|entity| MARI_STORAGE_ACTION_ENTITIES.contains(entity))
        .ok_or_else(|| {
            AppError::invalid_input("Professor Mari storage action has an invalid entity")
        })?
        .to_string();

    match action_type {
        "create_record" => {
            let draft = object
                .get("draft")
                .filter(|value| value.is_object())
                .ok_or_else(|| AppError::invalid_input("create_record action is missing draft"))?
                .clone();
            Ok(PreparedMariStorageAction::Create { entity, draft })
        }
        "edit_record" => {
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| AppError::invalid_input("edit_record action is missing id"))?
                .to_string();
            let patch = object
                .get("patch")
                .filter(|value| value.is_object())
                .ok_or_else(|| AppError::invalid_input("edit_record action is missing patch"))?
                .clone();
            Ok(PreparedMariStorageAction::Edit { entity, id, patch })
        }
        _ => Err(AppError::invalid_input(format!(
            "Unsupported Professor Mari storage action type: {action_type}"
        ))),
    }
}

fn staged_storage_actions(
    state: &AppState,
    session: &MariShellSession,
    changes: &[MariFileChange],
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let manifest = session.manifest_snapshot();
    let mut existing_drafts: BTreeMap<(String, String), MariExistingRecordDraft> = BTreeMap::new();
    let mut new_drafts: BTreeMap<String, MariNewRecordDraft> = BTreeMap::new();
    let mut issues = Vec::new();

    for change in changes {
        if let Some(binding) = manifest.get(&change.path) {
            match apply_bound_change(state, &mut existing_drafts, binding, change)? {
                Ok(()) => {}
                Err(reason) => issues.push(change_issue(change, Some(binding), reason)),
            }
            continue;
        }

        if let Some(target) = new_record_target(&change.path) {
            if let Some(folder_binding) = existing_folder_binding(&manifest, &target.folder_path) {
                let inferred_binding = MariWorkspaceBinding {
                    entity: folder_binding.entity.clone(),
                    id: folder_binding.id.clone(),
                    field: Some(target.field.clone()),
                };
                match apply_bound_change(state, &mut existing_drafts, &inferred_binding, change)? {
                    Ok(()) => {}
                    Err(reason) => {
                        issues.push(change_issue(change, Some(&inferred_binding), reason))
                    }
                }
                continue;
            }

            let parent = match resolve_new_record_parent(&manifest, &target) {
                Ok(parent) => parent,
                Err(_) => match resolve_pending_new_record_parent(&mut new_drafts, &target) {
                    Ok(parent) => parent,
                    Err(reason) => {
                        issues.push(change_issue(change, None, reason));
                        continue;
                    }
                },
            };

            match apply_new_record_change(&mut new_drafts, target, change, parent) {
                Ok(()) => {}
                Err(reason) => issues.push(change_issue(change, None, reason)),
            }
            continue;
        }

        issues.push(change_issue(
            change,
            None,
            "This workspace file is not mapped to a Marinara storage field.".to_string(),
        ));
    }

    stage_prompt_parent_order_updates(state, &mut existing_drafts, &mut new_drafts)?;

    let mut actions = Vec::new();
    for ((entity, id), draft) in existing_drafts {
        let patch = record_patch(&draft.before, &draft.after);
        if patch.is_empty() {
            continue;
        }
        let patch = shared::normalize_update_patch(&entity, Value::Object(patch))?;
        let label = workspace::record_label_for_entity(&entity, &draft.after, "Record");
        let action_label = format!(
            "Edit {}: {}",
            workspace::singular_title(&entity),
            workspace::display_label(&label)
        );
        actions.push(json!({
            "type": "edit_record",
            "entity": entity,
            "id": id,
            "patch": patch,
            "label": action_label,
            "paths": draft.paths.into_iter().collect::<Vec<_>>(),
        }));
    }

    for (_, draft) in new_drafts {
        if draft.paths.is_empty() {
            continue;
        }
        let entity = draft.entity;
        let normalized_draft = shared::with_entity_defaults(&entity, draft.draft)?;
        let label = workspace::record_label_for_entity(&entity, &normalized_draft, &draft.label);
        let action_label = format!(
            "Create {}: {}",
            workspace::singular_title(&entity),
            workspace::display_label(&label)
        );
        actions.push(json!({
            "type": "create_record",
            "entity": entity,
            "draft": normalized_draft,
            "label": action_label,
            "paths": draft.paths.into_iter().collect::<Vec<_>>(),
        }));
    }

    Ok((actions, issues))
}

fn apply_bound_change(
    state: &AppState,
    drafts: &mut BTreeMap<(String, String), MariExistingRecordDraft>,
    binding: &MariWorkspaceBinding,
    change: &MariFileChange,
) -> AppResult<Result<(), String>> {
    let Some(field) = binding.field.as_deref() else {
        return Ok(Err(
            "This workspace path is not bound to an editable field.".to_string(),
        ));
    };
    let draft = existing_record_draft(state, drafts, &binding.entity, &binding.id)?;
    let result = apply_field_change(&mut draft.after, &binding.entity, field, change);
    if result.is_ok() {
        draft.paths.insert(change.path.clone());
    }
    Ok(result)
}

fn existing_record_draft<'a>(
    state: &AppState,
    drafts: &'a mut BTreeMap<(String, String), MariExistingRecordDraft>,
    entity: &str,
    id: &str,
) -> AppResult<&'a mut MariExistingRecordDraft> {
    let key = (entity.to_string(), id.to_string());
    if !drafts.contains_key(&key) {
        let record = state
            .storage
            .get(entity, id)?
            .ok_or_else(|| AppError::not_found(format!("{entity}/{id} was not found")))?;
        drafts.insert(
            key.clone(),
            MariExistingRecordDraft {
                before: record.clone(),
                after: record,
                paths: BTreeSet::new(),
            },
        );
    }
    Ok(drafts.get_mut(&key).expect("draft inserted above"))
}

fn apply_new_record_change(
    drafts: &mut BTreeMap<String, MariNewRecordDraft>,
    target: MariNewRecordTarget,
    change: &MariFileChange,
    parent: Option<MariParentLink>,
) -> Result<(), String> {
    if change.op == "delete" {
        return Err(
            "Deleting a newly created unmapped file cannot be applied to storage.".to_string(),
        );
    }
    let draft = drafts
        .entry(target.folder_path.clone())
        .or_insert_with(|| MariNewRecordDraft {
            entity: target.entity.clone(),
            label: target.label.clone(),
            draft: initial_draft_for_entity(&target.entity, &target.label, parent.as_ref()),
            paths: BTreeSet::new(),
            parent,
        });
    apply_field_change(&mut draft.draft, &draft.entity, &target.field, change)?;
    draft.paths.insert(change.path.clone());
    Ok(())
}

fn apply_field_change(
    record: &mut Value,
    entity: &str,
    field: &str,
    change: &MariFileChange,
) -> Result<(), String> {
    if field == "metadata" {
        let text = change_after_text(change)
            .ok_or_else(|| "Deleting metadata.json cannot be applied to storage.".to_string())?;
        let mut metadata: Value = serde_json::from_str(&text)
            .map_err(|error| format!("metadata.json is not valid JSON: {error}"))?;
        normalize_metadata_aliases(entity, &mut metadata);
        merge_metadata_into_record(record, metadata)?;
        return Ok(());
    }

    let text = change_after_text(change).unwrap_or_default();
    let value = if field == "keys" {
        Value::Array(
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| Value::String(line.to_string()))
                .collect(),
        )
    } else {
        Value::String(text)
    };
    set_field_path_value(record, field, value)
}

fn normalize_metadata_aliases(entity: &str, metadata: &mut Value) {
    let Some(object) = metadata.as_object_mut() else {
        return;
    };
    if entity == "lorebook-entries" && !object.contains_key("keys") {
        if let Some(keywords) = object.remove("keywords") {
            object.insert("keys".to_string(), keywords);
        }
    }
}

fn merge_metadata_into_record(record: &mut Value, mut metadata: Value) -> Result<(), String> {
    let object = metadata
        .as_object_mut()
        .ok_or_else(|| "metadata.json must contain a JSON object.".to_string())?;
    object.remove("id");
    object.remove("createdAt");
    object.remove("updatedAt");
    merge_json_value(record, metadata);
    Ok(())
}

fn merge_json_value(target: &mut Value, source: Value) {
    match source {
        Value::Object(source_object) => {
            if let Some(target_object) = target.as_object_mut() {
                for (key, value) in source_object {
                    if let Some(existing) = target_object.get_mut(&key) {
                        merge_json_value(existing, value);
                    } else {
                        target_object.insert(key, value);
                    }
                }
            } else {
                *target = Value::Object(source_object);
            }
        }
        other => *target = other,
    }
}

fn set_field_path_value(record: &mut Value, field_path: &str, value: Value) -> Result<(), String> {
    let parts = field_path
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let Some((last, parents)) = parts.split_last() else {
        return Err("Field path was empty.".to_string());
    };
    let mut current = record;
    for part in parents {
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("Could not write nested field {field_path}"))?;
        current = object
            .entry((*part).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    if !current.is_object() {
        *current = Value::Object(Map::new());
    }
    let object = current
        .as_object_mut()
        .ok_or_else(|| format!("Could not write field {field_path}"))?;
    object.insert((*last).to_string(), value);
    Ok(())
}

fn record_patch(before: &Value, after: &Value) -> Map<String, Value> {
    let mut patch = Map::new();
    let Some(after_object) = after.as_object() else {
        return patch;
    };
    let before_object = before.as_object();
    for (key, value) in after_object {
        if matches!(key.as_str(), "id" | "createdAt" | "updatedAt") {
            continue;
        }
        if before_object.and_then(|object| object.get(key)) != Some(value) {
            patch.insert(key.clone(), value.clone());
        }
    }
    patch
}

fn change_after_text(change: &MariFileChange) -> Option<String> {
    change
        .after
        .as_ref()
        .map(|bytes| String::from_utf8_lossy(bytes).to_string())
}

fn new_record_target(path: &str) -> Option<MariNewRecordTarget> {
    let normalized = util::normalize_virtual_path(path);
    let parts = normalized.trim_matches('/').split('/').collect::<Vec<_>>();
    if parts.first().copied() != Some("workspace") {
        return None;
    }

    if parts.len() == 4 {
        let entity = parts[1];
        if !matches!(
            entity,
            "characters"
                | "character-groups"
                | "personas"
                | "persona-groups"
                | "lorebooks"
                | "prompts"
        ) {
            return None;
        }
        let field = workspace_field_for_file(entity, parts[3])?;
        return Some(MariNewRecordTarget {
            entity: entity.to_string(),
            folder_path: format!("/workspace/{entity}/{}", parts[2]),
            label: parts[2].to_string(),
            field,
            parent_folder_path: None,
            parent_entity: None,
            parent_foreign_key: None,
            parent_order_field: None,
        });
    }

    if parts.len() == 6 && parts[1] == "lorebooks" && parts[3] == "entries" {
        let entity = "lorebook-entries";
        let field = workspace_field_for_file(entity, parts[5])?;
        return Some(MariNewRecordTarget {
            entity: entity.to_string(),
            folder_path: format!("/workspace/lorebooks/{}/entries/{}", parts[2], parts[4]),
            label: parts[4].to_string(),
            field,
            parent_folder_path: Some(format!("/workspace/lorebooks/{}", parts[2])),
            parent_entity: Some("lorebooks".to_string()),
            parent_foreign_key: Some("lorebookId".to_string()),
            parent_order_field: None,
        });
    }

    if parts.len() == 6 && parts[1] == "prompts" {
        let (entity, order_field) = match parts[3] {
            "sections" => ("prompt-sections", Some("sectionOrder")),
            "groups" => ("prompt-groups", Some("groupOrder")),
            "variables" => ("prompt-variables", Some("variableOrder")),
            _ => return None,
        };
        let field = workspace_field_for_file(entity, parts[5])?;
        return Some(MariNewRecordTarget {
            entity: entity.to_string(),
            folder_path: format!("/workspace/prompts/{}/{}/{}", parts[2], parts[3], parts[4]),
            label: parts[4].to_string(),
            field: normalize_new_record_field(entity, &field),
            parent_folder_path: Some(format!("/workspace/prompts/{}", parts[2])),
            parent_entity: Some("prompts".to_string()),
            parent_foreign_key: Some("presetId".to_string()),
            parent_order_field: order_field.map(str::to_string),
        });
    }

    None
}

fn existing_folder_binding<'a>(
    manifest: &'a BTreeMap<String, MariWorkspaceBinding>,
    folder_path: &str,
) -> Option<&'a MariWorkspaceBinding> {
    let folder_path = folder_path.trim_end_matches('/');
    let metadata_path = format!("{folder_path}/metadata.json");
    if let Some(binding) = manifest.get(&metadata_path) {
        return Some(binding);
    }

    let prefix = format!("{folder_path}/");
    manifest
        .iter()
        .find(|(path, _)| path.starts_with(&prefix) && !path[prefix.len()..].contains('/'))
        .map(|(_, binding)| binding)
}

fn resolve_new_record_parent(
    manifest: &BTreeMap<String, MariWorkspaceBinding>,
    target: &MariNewRecordTarget,
) -> Result<Option<MariParentLink>, String> {
    let Some(parent_folder_path) = target.parent_folder_path.as_deref() else {
        return Ok(None);
    };
    let parent_binding = existing_folder_binding(manifest, parent_folder_path).ok_or_else(|| {
        "Nested entries, sections, groups, and variables need an existing parent folder or a new parent record in the same staged change."
            .to_string()
    })?;
    if target
        .parent_entity
        .as_deref()
        .is_some_and(|entity| parent_binding.entity != entity)
    {
        return Err(
            "The nested record parent folder maps to the wrong storage entity.".to_string(),
        );
    }
    Ok(Some(MariParentLink {
        entity: parent_binding.entity.clone(),
        id: parent_binding.id.clone(),
        folder_path: parent_folder_path.to_string(),
        foreign_key: target
            .parent_foreign_key
            .clone()
            .ok_or_else(|| "Nested record target is missing its parent foreign key.".to_string())?,
        order_field: target.parent_order_field.clone(),
    }))
}

fn resolve_pending_new_record_parent(
    new_drafts: &mut BTreeMap<String, MariNewRecordDraft>,
    target: &MariNewRecordTarget,
) -> Result<Option<MariParentLink>, String> {
    let Some(parent_folder_path) = target.parent_folder_path.as_deref() else {
        return Ok(None);
    };
    let parent_entity = target
        .parent_entity
        .as_deref()
        .ok_or_else(|| "Nested record target is missing its parent entity.".to_string())?;
    if !matches!(parent_entity, "lorebooks" | "prompts") {
        return Err(
            "Nested record parent cannot be created in the same staged change.".to_string(),
        );
    }
    let parent_label = parent_folder_path
        .rsplit('/')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Untitled");
    let parent_draft = new_drafts
        .entry(parent_folder_path.to_string())
        .or_insert_with(|| MariNewRecordDraft {
            entity: parent_entity.to_string(),
            label: parent_label.to_string(),
            draft: initial_draft_for_entity(parent_entity, parent_label, None),
            paths: BTreeSet::new(),
            parent: None,
        });
    if parent_draft.entity != parent_entity {
        return Err(
            "The nested record parent folder maps to the wrong pending storage entity.".to_string(),
        );
    }
    parent_draft
        .paths
        .insert(format!("{parent_folder_path}/metadata.json"));
    let parent_id = parent_draft
        .draft
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Pending parent record is missing a generated id.".to_string())?
        .to_string();
    Ok(Some(MariParentLink {
        entity: parent_entity.to_string(),
        id: parent_id,
        folder_path: parent_folder_path.to_string(),
        foreign_key: target
            .parent_foreign_key
            .clone()
            .ok_or_else(|| "Nested record target is missing its parent foreign key.".to_string())?,
        order_field: target.parent_order_field.clone(),
    }))
}

fn stage_prompt_parent_order_updates(
    state: &AppState,
    existing_drafts: &mut BTreeMap<(String, String), MariExistingRecordDraft>,
    new_drafts: &mut BTreeMap<String, MariNewRecordDraft>,
) -> AppResult<()> {
    let updates = new_drafts
        .values()
        .filter_map(|draft| {
            let parent = draft.parent.as_ref()?;
            if parent.entity != "prompts" {
                return None;
            }
            let order_field = parent.order_field.clone()?;
            let new_id = draft.draft.get("id").and_then(Value::as_str)?.to_string();
            Some((parent.clone(), order_field, new_id))
        })
        .collect::<Vec<_>>();

    for (parent, order_field, new_id) in updates {
        if let Some(parent_draft) = new_drafts.get_mut(&parent.folder_path) {
            append_order_id(&mut parent_draft.draft, &order_field, &new_id);
            parent_draft
                .paths
                .insert(format!("{}/metadata.json", parent.folder_path));
            continue;
        }
        let parent_draft = existing_record_draft(state, existing_drafts, "prompts", &parent.id)?;
        append_order_id(&mut parent_draft.after, &order_field, &new_id);
        parent_draft
            .paths
            .insert(format!("{}/metadata.json", parent.folder_path));
    }
    Ok(())
}

fn append_order_id(record: &mut Value, field: &str, id: &str) {
    let Some(object) = record.as_object_mut() else {
        return;
    };
    let mut ids = object
        .get(field)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !ids.iter().any(|value| value.as_str() == Some(id)) {
        ids.push(Value::String(id.to_string()));
    }
    object.insert(field.to_string(), Value::Array(ids));
}

fn workspace_field_for_file(entity: &str, file_name: &str) -> Option<String> {
    if file_name == "metadata.json" {
        return Some("metadata".to_string());
    }
    text_field_for_workspace_file(entity, file_name).map(str::to_string)
}

fn text_field_for_workspace_file(entity: &str, file_name: &str) -> Option<&'static str> {
    if file_name == "keys.txt" && workspace_text_fields_for_entity(entity).contains(&"keys") {
        return Some("keys");
    }
    let stem = file_name.strip_suffix(".md")?;
    workspace_text_fields_for_entity(entity)
        .iter()
        .copied()
        .find(|field| workspace::field_file_name(field) == stem)
}

fn normalize_new_record_field(entity: &str, field: &str) -> String {
    match (entity, field) {
        ("prompt-sections", "prompt" | "text") => "content".to_string(),
        _ => field.to_string(),
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

fn initial_draft_for_entity(entity: &str, label: &str, parent: Option<&MariParentLink>) -> Value {
    let parent_field = |key: &str| -> Value {
        let mut object = Map::new();
        if let Some(parent) = parent {
            object.insert(key.to_string(), Value::String(parent.id.clone()));
            object.insert(parent.foreign_key.clone(), Value::String(parent.id.clone()));
        }
        Value::Object(object)
    };
    match entity {
        "characters" => json!({
            "id": new_id(),
            "name": label,
            "data": {
                "name": label,
                "description": "",
                "personality": "",
                "scenario": "",
                "first_mes": "",
                "mes_example": "",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": [],
                "creator": "",
                "character_version": "1.0",
                "alternate_greetings": [],
                "extensions": { "altDescriptions": [] },
                "character_book": null
            },
            "comment": ""
        }),
        "personas" => json!({
            "id": new_id(),
            "name": label,
            "description": "",
            "comment": "",
            "personality": "",
            "scenario": "",
            "backstory": "",
            "appearance": ""
        }),
        "lorebook-entries" => merge_object_values(
            json!({
                "id": new_id(),
                "name": label,
                "content": "",
                "description": "",
                "keys": [],
                "secondaryKeys": [],
                "enabled": true,
                "constant": false,
                "selective": false,
                "selectiveLogic": "and",
                "position": 0,
                "depth": 4,
                "order": 100,
                "role": "system",
                "folderId": null,
                "relationships": {},
                "dynamicState": {},
                "activationConditions": [],
                "excludeFromVectorization": false
            }),
            parent_field("lorebookId"),
        ),
        "prompt-sections" => merge_object_values(
            json!({
                "id": new_id(),
                "identifier": identifier_from_label(label),
                "name": label,
                "content": "",
                "role": "system",
                "enabled": true,
                "isMarker": false,
                "groupId": null,
                "markerConfig": null,
                "injectionPosition": "ordered",
                "injectionDepth": 0,
                "injectionOrder": 100,
                "forbidOverrides": false
            }),
            parent_field("presetId"),
        ),
        "prompt-groups" => merge_object_values(
            json!({
                "id": new_id(),
                "name": label,
                "parentGroupId": null,
                "order": 100,
                "enabled": true
            }),
            parent_field("presetId"),
        ),
        "prompt-variables" => merge_object_values(
            json!({
                "id": new_id(),
                "variableName": identifier_from_label(label),
                "question": label,
                "options": [{ "id": "option-1", "label": "Option", "value": "" }],
                "multiSelect": false,
                "separator": ", ",
                "randomPick": false
            }),
            parent_field("presetId"),
        ),
        "lorebooks" | "prompts" | "character-groups" | "persona-groups" => {
            json!({ "id": new_id(), "name": label })
        }
        _ => json!({ "id": new_id(), "name": label }),
    }
}

fn merge_object_values(mut base: Value, overlay: Value) -> Value {
    merge_json_value(&mut base, overlay);
    base
}

fn identifier_from_label(label: &str) -> String {
    let mut out = label
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out = out.trim_matches('_').to_string();
    if out.is_empty() {
        "custom".to_string()
    } else if out.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        format!("custom_{out}")
    } else {
        out
    }
}

fn change_issue(
    change: &MariFileChange,
    binding: Option<&MariWorkspaceBinding>,
    reason: String,
) -> Value {
    let mut value = match file_changes::file_change_summary(change) {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    value.insert("reason".to_string(), Value::String(reason));
    if let Some(binding) = binding {
        value.insert(
            "binding".to_string(),
            json!({
                "entity": &binding.entity,
                "id": &binding.id,
                "field": &binding.field,
            }),
        );
    }
    Value::Object(value)
}

fn file_change_summary_with_binding(
    change: &MariFileChange,
    binding: Option<&MariWorkspaceBinding>,
) -> Value {
    let mut value = match file_changes::file_change_summary(change) {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    if let Some(binding) = binding {
        value.insert(
            "binding".to_string(),
            json!({
                "entity": &binding.entity,
                "id": &binding.id,
                "field": &binding.field,
            }),
        );
    }
    Value::Object(value)
}

pub(crate) async fn staged_mari_action_contract(
    state: &AppState,
    session: &MariShellSession,
) -> AppResult<Value> {
    let changes = session.pending_file_changes().await?;
    let (storage_actions, unmapped_changes) = staged_storage_actions(state, session, &changes)?;
    let manifest = session.manifest_snapshot();
    let change_summaries = changes
        .iter()
        .map(|change| file_change_summary_with_binding(change, manifest.get(&change.path)))
        .collect::<Vec<_>>();
    Ok(json!({
        "type": if changes.is_empty() { "none" } else { "staged_file_changes" },
        "capability": "bashkit_virtual_workspace",
        "changes": change_summaries,
        "storageActions": storage_actions,
        "unmappedChanges": unmapped_changes,
        "workspaceManifest": session.manifest_summary(),
        "approvalRequired": !storage_actions.is_empty(),
    }))
}

#[cfg(test)]
mod tests {
    use super::super::shell::MariShellSession;
    use super::super::types::MariPromptRequest;
    use super::super::workspace::build_mari_workspace_seed;
    use super::*;
    use crate::state::AppState;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(label: &str) -> AppState {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("marinara-mari-actions-{label}-{nonce}"));
        if path.exists() {
            std::fs::remove_dir_all(&path).expect("stale temp dir should be removable");
        }
        AppState::from_data_dir(path, Vec::new()).expect("test app state should initialize")
    }

    fn request() -> MariPromptRequest {
        MariPromptRequest {
            user_message: "test".to_string(),
            messages: Vec::new(),
            compacted_summary: None,
            connection_id: None,
            persona: None,
            attachments: Vec::new(),
            workspace_files: Vec::new(),
            preferences: Default::default(),
        }
    }

    async fn session_for(state: &AppState) -> Arc<MariShellSession> {
        let seed = build_mari_workspace_seed(state).expect("workspace seed should build");
        MariShellSession::new(&request(), seed, None, None)
            .await
            .expect("session should initialize")
    }

    #[tokio::test]
    async fn stages_new_lorebook_and_entries_in_one_valid_change() {
        let state = test_state("new-lorebook-with-entries");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/lorebooks/One Piece/metadata.json",
                r#"{"name":"One Piece","enabled":true}"#,
            )
            .await
            .expect("lorebook metadata should write");
        session
            .write_text(
                "/workspace/lorebooks/One Piece/entries/Luffy/metadata.json",
                r#"{"name":"Monkey D. Luffy"}"#,
            )
            .await
            .expect("entry metadata should write");
        session
            .write_text(
                "/workspace/lorebooks/One Piece/entries/Luffy/content.md",
                "Captain of the Straw Hat Pirates.",
            )
            .await
            .expect("entry content should write");
        session
            .write_text(
                "/workspace/lorebooks/One Piece/entries/Zoro/content.md",
                "Swordsman of the Straw Hat Pirates.",
            )
            .await
            .expect("second entry content should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 3);
        let parent = storage_actions
            .iter()
            .find(|action| action["entity"] == "lorebooks")
            .expect("parent lorebook action");
        let parent_id = parent["draft"]["id"].as_str().expect("parent id");
        let entries = storage_actions
            .iter()
            .filter(|action| action["entity"] == "lorebook-entries")
            .collect::<Vec<_>>();
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .all(|entry| entry["draft"]["lorebookId"] == parent_id));
    }

    #[tokio::test]
    async fn stages_new_lorebook_from_child_entry_only() {
        let state = test_state("new-lorebook-from-child-only");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/lorebooks/One Piece/entries/Luffy/content.md",
                "Captain of the Straw Hat Pirates.",
            )
            .await
            .expect("entry content should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 2);
        let parent = storage_actions
            .iter()
            .find(|action| action["entity"] == "lorebooks")
            .expect("parent lorebook action");
        let parent_id = parent["draft"]["id"].as_str().expect("parent id");
        assert_eq!(parent["draft"]["name"], "One Piece");
        let entry = storage_actions
            .iter()
            .find(|action| action["entity"] == "lorebook-entries")
            .expect("entry action");
        assert_eq!(entry["draft"]["lorebookId"], parent_id);
        assert_eq!(entry["draft"]["name"], "Luffy");
    }

    #[tokio::test]
    async fn stages_new_lorebook_entry_under_existing_lorebook() {
        let state = test_state("new-lorebook-entry");
        state
            .storage
            .create("lorebooks", json!({ "id": "book-1", "name": "World" }))
            .expect("lorebook should be created");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/lorebooks/World/entries/Moon Gate/content.md",
                "The Moon Gate opens only under silver rain.",
            )
            .await
            .expect("content should write");
        session
            .write_text(
                "/workspace/lorebooks/World/entries/Moon Gate/keys.txt",
                "moon gate\nsilver rain",
            )
            .await
            .expect("keys should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 1);
        let create = &storage_actions[0];
        assert_eq!(create["type"], "create_record");
        assert_eq!(create["entity"], "lorebook-entries");
        assert_eq!(create["draft"]["lorebookId"], "book-1");
        assert_eq!(create["draft"]["name"], "Moon Gate");
        assert_eq!(
            create["draft"]["content"],
            "The Moon Gate opens only under silver rain."
        );
        assert_eq!(create["draft"]["keys"], json!(["moon gate", "silver rain"]));
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn maps_lorebook_entry_metadata_keywords_alias_to_keys() {
        let state = test_state("lorebook-entry-keywords-alias");
        state
            .storage
            .create("lorebooks", json!({ "id": "book-1", "name": "World" }))
            .expect("lorebook should be created");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/lorebooks/World/entries/Moon Gate/metadata.json",
                r#"{"name":"Moon Gate","keywords":["moon gate","silver rain"]}"#,
            )
            .await
            .expect("metadata should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
        let create = &action["storageActions"].as_array().expect("actions")[0];
        assert_eq!(create["entity"], "lorebook-entries");
        assert_eq!(create["draft"]["keys"], json!(["moon gate", "silver rain"]));
        assert!(create["draft"].get("keywords").is_none());
    }

    #[tokio::test]
    async fn stages_new_lorebook_entry_when_sibling_entry_exists() {
        let state = test_state("new-lorebook-entry-with-sibling");
        state
            .storage
            .create("lorebooks", json!({ "id": "book-1", "name": "World" }))
            .expect("lorebook should be created");
        state
            .storage
            .create(
                "lorebook-entries",
                json!({
                    "id": "entry-1",
                    "lorebookId": "book-1",
                    "name": "Moon Gate",
                    "content": "Existing sibling entry."
                }),
            )
            .expect("sibling entry should be created");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/lorebooks/World/entries/Sun Gate/content.md",
                "The Sun Gate opens at dawn.",
            )
            .await
            .expect("content should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 1);
        let create = &storage_actions[0];
        assert_eq!(create["type"], "create_record");
        assert_eq!(create["entity"], "lorebook-entries");
        assert_eq!(create["draft"]["lorebookId"], "book-1");
        assert_eq!(create["draft"]["name"], "Sun Gate");
    }

    #[tokio::test]
    async fn stages_new_prompt_and_section_in_one_valid_change() {
        let state = test_state("new-prompt-with-section");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/prompts/Story Preset/metadata.json",
                r#"{"name":"Story Preset"}"#,
            )
            .await
            .expect("prompt metadata should write");
        session
            .write_text(
                "/workspace/prompts/Story Preset/sections/Narrator Voice/content.md",
                "Narrate with vivid sensory detail.",
            )
            .await
            .expect("section should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 2);
        let parent = storage_actions
            .iter()
            .find(|action| action["entity"] == "prompts")
            .expect("parent prompt action");
        let parent_id = parent["draft"]["id"].as_str().expect("parent id");
        let section_id = storage_actions
            .iter()
            .find(|action| action["entity"] == "prompt-sections")
            .and_then(|action| action["draft"]["id"].as_str())
            .expect("section id");
        assert_eq!(parent["draft"]["sectionOrder"], json!([section_id]));
        let section = storage_actions
            .iter()
            .find(|action| action["entity"] == "prompt-sections")
            .expect("section action");
        assert_eq!(section["draft"]["presetId"], parent_id);
    }

    #[tokio::test]
    async fn stages_new_prompt_section_when_sibling_group_sorts_before_parent_metadata() {
        let state = test_state("new-prompt-section-with-sibling-group");
        state
            .storage
            .create(
                "prompts",
                json!({ "id": "preset-1", "name": "Story Preset", "sectionOrder": [], "groupOrder": ["group-1"] }),
            )
            .expect("prompt should be created");
        state
            .storage
            .create(
                "prompt-groups",
                json!({ "id": "group-1", "presetId": "preset-1", "name": "Alpha Group" }),
            )
            .expect("group should be created");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/prompts/Story Preset/sections/Narrator Voice/content.md",
                "Narrate with vivid sensory detail.",
            )
            .await
            .expect("section should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 2);
        let create = storage_actions
            .iter()
            .find(|action| action["type"] == "create_record")
            .expect("create section action");
        assert_eq!(create["entity"], "prompt-sections");
        assert_eq!(create["draft"]["presetId"], "preset-1");
        assert_eq!(create["draft"]["name"], "Narrator Voice");
    }

    #[tokio::test]
    async fn stages_new_prompt_section_and_updates_parent_order() {
        let state = test_state("new-prompt-section");
        state
            .storage
            .create(
                "prompts",
                json!({ "id": "preset-1", "name": "Story Preset", "sectionOrder": [] }),
            )
            .expect("prompt should be created");
        let session = session_for(&state).await;

        session
            .write_text(
                "/workspace/prompts/Story Preset/sections/Narrator Voice/prompt.md",
                "Narrate with vivid sensory detail.",
            )
            .await
            .expect("section should write");

        let action = staged_mari_action_contract(&state, &session)
            .await
            .expect("action should stage");
        let storage_actions = action["storageActions"]
            .as_array()
            .expect("storage actions");
        assert_eq!(storage_actions.len(), 2);
        let create = storage_actions
            .iter()
            .find(|action| action["type"] == "create_record")
            .expect("create section action");
        let edit = storage_actions
            .iter()
            .find(|action| action["type"] == "edit_record")
            .expect("edit parent prompt action");

        assert_eq!(create["entity"], "prompt-sections");
        assert_eq!(create["draft"]["presetId"], "preset-1");
        assert_eq!(create["draft"]["name"], "Narrator Voice");
        assert_eq!(
            create["draft"]["content"],
            "Narrate with vivid sensory detail."
        );
        let section_id = create["draft"]["id"].as_str().expect("section id");

        assert_eq!(edit["entity"], "prompts");
        assert_eq!(edit["id"], "preset-1");
        assert_eq!(edit["patch"]["sectionOrder"], json!([section_id]));
        assert!(action["unmappedChanges"].as_array().unwrap().is_empty());
    }
}
