use super::super::media_uploads::{
    decode_image_payload, extension_for_image_mime, persist_image_bytes, persist_image_file_copy,
    safe_filename, unique_file_path,
};
use super::super::shared::*;
use super::super::*;
#[path = "access.rs"]
mod access;
#[path = "bulk_imports.rs"]
mod bulk_imports;
#[path = "marinara.rs"]
mod marinara;
#[path = "normalization.rs"]
mod normalization;
#[path = "payloads.rs"]
mod payloads;
#[path = "st_preset.rs"]
mod st_preset;
#[path = "timestamps.rs"]
mod timestamps;
use access::*;
use marinara::*;
use normalization::*;
use payloads::*;
use st_preset::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use timestamps::{apply_timestamp_overrides, timestamp_overrides_from_value};

fn create_lorebook_from_payload(
    state: &AppState,
    payload: &Value,
    fallback_name: &str,
    character_id: Option<&str>,
) -> AppResult<Value> {
    let (mut lorebook, entries) = normalize_lorebook(payload, fallback_name, character_id);
    apply_timestamp_overrides(&mut lorebook, &Value::Null, payload);
    let record = state.storage.create("lorebooks", lorebook)?;
    let lorebook_id = record
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    for (index, entry) in entries.iter().enumerate() {
        state.storage.create(
            "lorebook-entries",
            normalize_lorebook_entry(&lorebook_id, entry, index),
        )?;
    }
    Ok(json!({
        "success": true,
        "lorebookId": lorebook_id,
        "name": record.get("name").cloned().unwrap_or(Value::Null),
        "entriesImported": entries.len(),
        "lorebook": record
    }))
}

fn patch_imported_character_lorebook_pointer(
    state: &AppState,
    character_id: &str,
    lorebook_id: &str,
    entries_imported: usize,
) -> AppResult<()> {
    let character = get_required(state, "characters", character_id)?;
    let mut data = character.get("data").cloned().unwrap_or_else(|| json!({}));
    let Some(data_object) = data.as_object_mut() else {
        return Ok(());
    };
    let extensions = data_object
        .entry("extensions".to_string())
        .or_insert_with(|| json!({}));
    let Some(extensions) = extensions.as_object_mut() else {
        return Ok(());
    };
    let import_metadata = extensions
        .entry("importMetadata".to_string())
        .or_insert_with(|| json!({}));
    let Some(import_metadata) = import_metadata.as_object_mut() else {
        return Ok(());
    };
    import_metadata.insert(
        "embeddedLorebook".to_string(),
        json!({
            "hasEmbeddedLorebook": true,
            "lorebookId": lorebook_id,
            "entriesImported": entries_imported
        }),
    );
    state
        .storage
        .patch("characters", character_id, json!({ "data": data }))?;
    Ok(())
}

fn import_st_character_payload(
    state: &AppState,
    mut payload: Value,
    filename: Option<String>,
    body: &Value,
    trusted_avatar_source: Option<&Path>,
) -> AppResult<Value> {
    strip_reserved_avatar_source_fields(&mut payload);
    let tag_mode = body
        .get("tagImportMode")
        .and_then(Value::as_str)
        .unwrap_or("all");
    let existing_tags: Vec<String> = state
        .storage
        .list("characters")?
        .into_iter()
        .flat_map(|row| {
            row.get("data")
                .and_then(|data| data.get("tags"))
                .map(|tags| string_array(Some(tags)))
                .unwrap_or_default()
        })
        .collect();
    let data = normalize_character_data(&payload, tag_mode, &existing_tags);
    let name = data
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Imported Character")
        .to_string();
    let mut record = json!({
        "data": data,
        "comment": data.get("creator_notes").and_then(Value::as_str).unwrap_or(""),
        "avatarPath": null,
        "format": payload.get("spec").and_then(Value::as_str).unwrap_or("chara_card_v2"),
    });
    if let Some(avatar) =
        imported_avatar_reference(state, &payload, filename.as_deref(), trusted_avatar_source)?
    {
        let object = record
            .as_object_mut()
            .expect("character import record should be an object");
        object.insert("avatarPath".to_string(), Value::String(avatar.asset_url));
        object.insert(
            "avatarFilePath".to_string(),
            Value::String(avatar.absolute_path),
        );
        object.insert("avatarFilename".to_string(), Value::String(avatar.filename));
    }
    apply_timestamp_overrides(&mut record, body, &payload);
    let character = state.storage.create("characters", record)?;

    let import_embedded = body
        .get("importEmbeddedLorebook")
        .and_then(Value::as_str)
        .map(|raw| raw != "false")
        .unwrap_or_else(|| {
            body.get("importEmbeddedLorebook")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        });
    let embedded = embedded_lorebook(&payload);
    let mut lorebook_result = Value::Null;
    if import_embedded {
        if let Some(book) = embedded.as_ref() {
            let character_id = character.get("id").and_then(Value::as_str);
            lorebook_result = create_lorebook_from_payload(
                state,
                book,
                &format!("{name}'s Lorebook"),
                character_id,
            )?;
            if let (Some(character_id), Some(lorebook_id)) = (
                character_id,
                lorebook_result.get("lorebookId").and_then(Value::as_str),
            ) {
                patch_imported_character_lorebook_pointer(
                    state,
                    character_id,
                    lorebook_id,
                    lorebook_entry_count(book),
                )?;
            }
        }
    }

    Ok(json!({
        "success": true,
        "characterId": character.get("id").cloned().unwrap_or(Value::Null),
        "character": character,
        "name": name,
        "filename": filename,
        "embeddedLorebook": {
            "hasEmbeddedLorebook": embedded.as_ref().map(lorebook_entry_count).unwrap_or(0) > 0,
            "entries": embedded.as_ref().map(lorebook_entry_count).unwrap_or(0),
            "imported": lorebook_result.get("lorebookId").is_some(),
            "skipped": embedded.is_some() && !import_embedded
        },
        "lorebook": lorebook_result
    }))
}

fn strip_reserved_avatar_source_fields(payload: &mut Value) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    object.remove("_avatarSourcePath");
    object.remove("_avatarFileCopySourcePath");
}

struct ImportedAvatarReference {
    asset_url: String,
    absolute_path: String,
    filename: String,
}

fn imported_avatar_reference(
    state: &AppState,
    payload: &Value,
    filename: Option<&str>,
    trusted_avatar_source: Option<&Path>,
) -> AppResult<Option<ImportedAvatarReference>> {
    if let Some(source) = trusted_avatar_source {
        let filename_hint = source
            .file_name()
            .and_then(|value| value.to_str())
            .or(filename)
            .unwrap_or("avatar.png");
        let stored = persist_image_file_copy(state, "avatars/characters", filename_hint, source)?;
        return Ok(Some(ImportedAvatarReference {
            asset_url: stored.asset_url,
            absolute_path: stored.absolute_path,
            filename: stored.filename,
        }));
    }
    let Some(value) = payload.get("_avatarDataUrl").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !value.starts_with("data:image/") {
        return Ok(None);
    }
    let (mime, bytes) = decode_image_payload(value, "avatar")?;
    let fallback = payload
        .get("data")
        .and_then(|data| data.get("name"))
        .or_else(|| payload.get("name"))
        .and_then(Value::as_str)
        .or(filename)
        .unwrap_or("avatar");
    let stored = persist_image_bytes(
        state,
        "avatars/characters",
        &safe_filename(fallback),
        &bytes,
        &mime,
    )?;
    Ok(Some(ImportedAvatarReference {
        asset_url: stored.asset_url,
        absolute_path: stored.absolute_path,
        filename: stored.filename,
    }))
}

pub(crate) fn import_st_character(state: &AppState, body: Value) -> AppResult<Value> {
    let payload = if body.get("file").is_some() {
        let uploaded = decode_uploaded_file_value(
            body.get("file")
                .ok_or_else(|| AppError::invalid_input("file is required"))?,
        )?;
        parse_character_file(&uploaded.name, &uploaded.bytes)?
    } else {
        body.clone()
    };
    import_st_character_payload(state, payload, None, &body, None)
}

fn import_st_character_batch(state: &AppState, body: Value) -> AppResult<Value> {
    let files = decode_uploaded_files(&body, "files")?;
    let mut timestamps_by_name: HashMap<String, Vec<Value>> = HashMap::new();
    if let Some(raw_timestamps) = body.get("fileTimestamps").and_then(Value::as_str) {
        if let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(raw_timestamps) {
            for entry in entries {
                let Some(name) = entry.get("name").and_then(Value::as_str) else {
                    continue;
                };
                timestamps_by_name
                    .entry(name.to_string())
                    .or_default()
                    .push(entry.clone());
            }
        }
    }
    let mut results = Vec::new();
    for file in files {
        let filename = file.name.clone();
        let mut file_body = body.clone();
        if let Some(entry) = timestamps_by_name.get_mut(&filename).and_then(|entries| {
            if entries.is_empty() {
                None
            } else {
                Some(entries.remove(0))
            }
        }) {
            if let Some(last_modified) = entry.get("lastModified").cloned() {
                if let Some(object) = file_body.as_object_mut() {
                    object.insert(
                        "timestampOverrides".to_string(),
                        json!({ "createdAt": last_modified, "updatedAt": last_modified }),
                    );
                }
            }
        }
        let result = parse_character_file(&file.name, &file.bytes).and_then(|payload| {
            import_st_character_payload(state, payload, Some(filename.clone()), &file_body, None)
        });
        match result {
            Ok(mut value) => {
                if let Some(object) = value.as_object_mut() {
                    object.insert("filename".to_string(), Value::String(filename));
                }
                results.push(value);
            }
            Err(error) => results
                .push(json!({ "filename": filename, "success": false, "error": error.message })),
        }
    }
    Ok(json!({ "success": true, "results": results }))
}

fn inspect_st_character_batch(body: Value) -> AppResult<Value> {
    let files = decode_uploaded_files(&body, "files")?;
    let mut results = Vec::new();
    for file in files {
        let filename = file.name.clone();
        match parse_character_file(&file.name, &file.bytes) {
            Ok(payload) => {
                let data = normalize_character_data(&payload, "all", &[]);
                let embedded = embedded_lorebook(&payload);
                results.push(json!({
                    "filename": filename,
                    "success": true,
                    "name": data.get("name").cloned().unwrap_or(Value::Null),
                    "hasEmbeddedLorebook": embedded.as_ref().map(lorebook_entry_count).unwrap_or(0) > 0,
                    "embeddedLorebookEntries": embedded.as_ref().map(lorebook_entry_count).unwrap_or(0)
                }));
            }
            Err(error) => results.push(json!({
                "filename": filename,
                "success": false,
                "hasEmbeddedLorebook": false,
                "embeddedLorebookEntries": 0,
                "error": error.message
            })),
        }
    }
    Ok(json!({ "success": true, "results": results }))
}

pub(crate) fn import_call(state: &AppState, rest: &[&str], body: Value) -> AppResult<Value> {
    match rest {
        ["marinara"] => {
            let payload = import_payload(body)?;
            import_marinara_envelope(state, payload)
        }
        ["marinara-file"] => import_marinara_file(state, body),
        ["st-character"] => import_st_character(state, body),
        ["st-character", "batch"] => import_st_character_batch(state, body),
        ["st-character", "inspect"] => inspect_st_character_batch(body),
        ["st-chat"] => bulk_imports::import_st_chat(state, body),
        ["st-chat-into-group"] => bulk_imports::import_st_chat_into_group(state, body),
        ["st-preset"] => {
            let payload = import_payload(body)?;
            let filename = payload
                .get("__filename")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            import_st_preset_payload(state, payload, filename.as_deref())
        }
        ["st-lorebook"] => {
            let payload = import_payload(body)?;
            create_lorebook_from_payload(
                state,
                &payload,
                payload
                    .get("__filename")
                    .and_then(Value::as_str)
                    .unwrap_or("Imported Lorebook"),
                None,
            )
        }
        ["list-directory"] => {
            let path = body.get("path").and_then(Value::as_str).unwrap_or("");
            let picker_selected = body
                .get("pickerSelected")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let base = if path.trim().is_empty() {
                home_dir()
            } else {
                PathBuf::from(path)
            };
            directory_listing(base, picker_selected).or_else(|error| {
                Ok(json!({
                    "success": false,
                    "error": error.message
                }))
            })
        }
        ["st-bulk", "scan"] => bulk_imports::scan_st_folder(body),
        ["st-bulk", "run"] => bulk_imports::run_st_bulk_import(state, body),
        _ => Err(AppError::new(
            "route_not_found",
            format!("Unknown import route: /{}", rest.join("/")),
        )),
    }
}

pub(crate) fn import_stream_channel(
    state: &AppState,
    rest: &[&str],
    body: Value,
    on_event: tauri::ipc::Channel<Value>,
) -> AppResult<()> {
    match rest {
        ["st-bulk", "run"] | ["st-bulk", "run-stream"] => {
            bulk_imports::run_st_bulk_import_channel(state, body, |event| {
                on_event.send(event).map_err(|error| {
                    AppError::new("import_stream_channel_error", error.to_string())
                })
            })
        }
        _ => Err(AppError::new(
            "stream_not_supported",
            format!("Streaming is not supported for /import/{}", rest.join("/")),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "marinara-st-character-import-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn import_st_character_ignores_untrusted_avatar_source_fields() {
        let app_root = temp_path("app");
        let source_root = temp_path("source");
        fs::create_dir_all(&source_root).expect("source dir should be created");
        let source = source_root.join("not-an-avatar.txt");
        fs::write(&source, b"do not copy me").expect("source fixture should be written");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_character(
            &state,
            json!({
                "spec": "chara_card_v2",
                "data": {
                    "name": "Reserved Field Probe",
                    "description": "Should not copy arbitrary files"
                },
                "_avatarSourcePath": source.to_string_lossy(),
                "_avatarFileCopySourcePath": source.to_string_lossy()
            }),
        )
        .expect("reserved avatar source fields should be ignored");

        let character = result
            .get("character")
            .and_then(Value::as_object)
            .expect("import should return a character record");
        assert!(
            character
                .get("avatarFilePath")
                .and_then(Value::as_str)
                .is_none(),
            "external payload fields must not create managed avatar file paths"
        );
        assert_eq!(character.get("avatarPath"), Some(&Value::Null));
        assert!(
            !app_root.join("avatars").join("characters").exists(),
            "untrusted local file paths should not be copied into managed avatars"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(source_root);
    }

    #[test]
    fn import_st_character_uses_trusted_avatar_source_path() {
        let app_root = temp_path("app");
        let source_root = temp_path("source");
        fs::create_dir_all(&source_root).expect("source dir should be created");
        let source = source_root.join("trusted-avatar.png");
        fs::write(&source, b"trusted-avatar-bytes").expect("source fixture should be written");
        let state = AppState::from_data_dir(&app_root, Vec::new())
            .expect("test app state should initialize");

        let result = import_st_character_payload(
            &state,
            json!({
                "spec": "chara_card_v2",
                "data": {
                    "name": "Trusted Source",
                    "description": "Trusted bulk import source path"
                }
            }),
            Some("trusted-avatar.png".to_string()),
            &Value::Null,
            Some(&source),
        )
        .expect("trusted avatar source should import");

        let character = result
            .get("character")
            .and_then(Value::as_object)
            .expect("import should return a character record");
        let avatar_file_path = character
            .get("avatarFilePath")
            .and_then(Value::as_str)
            .expect("trusted source should create a managed avatar file");
        assert!(
            avatar_file_path.contains("avatars")
                && avatar_file_path.contains("characters")
                && avatar_file_path.ends_with("trusted-avatar.png"),
            "managed avatar path should stay under the character avatar folder"
        );
        assert!(
            Path::new(avatar_file_path).exists(),
            "managed avatar file should exist"
        );

        let _ = fs::remove_dir_all(app_root);
        let _ = fs::remove_dir_all(source_root);
    }
}
