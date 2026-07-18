# CONVO Character Status

**Built into Marinara** (conversation, roleplay, and group chats). Extensions cannot inject LLM prompt context, so this lives in core:

- **Server:** stores status, injects it into prompts, parses `<character_status>` tags
- **Client:** `ConvoCharacterStatusPanel` in conversation chats — **no extension import needed**

Per `CONTRIBUTING.md`, use `pnpm dev` while developing. If you use `start.bat` / `start.sh`, the launcher rebuilds when `packages/client/src` is newer than `dist` (so a mid-session `pnpm check` cannot strand a running server with wrong asset hashes).

## Blank page / MIME type errors on `/assets/*.js`

Usually two things at once:

1. **Old server still on port 7860** — it returns `index.html` for new hashed `/assets/*` files after a client rebuild.
2. **Stale service worker (Workbox)** — cached bad responses; DevTools shows `workbox-*.js` / `Failed to fetch`.

Fix:

1. Close Marinara (Ctrl+C), then run **`start.bat`** again (it now stops the previous listener on that port and rebuilds if needed).
2. In the browser: **DevTools → Application → Service Workers → Unregister**, then **Clear site data** for `127.0.0.1:7860`.
3. Hard refresh (Ctrl+Shift+R).

Also **disable** “CONVO Character Status” under **Settings → Extensions** if you imported an older copy — the built-in panel replaces it.

## Optional legacy extension bundle

Run `node extensions/convo-character-status/build.mjs` to generate `convo-character-status.json` for manual import. Not required.

## AI usage

```xml
<character_status>{"temperature":"warm","bars":{"happiness":90,"arousal":50},"limbs":{"rightHand":"sore, holding beer can","leftArm":"fine"}}</character_status>
```

Partial updates merge; bars are 0–100. Limb values may include sensation, position, objects inside, or items held.
