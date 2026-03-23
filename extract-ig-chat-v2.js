// =============================================================
// Instagram Web DM Extractor v2 - Accessibility Tree Based
// Más robusto ante cambios de Instagram.
// Pega en la consola (F12 > Console) con un DM abierto.
// =============================================================

(function () {
  "use strict";

  // ── CONFIGURACIÓN ──
  // Cambia estos valores antes de ejecutar si quieres
  const MI_NOMBRE = "Yo";
  const SU_NOMBRE = "Ella";
  const MOSTRAR_HORAS = true;

  // ── LÓGICA ──

  function findChatContainer() {
    // Instagram's main message area - try multiple selectors
    const candidates = [
      // Main chat thread container
      () => document.querySelector('[role="list"]'),
      () => document.querySelector('[role="grid"]'),
      // Fallback: look for the scrollable area in chat
      () => {
        const all = document.querySelectorAll('[role="presentation"]');
        for (const el of all) {
          if (el.querySelector('[role="row"]')) return el;
        }
        return null;
      },
      // Another fallback: largest scrollable div with many children
      () => {
        const divs = document.querySelectorAll("div[style]");
        let best = null;
        let bestCount = 0;
        for (const d of divs) {
          const rows = d.querySelectorAll('[role="row"]');
          if (rows.length > bestCount) {
            bestCount = rows.length;
            best = d;
          }
        }
        return bestCount > 3 ? best : null;
      },
    ];

    for (const fn of candidates) {
      const result = fn();
      if (result) return result;
    }
    return null;
  }

  function getMessageSide(element) {
    // Walk up to find the row, then check visual position
    const row = element.closest('[role="row"]') || element;
    const rect = row.getBoundingClientRect();

    // Get the chat container width for reference
    const container = findChatContainer();
    if (!container) return "unknown";

    const containerRect = container.getBoundingClientRect();
    const midpoint = containerRect.left + containerRect.width / 2;

    // Find the actual bubble (the colored/styled element)
    const bubbles = row.querySelectorAll("div");
    let furthestRight = 0;
    let furthestLeft = Infinity;

    for (const b of bubbles) {
      const r = b.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        if (r.right > furthestRight) furthestRight = r.right;
        if (r.left < furthestLeft) furthestLeft = r.left;
      }
    }

    // If the message bubble's center is past midpoint = mine (right)
    const msgCenter = (furthestLeft + furthestRight) / 2;
    if (msgCenter > midpoint + 20) return "right";
    if (msgCenter < midpoint - 20) return "left";

    // Tighter check using padding/margin
    const rowStyle = window.getComputedStyle(row);
    const firstChild = row.firstElementChild;
    if (firstChild) {
      const fcStyle = window.getComputedStyle(firstChild);
      if (
        fcStyle.alignItems === "flex-end" ||
        fcStyle.alignSelf === "flex-end" ||
        fcStyle.justifyContent === "flex-end"
      )
        return "right";
      if (
        fcStyle.alignItems === "flex-start" ||
        fcStyle.alignSelf === "flex-start" ||
        fcStyle.justifyContent === "flex-start"
      )
        return "left";
    }

    return "unknown";
  }

  function isTimestampElement(el) {
    const text = el.textContent?.trim() || "";
    if (text.length > 100) return false;
    if (text.length < 2) return false;

    // Check for common timestamp patterns
    const patterns = [
      /^\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)$/i,
      /^(hoy|ayer|today|yesterday)/i,
      /^(lun|mar|mié|jue|vie|sáb|dom|mon|tue|wed|thu|fri|sat|sun)/i,
      /^\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i,
      /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i,
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    ];

    return patterns.some((p) => p.test(text));
  }

  function extractReplyText(rowElement) {
    // Instagram shows replied-to message as a smaller element
    // Look for elements with reduced opacity or smaller font
    const children = rowElement.querySelectorAll("div, span");
    let possibleReply = null;

    for (const child of children) {
      const style = window.getComputedStyle(child);
      const opacity = parseFloat(style.opacity);
      const fontSize = parseFloat(style.fontSize);

      // Replies tend to have reduced opacity or be in a "quoted" container
      if (opacity < 0.8 && opacity > 0 && child.textContent?.trim().length > 2) {
        possibleReply = child.textContent.trim();
        break;
      }
    }

    // Also check for aria labels indicating reply
    const replyEl = rowElement.querySelector(
      '[aria-label*="reply"], [aria-label*="respuesta"], [aria-label*="Replied"]'
    );
    if (replyEl) {
      return replyEl.textContent?.trim() || possibleReply;
    }

    return possibleReply;
  }

  function detectMedia(rowElement) {
    const parts = [];
    if (rowElement.querySelector("video")) parts.push("🎬 Video");
    if (rowElement.querySelector("audio")) parts.push("🎵 Audio");

    const imgs = rowElement.querySelectorAll("img");
    for (const img of imgs) {
      const alt = img.getAttribute("alt") || "";
      const src = img.getAttribute("src") || "";
      // Skip profile pictures and UI icons
      if (src.includes("profile") || src.includes("avatar")) continue;
      if (img.width < 20 || img.height < 20) continue;

      if (alt && !alt.includes("profile")) {
        parts.push(`📷 ${alt}`);
      } else {
        parts.push("📷 Imagen");
      }
    }

    // Detect stickers
    const sticker = rowElement.querySelector('[aria-label*="sticker"]');
    if (sticker) parts.push("🏷️ Sticker");

    // Detect likes (heart reactions on messages)
    const heart = rowElement.querySelector(
      '[aria-label*="liked"], [aria-label*="gusta"], [aria-label*="❤"]'
    );
    if (heart) parts.push("❤️");

    return parts;
  }

  function getCleanText(element) {
    // Get text content but avoid duplicates from nested elements
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent?.trim();
      if (t) texts.push(t);
    }
    return texts.join(" ").trim();
  }

  function extract() {
    const container = findChatContainer();
    if (!container) {
      return { error: "No se encontró el contenedor de chat. ¿Tienes un DM abierto?" };
    }

    const rows = container.querySelectorAll('[role="row"]');
    if (rows.length === 0) {
      return { error: "No se encontraron mensajes (role=row). Intenta scrollear un poco." };
    }

    const results = [];

    for (const row of rows) {
      const text = row.textContent?.trim();
      if (!text) continue;

      // Check timestamp
      if (isTimestampElement(row)) {
        results.push({ type: "time", text });
        continue;
      }

      // Get side
      const side = getMessageSide(row);
      const sender = side === "right" ? MI_NOMBRE : side === "left" ? SU_NOMBRE : "???";

      // Get clean message text
      let msgText = getCleanText(row);

      // Remove any trailing timestamp from the message
      msgText = msgText.replace(
        /\s*\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)\s*$/i,
        ""
      ).trim();

      // Extract inline timestamp if present
      const timeMatch = text.match(
        /(\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))/i
      );

      // Reply detection
      const replyText = extractReplyText(row);

      // Media detection
      const media = detectMedia(row);

      if (!msgText && media.length === 0) continue;

      const entry = {
        type: "msg",
        sender,
        text: msgText || "",
        media,
        time: timeMatch ? timeMatch[1] : null,
        replyTo: replyText,
      };

      results.push(entry);
    }

    return { messages: results };
  }

  // ── FORMATEO ──

  function format(data) {
    if (data.error) return `❌ ${data.error}`;

    const msgs = data.messages;
    const lines = [];

    lines.push("╔" + "═".repeat(54) + "╗");
    lines.push("║  💬 Conversación de Instagram                        ║");
    lines.push("║  📅 Exportada: " +
      new Date().toLocaleDateString("es-ES", {
        day: "numeric", month: "long", year: "numeric",
      }).padEnd(39) + "║");
    lines.push("║  👤 " + `${MI_NOMBRE} ↔ ${SU_NOMBRE}`.padEnd(49) + "║");
    lines.push("╚" + "═".repeat(54) + "╝");
    lines.push("");

    let lastSender = null;

    for (const m of msgs) {
      if (m.type === "time") {
        if (MOSTRAR_HORAS) {
          lines.push("");
          lines.push("  ─── " + m.text + " ───");
          lines.push("");
        }
        lastSender = null;
        continue;
      }

      const newSender = m.sender !== lastSender;

      if (newSender) {
        lines.push("");
        const icon = m.sender === MI_NOMBRE ? "🔵" : "🟣";
        const timeStr = m.time ? ` (${m.time})` : "";
        lines.push(`${icon} ${m.sender}${timeStr}:`);
      } else if (m.time && MOSTRAR_HORAS) {
        // Consecutive from same sender, just show time
        lines.push(`     [${m.time}]`);
      }

      if (m.replyTo) {
        const short =
          m.replyTo.length > 50 ? m.replyTo.slice(0, 50) + "…" : m.replyTo;
        lines.push(`   ↩️ En respuesta a: "${short}"`);
      }

      if (m.text) {
        // Word wrap at 65 chars
        const words = m.text.split(/\s+/);
        let line = "   ";
        for (const w of words) {
          if ((line + " " + w).length > 68 && line.trim()) {
            lines.push(line);
            line = "   " + w;
          } else {
            line += (line.trim() ? " " : "") + w;
          }
        }
        if (line.trim()) lines.push(line);
      }

      for (const med of m.media) {
        lines.push(`   [${med}]`);
      }

      lastSender = m.sender;
    }

    const count = msgs.filter((m) => m.type === "msg").length;
    const myCount = msgs.filter((m) => m.sender === MI_NOMBRE).length;
    const theirCount = msgs.filter((m) => m.sender === SU_NOMBRE).length;

    lines.push("");
    lines.push("─".repeat(54));
    lines.push(`📊 Total: ${count} mensajes (${MI_NOMBRE}: ${myCount}, ${SU_NOMBRE}: ${theirCount})`);
    lines.push("─".repeat(54));

    return lines.join("\n");
  }

  // ── UI PANEL ──

  function showPanel() {
    const existing = document.getElementById("ig-ext-v2");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "ig-ext-v2";
    Object.assign(panel.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      width: "400px",
      maxHeight: "92vh",
      background: "#1c1c2e",
      color: "#e4e4e4",
      borderRadius: "14px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
      zIndex: "999999",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      fontSize: "14px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    });

    panel.innerHTML = `
      <div id="ig2-header" style="
        background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045);
        padding: 14px 18px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: grab;
      ">
        <span style="font-weight:700; font-size:15px;">💬 IG Chat Extractor v2</span>
        <button id="ig2-close" style="
          background: rgba(0,0,0,0.25); border:none; color:#fff;
          width:30px; height:30px; border-radius:50%; cursor:pointer;
          font-size:16px; display:flex; align-items:center; justify-content:center;
        ">✕</button>
      </div>

      <div style="padding:14px 18px; display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; gap:10px;">
          <div style="flex:1">
            <label style="font-size:11px; color:#888; display:block; margin-bottom:3px;">Tu nombre</label>
            <input id="ig2-me" type="text" value="${MI_NOMBRE}" style="
              width:100%; padding:7px 10px; background:#141425; border:1px solid #333;
              border-radius:6px; color:#eee; font-size:13px; box-sizing:border-box;
            " />
          </div>
          <div style="flex:1">
            <label style="font-size:11px; color:#888; display:block; margin-bottom:3px;">Su nombre</label>
            <input id="ig2-them" type="text" value="${SU_NOMBRE}" style="
              width:100%; padding:7px 10px; background:#141425; border:1px solid #333;
              border-radius:6px; color:#eee; font-size:13px; box-sizing:border-box;
            " />
          </div>
        </div>

        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#aaa; cursor:pointer;">
          <input id="ig2-time" type="checkbox" ${MOSTRAR_HORAS ? "checked" : ""} style="accent-color:#833ab4;" />
          Mostrar fechas/horas
        </label>

        <div style="display:flex; gap:8px;">
          <button id="ig2-scroll" style="
            flex:1; padding:9px; background:#2a2a45; color:#ccc;
            border:1px solid #444; border-radius:8px; cursor:pointer;
            font-size:12px; font-weight:600;
          ">⬆️ Scroll arriba primero</button>
          <button id="ig2-go" style="
            flex:2; padding:9px;
            background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045);
            color:#fff; border:none; border-radius:8px; cursor:pointer;
            font-size:13px; font-weight:700;
          ">📋 Extraer Chat</button>
        </div>

        <div style="display:flex; gap:8px;">
          <button id="ig2-copy" disabled style="
            flex:1; padding:8px; background:#2a2a45; color:#666;
            border:1px solid #333; border-radius:8px; cursor:pointer;
            font-size:12px; font-weight:600;
          ">📑 Copiar</button>
          <button id="ig2-dl" disabled style="
            flex:1; padding:8px; background:#2a2a45; color:#666;
            border:1px solid #333; border-radius:8px; cursor:pointer;
            font-size:12px; font-weight:600;
          ">💾 Descargar .txt</button>
        </div>
      </div>

      <textarea id="ig2-out" readonly style="
        flex:1; min-height:180px; max-height:45vh; padding:12px;
        background:#0d0d1a; border:none; color:#ddd; resize:vertical;
        font-family:'Cascadia Code','Fira Code','Consolas',monospace;
        font-size:11.5px; line-height:1.5; box-sizing:border-box;
      " placeholder="1. Abre una conversación de Instagram\n2. (Opcional) Scrollea arriba para cargar más mensajes\n3. Presiona 'Extraer Chat'\n4. Copia o descarga el resultado"></textarea>

      <div id="ig2-status" style="
        padding:8px 18px; font-size:11px; color:#666;
        border-top:1px solid #222;
      ">Listo para extraer ✨</div>
    `;

    document.body.appendChild(panel);

    // Eventos
    document.getElementById("ig2-close").onclick = () => panel.remove();

    document.getElementById("ig2-scroll").onclick = () => {
      const container = findChatContainer();
      if (container) {
        container.scrollTop = 0;
        document.getElementById("ig2-status").textContent =
          "⬆️ Scrolleando arriba... Espera que carguen los mensajes y luego extrae.";
      } else {
        document.getElementById("ig2-status").textContent =
          "❌ No encontré el chat. ¿Tienes un DM abierto?";
      }
    };

    document.getElementById("ig2-go").onclick = () => {
      const status = document.getElementById("ig2-status");
      status.textContent = "⏳ Extrayendo...";
      status.style.color = "#888";

      // Update config from inputs
      const me = document.getElementById("ig2-me").value.trim() || "Yo";
      const them = document.getElementById("ig2-them").value.trim() || "Ella";

      // Patch names into closured variables via re-execution
      // (simpler: just use the inputs directly in format)
      setTimeout(() => {
        try {
          // Temporarily patch names
          const origMi = MI_NOMBRE;
          const origSu = SU_NOMBRE;

          // Can't reassign const, so we work around by re-calling with params
          const data = extract();

          if (data.error) {
            status.textContent = `❌ ${data.error}`;
            status.style.color = "#f87171";
            return;
          }

          // Rename senders in results
          for (const m of data.messages) {
            if (m.sender === MI_NOMBRE) m.sender = me;
            if (m.sender === SU_NOMBRE) m.sender = them;
          }

          // Format with custom names
          const msgs = data.messages;
          const lines = [];

          lines.push("╔" + "═".repeat(54) + "╗");
          lines.push("║  💬 Conversación de Instagram                        ║");
          lines.push("║  📅 " +
            new Date().toLocaleDateString("es-ES", {
              day: "numeric", month: "long", year: "numeric",
            }).padEnd(49) + "║");
          lines.push("║  👤 " + `${me} ↔ ${them}`.padEnd(49) + "║");
          lines.push("╚" + "═".repeat(54) + "╝");
          lines.push("");

          let lastSender = null;
          const showTime = document.getElementById("ig2-time").checked;

          for (const m of msgs) {
            if (m.type === "time") {
              if (showTime) {
                lines.push("");
                lines.push("  ─── " + m.text + " ───");
                lines.push("");
              }
              lastSender = null;
              continue;
            }

            const newSender = m.sender !== lastSender;
            if (newSender) {
              lines.push("");
              const icon = m.sender === me ? "🔵" : "🟣";
              const ts = m.time ? ` (${m.time})` : "";
              lines.push(`${icon} ${m.sender}${ts}:`);
            } else if (m.time && showTime) {
              lines.push(`     [${m.time}]`);
            }

            if (m.replyTo) {
              const short = m.replyTo.length > 50 ? m.replyTo.slice(0, 50) + "…" : m.replyTo;
              lines.push(`   ↩️ En respuesta a: "${short}"`);
            }

            if (m.text) {
              const words = m.text.split(/\s+/);
              let ln = "   ";
              for (const w of words) {
                if ((ln + " " + w).length > 68 && ln.trim()) {
                  lines.push(ln);
                  ln = "   " + w;
                } else {
                  ln += (ln.trim() ? " " : "") + w;
                }
              }
              if (ln.trim()) lines.push(ln);
            }

            for (const med of m.media) {
              lines.push(`   [${med}]`);
            }

            lastSender = m.sender;
          }

          const count = msgs.filter((m) => m.type === "msg").length;
          const myCount = msgs.filter((m) => m.sender === me).length;
          const theirCount = msgs.filter((m) => m.sender === them).length;

          lines.push("");
          lines.push("─".repeat(54));
          lines.push(`📊 Total: ${count} mensajes (${me}: ${myCount}, ${them}: ${theirCount})`);
          lines.push("─".repeat(54));

          const result = lines.join("\n");
          document.getElementById("ig2-out").value = result;
          document.getElementById("ig2-copy").disabled = false;
          document.getElementById("ig2-copy").style.color = "#ccc";
          document.getElementById("ig2-dl").disabled = false;
          document.getElementById("ig2-dl").style.color = "#ccc";

          status.textContent = `✅ ${count} mensajes extraídos`;
          status.style.color = "#4ade80";
        } catch (err) {
          status.textContent = `❌ Error: ${err.message}`;
          status.style.color = "#f87171";
          console.error(err);
        }
      }, 100);
    };

    document.getElementById("ig2-copy").onclick = () => {
      const text = document.getElementById("ig2-out").value;
      navigator.clipboard.writeText(text).then(() => {
        document.getElementById("ig2-status").textContent = "✅ Copiado al portapapeles";
        document.getElementById("ig2-status").style.color = "#4ade80";
      });
    };

    document.getElementById("ig2-dl").onclick = () => {
      const text = document.getElementById("ig2-out").value;
      const them = document.getElementById("ig2-them").value.trim() || "chat";
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ig-${them}-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      document.getElementById("ig2-status").textContent = "✅ Descargado";
      document.getElementById("ig2-status").style.color = "#4ade80";
    };

    // Drag
    let dragging = false, dx, dy;
    const hdr = document.getElementById("ig2-header");
    hdr.onmousedown = (e) => {
      dragging = true;
      dx = e.clientX - panel.getBoundingClientRect().left;
      dy = e.clientY - panel.getBoundingClientRect().top;
    };
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - dx) + "px";
      panel.style.top = (e.clientY - dy) + "px";
      panel.style.right = "auto";
    });
    document.addEventListener("mouseup", () => dragging = false);
  }

  showPanel();
  console.log(
    "%c💬 IG Chat Extractor v2 cargado",
    "color: #fcb045; font-size: 14px; font-weight: bold"
  );
})();
