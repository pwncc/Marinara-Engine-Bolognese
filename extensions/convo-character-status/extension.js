/**
 * CONVO Character Status — Marinara extension
 * Displays per-character body/mood status stored in chat metadata.
 * Server injects status into prompts; AI updates via <character_status> tags.
 */
(function initConvoCharacterStatus(marinara) {
  const PANEL_COLLAPSED_KEY = "marinara.convoStatus.collapsed";
  const LIMB_ORDER = [
    "head",
    "neck",
    "torso",
    "leftArm",
    "rightArm",
    "leftHand",
    "rightHand",
    "leftLeg",
    "rightLeg",
    "groin",
  ];

  let rootEl = null;
  let panelCollapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  let lastChatId = null;
  let lastPayload = null;

  function formatLabel(key) {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }

  function getActiveConvoArea() {
    return document.querySelector(".mari-chat-area");
  }

  function barColor(value) {
    if (value >= 85) return "linear-gradient(90deg, #34d399, #6ee7b7)";
    if (value >= 55) return "linear-gradient(90deg, var(--primary, #7c6bff), #c084fc)";
    if (value >= 30) return "linear-gradient(90deg, #fbbf24, #f59e0b)";
    return "linear-gradient(90deg, #f87171, #ef4444)";
  }

  function renderStatusHtml(charName, status) {
    if (!status || typeof status !== "object") {
      return `<div class="marinara-convo-status-empty">No status yet for ${charName}.</div>`;
    }
    const parts = [];
    if (status.temperature) {
      parts.push(
        `<div class="marinara-convo-status-row"><span class="marinara-convo-status-label">Temp</span><span>${escapeHtml(status.temperature)}</span></div>`,
      );
    }
    if (status.emotion) {
      parts.push(
        `<div class="marinara-convo-status-row"><span class="marinara-convo-status-label">Emotion</span><span>${escapeHtml(status.emotion)}</span></div>`,
      );
    }
    const bars = status.bars && typeof status.bars === "object" ? status.bars : {};
    const barKeys = Object.keys(bars).sort((a, b) => a.localeCompare(b));
    for (const key of barKeys) {
      const val = Math.max(0, Math.min(100, Math.round(Number(bars[key]) || 0)));
      parts.push(
        `<div class="marinara-convo-status-bar-wrap">
          <div class="marinara-convo-status-bar-label"><span>${escapeHtml(formatLabel(key))}</span><span>${val}%</span></div>
          <div class="marinara-convo-status-bar-track"><div class="marinara-convo-status-bar-fill" style="width:${val}%;background:${barColor(val)}"></div></div>
        </div>`,
      );
    }
    const limbs = status.limbs && typeof status.limbs === "object" ? status.limbs : {};
    const limbKeys = [
      ...LIMB_ORDER.filter((k) => limbs[k]),
      ...Object.keys(limbs)
        .filter((k) => !LIMB_ORDER.includes(k))
        .sort((a, b) => a.localeCompare(b)),
    ];
    for (const key of limbKeys) {
      const text = limbs[key];
      if (!text) continue;
      parts.push(
        `<div class="marinara-convo-status-row"><span class="marinara-convo-status-label">${escapeHtml(formatLabel(key))}</span><span>${escapeHtml(text)}</span></div>`,
      );
    }
    const extras = status.extras && typeof status.extras === "object" ? status.extras : {};
    for (const [key, value] of Object.entries(extras).sort(([a], [b]) => a.localeCompare(b))) {
      parts.push(
        `<div class="marinara-convo-status-row"><span class="marinara-convo-status-label">${escapeHtml(formatLabel(key))}</span><span>${escapeHtml(String(value))}</span></div>`,
      );
    }
    if (status.notes) {
      parts.push(
        `<div class="marinara-convo-status-row"><span class="marinara-convo-status-label">Notes</span><span>${escapeHtml(status.notes)}</span></div>`,
      );
    }
    if (!parts.length) {
      return `<div class="marinara-convo-status-empty">No status yet for ${charName}.</div>`;
    }
    return parts.join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPanel(chatId, chat) {
    if (!rootEl) return;
    const statusMap =
      chat?.metadata?.convoCharacterStatus && typeof chat.metadata.convoCharacterStatus === "object"
        ? chat.metadata.convoCharacterStatus
        : {};
    const charIds = Array.isArray(chat?.characterIds) ? chat.characterIds : [];
    const sections = [];

    for (const charId of charIds) {
      const status = statusMap[charId];
      const name =
        (chat?._charNames && chat._charNames[charId]) ||
        (typeof charId === "string" ? charId.slice(0, 8) : "Character");
      sections.push(
        `<div class="marinara-convo-status-char"><div class="marinara-convo-status-char-name">${escapeHtml(name)}</div>${renderStatusHtml(name, status)}</div>`,
      );
    }

    if (!sections.length) {
      sections.push(`<div class="marinara-convo-status-empty">Open a conversation chat to track character status.</div>`);
    }

    rootEl.innerHTML = `
      <div class="marinara-convo-status-panel">
        <div class="marinara-convo-status-header" data-action="toggle">
          <strong>Character status</strong>
          <button type="button" class="marinara-convo-status-toggle" data-action="toggle">${panelCollapsed ? "Show" : "Hide"}</button>
        </div>
        <div class="marinara-convo-status-body" style="display:${panelCollapsed ? "none" : "block"}">
          ${sections.join("")}
          <div class="marinara-convo-status-hint">AI can update hidden <code>&lt;character_status&gt;{...}&lt;/character_status&gt;</code> tags. Status stays in context between messages.</div>
        </div>
      </div>`;

    rootEl.querySelectorAll('[data-action="toggle"]').forEach((el) => {
      marinara.on(el, "click", (e) => {
        e.stopPropagation();
        panelCollapsed = !panelCollapsed;
        localStorage.setItem(PANEL_COLLAPSED_KEY, panelCollapsed ? "1" : "0");
        renderPanel(chatId, lastPayload);
      });
    });
  }

  async function loadChat(chatId) {
    try {
      const chat = await marinara.apiFetch(`/chats/${chatId}`);
      const charIds = Array.isArray(chat.characterIds) ? chat.characterIds : [];
      const names = {};
      for (const id of charIds) {
        try {
          const row = await marinara.apiFetch(`/characters/${id}`);
          const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          names[id] = data?.name || "Character";
        } catch {
          names[id] = "Character";
        }
      }
      chat._charNames = names;
      lastPayload = chat;
      lastChatId = chatId;
      renderPanel(chatId, chat);
    } catch (err) {
      console.warn("[Convo Character Status] Failed to load chat:", err);
    }
  }

  function mountPanel() {
    const area = getActiveConvoArea();
    if (!area) {
      if (rootEl) {
        rootEl.remove();
        rootEl = null;
      }
      lastChatId = null;
      return;
    }

    const chatId = area.getAttribute("data-chat-id");
    if (!chatId) return;

    if (!rootEl || rootEl.parentElement !== area) {
      if (rootEl) rootEl.remove();
      rootEl = document.createElement("div");
      rootEl.className = "marinara-convo-status-root";
      rootEl.setAttribute("data-marinara-extension", "convo-character-status");
      area.appendChild(rootEl);
    }

    if (chatId !== lastChatId || !lastPayload) {
      void loadChat(chatId);
    } else {
      renderPanel(chatId, lastPayload);
    }
  }

  marinara.on(window, "marinara:convo-character-status", (event) => {
    const detail = event?.detail;
    const area = getActiveConvoArea();
    if (!area || !detail?.chatId) return;
    if (area.getAttribute("data-chat-id") !== detail.chatId) return;
    void loadChat(detail.chatId);
  });

  // Do NOT observe document.body — that freezes the app (infinite mutation loop with React).
  // Built-in UI lives in ConvoCharacterStatusPanel; this extension is legacy/optional.
  marinara.setInterval(() => mountPanel(), 2000);

  mountPanel();
  console.info(
    "[Convo Character Status] Legacy extension loaded. Prefer the built-in panel — disable this extension in Settings if the UI is duplicated.",
  );
})(marinara);
