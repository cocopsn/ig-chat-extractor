// ── popup.js — UI Logic ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let extractedData = null;
let rawText = "";
let activeTabId = null;
let progressInterval = null;

// ── Screen navigation ──

function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
}

function setStatus(icon, text, type = "idle") {
  $("#status-icon").textContent = icon;
  $("#status-text").textContent = text;
  const bar = $("#status-bar");
  bar.className = "status-bar status-" + type;
}

function showToast(msg) {
  let toast = $(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

// ── Progress polling ──

function startProgressPolling() {
  if (progressInterval) clearInterval(progressInterval);
  progressInterval = setInterval(async () => {
    if (!activeTabId) return;
    try {
      const resp = await chrome.tabs.sendMessage(activeTabId, { action: "progress-poll" });
      if (resp) {
        $("#loading-count").textContent = resp.count + " mensajes recolectados";
        if (resp.status) {
          $("#loading-detail").textContent = resp.status;
        }
        // Animate progress bar indeterminately
        const bar = $("#progress-bar");
        const curr = parseFloat(bar.style.width) || 0;
        bar.style.width = Math.min(curr + 2, 90) + "%";
      }
    } catch (e) { /* content script may not be ready */ }
  }, 600);
}

function stopProgressPolling() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  const bar = $("#progress-bar");
  if (bar) bar.style.width = "100%";
}

// ── Extract: send message to content script ──

async function doExtract() {
  const myName = $("#my-name").value.trim() || "Yo";
  const theirName = $("#their-name").value.trim() || "Ella";
  const scrollMode = document.querySelector('input[name="scroll-mode"]:checked')?.value || "auto-down";
  const speed = $("#scroll-speed").value || "normal";

  const opts = {
    myName,
    theirName,
    showTimestamps: $("#opt-timestamps").checked,
    showMedia: $("#opt-media").checked,
    showReplies: $("#opt-replies").checked,
    showStats: $("#opt-stats").checked,
  };

  showScreen("loading");
  $("#progress-bar").style.width = "0%";
  $("#loading-count").textContent = "0 mensajes recolectados";
  $("#loading-detail").textContent = "Iniciando extracción...";
  $("#btn-extract").style.display = "none";
  $("#btn-stop").style.display = "flex";
  setStatus("⏳", "Extrayendo mensajes...", "working");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("instagram.com")) {
      setStatus("❌", "Abre Instagram Web primero", "error");
      showScreen("setup");
      $("#btn-extract").style.display = "flex";
      $("#btn-stop").style.display = "none";
      return;
    }

    activeTabId = tab.id;

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (e) {
      // Already injected, ignore
    }

    // Small delay to let content script initialize
    await new Promise((r) => setTimeout(r, 300));

    // Start polling for progress
    startProgressPolling();

    // Send extract message to content script
    const data = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, {
        action: "extract",
        options: { scrollMode, speed },
      }, function (response) {
        resolve(response);
      });
    });

    stopProgressPolling();
    $("#btn-extract").style.display = "flex";
    $("#btn-stop").style.display = "none";

    if (!data || data.error) {
      setStatus("❌", data?.error || "No se pudieron extraer mensajes", "error");
      showScreen("setup");
      return;
    }

    extractedData = data;

    // Format the output
    const formatted = formatOutput(data.messages, opts);
    rawText = formatted.text;
    $("#raw-output").value = rawText;

    // Update stats
    const msgCount = data.messages.filter((m) => m.type === "msg").length;
    const myCount = data.messages.filter((m) => m.sender === "me").length;
    const theirCount = data.messages.filter((m) => m.sender === "them").length;

    $("#stat-total").textContent = msgCount;
    $("#stat-me").textContent = myCount;
    $("#stat-me-label").textContent = myName;
    $("#stat-them").textContent = theirCount;
    $("#stat-them-label").textContent = theirName;

    // Render preview
    renderPreview(data.messages, opts);

    setStatus("✅", `${msgCount} mensajes extraídos`, "success");
    showScreen("results");
  } catch (err) {
    stopProgressPolling();
    console.error("Extract error:", err);
    setStatus("❌", "Error: " + err.message, "error");
    showScreen("setup");
    $("#btn-extract").style.display = "flex";
    $("#btn-stop").style.display = "none";
  }
}

// ── Stop extraction ──

async function doStop() {
  if (activeTabId) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { action: "abort" });
    } catch (e) { /* ignore */ }
  }
  stopProgressPolling();
  $("#btn-extract").style.display = "flex";
  $("#btn-stop").style.display = "none";
  // The extraction will finish with whatever it has collected so far
}

// ── Format plain text output ──

function formatOutput(messages, opts) {
  const lines = [];

  lines.push("╔" + "═".repeat(52) + "╗");
  lines.push("║  💬 Conversación de Instagram" + " ".repeat(22) + "║");
  lines.push("║  📅 " +
    new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })
      .padEnd(47) + "║");
  lines.push("║  👤 " + `${opts.myName} ↔ ${opts.theirName}`.padEnd(47) + "║");
  lines.push("╚" + "═".repeat(52) + "╝");
  lines.push("");

  let lastSender = null;

  for (const m of messages) {
    if (m.type === "time") {
      if (opts.showTimestamps) {
        lines.push("");
        lines.push("  ─── " + m.text + " ───");
        lines.push("");
      }
      lastSender = null;
      continue;
    }

    const name = m.sender === "me" ? opts.myName : m.sender === "them" ? opts.theirName : "???";
    const isNew = name !== lastSender;

    if (isNew) {
      lines.push("");
      const icon = m.sender === "me" ? "🔵" : "🟣";
      const ts = m.time && opts.showTimestamps ? ` (${m.time})` : "";
      lines.push(`${icon} ${name}${ts}:`);
    } else if (m.time && opts.showTimestamps) {
      lines.push(`     [${m.time}]`);
    }

    if (m.replyTo && opts.showReplies) {
      const short = m.replyTo.length > 45 ? m.replyTo.slice(0, 45) + "…" : m.replyTo;
      lines.push(`   ↩️ En respuesta a: "${short}"`);
    }

    if (m.text) {
      const words = m.text.split(/\s+/);
      let line = "   ";
      for (const w of words) {
        if ((line + " " + w).length > 66 && line.trim()) {
          lines.push(line);
          line = "   " + w;
        } else {
          line += (line.trim() ? " " : "") + w;
        }
      }
      if (line.trim()) lines.push(line);
    }

    if (opts.showMedia) {
      for (const med of m.media) {
        const icons = { video: "🎬", audio: "🎵", foto: "📷" };
        const ico = med.startsWith("foto") ? "📷" : icons[med] || "📎";
        lines.push(`   [${ico} ${med}]`);
      }
    }

    lastSender = name;
  }

  if (opts.showStats) {
    const total = messages.filter((m) => m.type === "msg").length;
    const me = messages.filter((m) => m.sender === "me").length;
    const them = messages.filter((m) => m.sender === "them").length;
    lines.push("");
    lines.push("─".repeat(52));
    lines.push(`📊 Total: ${total} mensajes (${opts.myName}: ${me} | ${opts.theirName}: ${them})`);
    lines.push("─".repeat(52));
  }

  return { text: lines.join("\n") };
}

// ── Render visual preview ──

function renderPreview(messages, opts) {
  const container = $("#preview-content");
  container.innerHTML = "";

  let lastSender = null;

  for (const m of messages) {
    if (m.type === "time" && opts.showTimestamps) {
      const div = document.createElement("div");
      div.className = "msg-time";
      div.textContent = `── ${m.text} ──`;
      container.appendChild(div);
      lastSender = null;
      continue;
    }

    if (m.type !== "msg") continue;

    const name = m.sender === "me" ? opts.myName : m.sender === "them" ? opts.theirName : "???";
    const isNew = name !== lastSender;

    if (isNew) {
      const senderDiv = document.createElement("div");
      senderDiv.className = m.sender === "me" ? "msg-sender-me" : "msg-sender-them";
      const icon = m.sender === "me" ? "🔵" : "🟣";
      const ts = m.time && opts.showTimestamps ? ` (${m.time})` : "";
      senderDiv.textContent = `${icon} ${name}${ts}:`;
      container.appendChild(senderDiv);
    }

    if (m.replyTo && opts.showReplies) {
      const replyDiv = document.createElement("div");
      replyDiv.className = "msg-reply";
      const short = m.replyTo.length > 50 ? m.replyTo.slice(0, 50) + "…" : m.replyTo;
      replyDiv.textContent = `↩️ En respuesta a: "${short}"`;
      container.appendChild(replyDiv);
    }

    if (m.text) {
      const textDiv = document.createElement("div");
      textDiv.className = "msg-text";
      textDiv.textContent = m.text;
      container.appendChild(textDiv);
    }

    if (opts.showMedia) {
      for (const med of m.media) {
        const mediaDiv = document.createElement("div");
        mediaDiv.className = "msg-media";
        const ico = med.startsWith("foto") ? "📷" : med === "video" ? "🎬" : med === "audio" ? "🎵" : "📎";
        mediaDiv.textContent = `[${ico} ${med}]`;
        container.appendChild(mediaDiv);
      }
    }

    lastSender = name;
  }
}

// ── Event listeners ──

document.addEventListener("DOMContentLoaded", () => {
  // Extract button
  $("#btn-extract").addEventListener("click", doExtract);

  // Stop button
  $("#btn-stop").addEventListener("click", doStop);

  // Copy text
  $("#btn-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(rawText).then(() => {
      showToast("✅ Texto copiado al portapapeles");
    });
  });

  // Download .txt
  $("#btn-download").addEventListener("click", () => {
    const name = $("#their-name").value.trim() || "chat";
    const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ig-${name}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("✅ Archivo descargado");
  });

  // Copy formatted (rich HTML for pasting into docs/notes)
  $("#btn-copy-html").addEventListener("click", () => {
    const opts = {
      myName: $("#my-name").value.trim() || "Yo",
      theirName: $("#their-name").value.trim() || "Ella",
      showTimestamps: $("#opt-timestamps").checked,
      showMedia: $("#opt-media").checked,
      showReplies: $("#opt-replies").checked,
    };

    const html = buildRichHTML(extractedData.messages, opts);
    const blob = new Blob([html], { type: "text/html" });

    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": blob,
        "text/plain": new Blob([rawText], { type: "text/plain" }),
      }),
    ]).then(() => {
      showToast("✅ Copiado con formato (pega en Word/Notes)");
    });
  });

  // Back to setup
  $("#btn-back").addEventListener("click", () => {
    showScreen("setup");
    setStatus("💡", "Listo para otra extracción", "idle");
  });

  // Toggle preview expansion
  $("#btn-toggle-preview").addEventListener("click", () => {
    const c = $("#preview-container");
    const btn = $("#btn-toggle-preview");
    c.classList.toggle("expanded");
    btn.textContent = c.classList.contains("expanded") ? "Contraer" : "Expandir";
  });
});

// ── Rich HTML for "copy pretty" ──

function buildRichHTML(messages, opts) {
  let html = `<div style="font-family:Segoe UI,sans-serif;font-size:14px;max-width:600px;">`;
  html += `<h2 style="color:#833ab4;">💬 ${opts.myName} ↔ ${opts.theirName}</h2>`;
  html += `<p style="color:#888;font-size:12px;">Exportado el ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</p><hr>`;

  let lastSender = null;

  for (const m of messages) {
    if (m.type === "time" && opts.showTimestamps) {
      html += `<p style="text-align:center;color:#999;font-size:12px;margin:12px 0;">── ${m.text} ──</p>`;
      lastSender = null;
      continue;
    }
    if (m.type !== "msg") continue;

    const name = m.sender === "me" ? opts.myName : m.sender === "them" ? opts.theirName : "???";
    const color = m.sender === "me" ? "#3b82f6" : "#a855f7";
    const isNew = name !== lastSender;

    if (isNew) {
      html += `<p style="margin:10px 0 2px;"><strong style="color:${color};">${m.sender === "me" ? "🔵" : "🟣"} ${name}</strong></p>`;
    }

    if (m.replyTo && opts.showReplies) {
      html += `<p style="margin:0 0 2px 16px;color:#888;font-size:12px;">↩️ <em>"${m.replyTo.slice(0, 50)}"</em></p>`;
    }

    if (m.text) {
      html += `<p style="margin:0 0 3px 16px;">${m.text}</p>`;
    }

    if (opts.showMedia) {
      for (const med of m.media) {
        html += `<p style="margin:0 0 3px 16px;color:#eab308;">[${med}]</p>`;
      }
    }

    lastSender = name;
  }

  html += `</div>`;
  return html;
}
