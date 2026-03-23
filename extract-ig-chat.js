// =============================================================
// Instagram Web DM Conversation Extractor
// Pega este script en la consola del navegador (F12 > Console)
// mientras tienes abierta una conversación de Instagram Web.
// =============================================================

(function () {
  "use strict";

  const CONFIG = {
    // Nombre tuyo (aparecerá en los mensajes que tú enviaste)
    myName: "Yo",
    // Nombre de la otra persona
    theirName: "Ella",
    // Separador entre mensajes
    separator: "─".repeat(50),
    // Mostrar timestamps
    showTimestamps: true,
    // Formato de salida: 'text' o 'html'
    outputFormat: "text",
  };

  // ── Utilidades ──

  function getComputedAlign(el) {
    // Instagram usa flexbox para alinear mensajes: end = tuyo, start = de ellos
    let current = el;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const justify = style.justifyContent || style.alignItems;
      const alignSelf = style.alignSelf;
      if (alignSelf === "flex-end" || alignSelf === "end") return "right";
      if (alignSelf === "flex-start" || alignSelf === "start") return "left";
      if (justify === "flex-end" || justify === "end") return "right";
      if (justify === "flex-start" || justify === "start") return "left";

      // Check margin-left: auto pattern (common for right-aligned)
      if (style.marginLeft === "auto" && style.marginRight !== "auto")
        return "right";
      if (style.marginRight === "auto" && style.marginLeft !== "auto")
        return "left";

      current = current.parentElement;
    }
    return null;
  }

  function getBubbleAlignment(bubble) {
    // Strategy 1: Check flex alignment
    const flexAlign = getComputedAlign(bubble);
    if (flexAlign) return flexAlign;

    // Strategy 2: Check position relative to container
    const container = bubble.closest('[role="list"], [role="grid"]') ||
      bubble.parentElement?.parentElement;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const containerCenter = containerRect.left + containerRect.width / 2;
      const bubbleCenter = bubbleRect.left + bubbleRect.width / 2;
      if (bubbleCenter > containerCenter) return "right";
      if (bubbleCenter < containerCenter) return "left";
    }

    return "unknown";
  }

  // ── Extracción de mensajes ──

  function extractMessages() {
    const messages = [];

    // Strategy 1: Find message rows using role="row" (Instagram's chat structure)
    let messageElements = document.querySelectorAll('[role="row"]');

    // Strategy 2: If no rows, try role="listitem" or common message containers
    if (messageElements.length === 0) {
      messageElements = document.querySelectorAll('[role="listitem"]');
    }

    // Strategy 3: Look for the chat container and its direct children
    if (messageElements.length === 0) {
      const chatContainer =
        document.querySelector('[role="list"]') ||
        document.querySelector(
          'div[style*="flex-direction: column"] > div > div > div'
        );
      if (chatContainer) {
        messageElements = chatContainer.children;
      }
    }

    if (messageElements.length === 0) {
      console.error(
        "❌ No se encontraron mensajes. Asegúrate de tener una conversación abierta."
      );
      return [];
    }

    console.log(`📨 Encontrados ${messageElements.length} elementos de mensaje`);

    for (const el of messageElements) {
      const msgData = parseMessageElement(el);
      if (msgData) {
        messages.push(msgData);
      }
    }

    return messages;
  }

  function parseMessageElement(el) {
    // Skip empty or system elements (date separators, etc.)
    const textContent = el.textContent?.trim();
    if (!textContent) return null;

    // Detect date/time separators (e.g., "March 15, 2025", "10:30 AM")
    const isDateSeparator =
      /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)|hoy|ayer|today|yesterday)/i.test(
        textContent
      );

    // Check if element looks like a timestamp row (short text, no bubble-like children)
    if (isDateSeparator && textContent.length < 80) {
      return {
        type: "timestamp",
        text: textContent,
        element: el,
      };
    }

    // Try to find the actual message bubble/content
    const alignment = getBubbleAlignment(el);

    // Extract text from spans (Instagram wraps text in multiple spans)
    let messageText = "";
    const textSpans = el.querySelectorAll("span");
    if (textSpans.length > 0) {
      // Get unique text from spans, avoiding duplicates from nested spans
      const seen = new Set();
      const texts = [];
      for (const span of textSpans) {
        // Only get leaf-level text or direct text
        if (span.children.length === 0 || span.querySelector("br")) {
          const t = span.textContent?.trim();
          if (t && !seen.has(t)) {
            seen.add(t);
            texts.push(t);
          }
        }
      }
      messageText = texts.join(" ").trim();
    }

    if (!messageText) {
      messageText = textContent;
    }

    // Skip very short system messages
    if (messageText.length < 1) return null;

    // Detect reply (Instagram shows replied-to message above)
    let replyTo = null;
    // Replies in Instagram typically have a smaller/quoted element above the main message
    const possibleReply = el.querySelector(
      '[data-testid*="reply"], [class*="reply"], [aria-label*="reply"], [aria-label*="respuesta"]'
    );
    if (possibleReply) {
      replyTo = possibleReply.textContent?.trim();
    }

    // Detect media (images, videos, voice messages, stickers)
    const hasImage = el.querySelector("img:not([alt=''])");
    const hasVideo = el.querySelector("video");
    const hasAudio = el.querySelector("audio");

    let mediaLabel = "";
    if (hasAudio) mediaLabel = " [🎵 Audio]";
    else if (hasVideo) mediaLabel = " [🎬 Video]";
    else if (hasImage) {
      const alt = hasImage.getAttribute("alt") || "";
      if (alt && !alt.includes("profile")) {
        mediaLabel = ` [📷 Imagen: ${alt}]`;
      } else if (!messageText || messageText === alt) {
        mediaLabel = " [📷 Imagen]";
      }
    }

    // Detect likes/reactions
    const likeButton = el.querySelector('[aria-label*="like"], [aria-label*="gusta"]');

    const sender =
      alignment === "right"
        ? CONFIG.myName
        : alignment === "left"
          ? CONFIG.theirName
          : "???";

    // Clean up the message text - remove duplicate timestamp at end
    messageText = messageText.replace(
      /\s*((\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))\s*)$/i,
      ""
    );

    // If it's just a media message with no text
    if (!messageText && mediaLabel) {
      messageText = mediaLabel.trim();
      mediaLabel = "";
    }

    if (!messageText && !mediaLabel) return null;

    return {
      type: "message",
      sender,
      text: messageText + mediaLabel,
      replyTo,
      alignment,
      element: el,
    };
  }

  // ── Formateo ──

  function formatConversation(messages) {
    if (messages.length === 0) {
      return "❌ No se encontraron mensajes para formatear.";
    }

    const lines = [];
    lines.push("╔" + "═".repeat(52) + "╗");
    lines.push("║  💬 Conversación de Instagram - Exportada          ║");
    lines.push(
      "║  📅 " + new Date().toLocaleDateString("es-ES", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).padEnd(47) + "║"
    );
    lines.push("╚" + "═".repeat(52) + "╝");
    lines.push("");

    let lastSender = null;

    for (const msg of messages) {
      if (msg.type === "timestamp") {
        if (CONFIG.showTimestamps) {
          lines.push("");
          lines.push(`      ⏰ ${msg.text}`);
          lines.push("");
        }
        lastSender = null;
        continue;
      }

      if (msg.type === "message") {
        const isNewSender = msg.sender !== lastSender;

        if (isNewSender) {
          lines.push("");
          const icon = msg.sender === CONFIG.myName ? "🟦" : "🟪";
          lines.push(`${icon} ${msg.sender}:`);
        }

        if (msg.replyTo) {
          lines.push(`   ↩️ Respondiendo a: "${msg.replyTo}"`);
        }

        // Wrap long messages
        const prefix = "   ";
        const maxWidth = 70;
        const words = msg.text.split(" ");
        let currentLine = prefix;

        for (const word of words) {
          if ((currentLine + " " + word).length > maxWidth && currentLine !== prefix) {
            lines.push(currentLine);
            currentLine = prefix + word;
          } else {
            currentLine += (currentLine === prefix ? "" : " ") + word;
          }
        }
        if (currentLine !== prefix) {
          lines.push(currentLine);
        }

        lastSender = msg.sender;
      }
    }

    lines.push("");
    lines.push(CONFIG.separator);
    lines.push(`📊 Total: ${messages.filter((m) => m.type === "message").length} mensajes`);
    lines.push(CONFIG.separator);

    return lines.join("\n");
  }

  // ── UI: Panel de control ──

  function createUI() {
    // Remove existing panel if any
    const existing = document.getElementById("ig-extractor-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "ig-extractor-panel";
    panel.innerHTML = `
      <style>
        #ig-extractor-panel {
          position: fixed;
          top: 10px;
          right: 10px;
          width: 380px;
          max-height: 90vh;
          background: #1a1a2e;
          color: #eee;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          z-index: 99999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        #ig-extractor-panel .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 14px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: move;
        }
        #ig-extractor-panel .header h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
        }
        #ig-extractor-panel .close-btn {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        #ig-extractor-panel .close-btn:hover {
          background: rgba(255,255,255,0.4);
        }
        #ig-extractor-panel .controls {
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        #ig-extractor-panel label {
          font-size: 12px;
          color: #aaa;
          display: block;
          margin-bottom: 4px;
        }
        #ig-extractor-panel input[type="text"] {
          width: 100%;
          padding: 8px 10px;
          background: #16213e;
          border: 1px solid #333;
          border-radius: 6px;
          color: #eee;
          font-size: 13px;
          box-sizing: border-box;
        }
        #ig-extractor-panel input[type="text"]:focus {
          border-color: #667eea;
          outline: none;
        }
        #ig-extractor-panel .row {
          display: flex;
          gap: 10px;
        }
        #ig-extractor-panel .row > div {
          flex: 1;
        }
        #ig-extractor-panel .btn {
          padding: 10px 16px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s;
          width: 100%;
        }
        #ig-extractor-panel .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        #ig-extractor-panel .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102,126,234,0.4);
        }
        #ig-extractor-panel .btn-secondary {
          background: #16213e;
          color: #ccc;
          border: 1px solid #333;
        }
        #ig-extractor-panel .btn-secondary:hover {
          background: #1a2744;
        }
        #ig-extractor-panel .btn-row {
          display: flex;
          gap: 8px;
        }
        #ig-extractor-panel .output-area {
          flex: 1;
          overflow: auto;
          max-height: 50vh;
        }
        #ig-extractor-panel textarea {
          width: 100%;
          min-height: 200px;
          padding: 12px;
          background: #0f0f23;
          border: none;
          color: #ddd;
          font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
          font-size: 12px;
          resize: vertical;
          box-sizing: border-box;
          line-height: 1.5;
        }
        #ig-extractor-panel .status {
          padding: 8px 16px;
          font-size: 12px;
          color: #888;
          border-top: 1px solid #222;
        }
        #ig-extractor-panel .status.success { color: #4ade80; }
        #ig-extractor-panel .status.error { color: #f87171; }
        #ig-extractor-panel .check-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #ig-extractor-panel input[type="checkbox"] {
          accent-color: #667eea;
        }
      </style>
      <div class="header" id="ig-drag-handle">
        <h3>💬 IG Chat Extractor</h3>
        <button class="close-btn" id="ig-close-btn">✕</button>
      </div>
      <div class="controls">
        <div class="row">
          <div>
            <label>Tu nombre</label>
            <input type="text" id="ig-my-name" value="${CONFIG.myName}" />
          </div>
          <div>
            <label>Su nombre</label>
            <input type="text" id="ig-their-name" value="${CONFIG.theirName}" />
          </div>
        </div>
        <div class="check-row">
          <input type="checkbox" id="ig-show-time" checked />
          <label for="ig-show-time" style="margin:0; cursor:pointer;">Mostrar timestamps</label>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="ig-extract-btn">📋 Extraer Conversación</button>
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="ig-copy-btn" disabled>📑 Copiar al portapapeles</button>
          <button class="btn btn-secondary" id="ig-download-btn" disabled>💾 Descargar .txt</button>
        </div>
      </div>
      <div class="output-area">
        <textarea id="ig-output" readonly placeholder="Presiona 'Extraer Conversación' para comenzar..."></textarea>
      </div>
      <div class="status" id="ig-status">Listo. Abre una conversación y presiona Extraer.</div>
    `;

    document.body.appendChild(panel);

    // ── Event Listeners ──

    document.getElementById("ig-close-btn").addEventListener("click", () => {
      panel.remove();
    });

    document.getElementById("ig-extract-btn").addEventListener("click", () => {
      const status = document.getElementById("ig-status");
      const output = document.getElementById("ig-output");

      CONFIG.myName = document.getElementById("ig-my-name").value || "Yo";
      CONFIG.theirName = document.getElementById("ig-their-name").value || "Ella";
      CONFIG.showTimestamps = document.getElementById("ig-show-time").checked;

      status.textContent = "⏳ Extrayendo mensajes...";
      status.className = "status";

      try {
        const messages = extractMessages();
        const formatted = formatConversation(messages);
        output.value = formatted;

        const msgCount = messages.filter((m) => m.type === "message").length;
        status.textContent = `✅ ${msgCount} mensajes extraídos correctamente`;
        status.className = "status success";

        document.getElementById("ig-copy-btn").disabled = false;
        document.getElementById("ig-download-btn").disabled = false;
      } catch (err) {
        status.textContent = `❌ Error: ${err.message}`;
        status.className = "status error";
        console.error("IG Extractor error:", err);
      }
    });

    document.getElementById("ig-copy-btn").addEventListener("click", () => {
      const output = document.getElementById("ig-output");
      const status = document.getElementById("ig-status");
      navigator.clipboard.writeText(output.value).then(
        () => {
          status.textContent = "✅ Copiado al portapapeles";
          status.className = "status success";
        },
        () => {
          output.select();
          document.execCommand("copy");
          status.textContent = "✅ Copiado (fallback)";
          status.className = "status success";
        }
      );
    });

    document.getElementById("ig-download-btn").addEventListener("click", () => {
      const output = document.getElementById("ig-output");
      const status = document.getElementById("ig-status");
      const blob = new Blob([output.value], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ig-chat-${CONFIG.theirName}-${date}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = "✅ Archivo descargado";
      status.className = "status success";
    });

    // ── Drag functionality ──
    const handle = document.getElementById("ig-drag-handle");
    let isDragging = false;
    let offsetX, offsetY;

    handle.addEventListener("mousedown", (e) => {
      isDragging = true;
      offsetX = e.clientX - panel.getBoundingClientRect().left;
      offsetY = e.clientY - panel.getBoundingClientRect().top;
      panel.style.transition = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panel.style.left = e.clientX - offsetX + "px";
      panel.style.top = e.clientY - offsetY + "px";
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    console.log("✅ IG Chat Extractor cargado. Panel visible en esquina superior derecha.");
  }

  // ── Inicio ──
  createUI();
})();
