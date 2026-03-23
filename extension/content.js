// ── content.js — Runs inside Instagram page ──
// Handles scroll-based message extraction via message passing with popup

console.log("[IG Chat Extractor] Extension loaded on Instagram");

let extractionAborted = false;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.action === "extract") {
    extractionAborted = false;
    doExtraction(msg.options, sendResponse);
    return true; // keep channel open for async response
  }
  if (msg.action === "abort") {
    extractionAborted = true;
    sendResponse({ ok: true });
  }
  if (msg.action === "progress-poll") {
    // popup polls for progress
    sendResponse({ count: window.__igExtractCount || 0, status: window.__igExtractStatus || "" });
  }
});

// ── Find the scrollable chat container ──
function findChatContainer() {
  var section = document.querySelector('[role="main"] section');
  var searchRoot = section || document;

  // Find the div with the most children and width > 300
  var best = null;
  var bestCount = 0;
  searchRoot.querySelectorAll("div").forEach(function (d) {
    var r = d.getBoundingClientRect();
    if (d.children.length > bestCount && r.width > 300) {
      var txt = (d.innerText || "").length;
      if (txt > 50) {
        bestCount = d.children.length;
        best = d;
      }
    }
  });
  return bestCount > 5 ? best : null;
}

// ── Find the scrollable parent of the message container ──
function findScrollParent(el) {
  var parent = el;
  while (parent) {
    if (parent.scrollHeight > parent.clientHeight + 50) {
      return parent;
    }
    parent = parent.parentElement;
  }
  // Fallback: try to find any scrollable div near the container
  var section = document.querySelector('[role="main"] section');
  if (section) {
    var divs = section.querySelectorAll("div");
    for (var i = 0; i < divs.length; i++) {
      if (divs[i].scrollHeight > divs[i].clientHeight + 200) {
        return divs[i];
      }
    }
  }
  return null;
}

// ── Read currently visible messages from the container ──
function readVisibleMessages(container) {
  var containerRect = container.getBoundingClientRect();
  var midX = containerRect.left + containerRect.width / 2;
  var children = Array.from(container.children);
  var messages = [];

  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var childRect = child.getBoundingClientRect();

    // Skip elements not in viewport at all
    if (childRect.bottom < -200 || childRect.top > window.innerHeight + 200) continue;

    var text = (child.innerText || "").trim();
    if (!text) continue;

    var cleanText = text.replace(/\n/g, " ").trim();

    // ── Timestamp separator ──
    if (
      cleanText.length < 80 &&
      /^(\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)|hoy|ayer|today|yesterday|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s+de\s+\w+|\w+\s+\d{1,2},?\s*\d{0,4}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\s+\w+\s+\d{4})/i.test(cleanText)
    ) {
      messages.push({ type: "time", text: cleanText, _key: "t:" + cleanText });
      continue;
    }

    // ── Sender detection by position ──
    var spans = child.querySelectorAll("span, a");
    var leftMost = Infinity;
    var rightMost = 0;
    var foundAny = false;

    for (var j = 0; j < spans.length; j++) {
      var sr = spans[j].getBoundingClientRect();
      if (sr.width > 10 && sr.height > 5 && sr.width < containerRect.width * 0.85) {
        if (sr.left < leftMost) leftMost = sr.left;
        if (sr.right > rightMost) rightMost = sr.right;
        foundAny = true;
      }
    }

    if (!foundAny) {
      var divs = child.querySelectorAll("div");
      for (var j = 0; j < divs.length; j++) {
        var dr = divs[j].getBoundingClientRect();
        if (dr.width > 20 && dr.height > 10 && dr.width < containerRect.width * 0.85) {
          if (dr.left < leftMost) leftMost = dr.left;
          if (dr.right > rightMost) rightMost = dr.right;
          foundAny = true;
        }
      }
    }

    var sender = "unknown";
    if (foundAny) {
      if (rightMost > containerRect.right - 30) sender = "me";
      else if (leftMost < containerRect.left + 80 && rightMost < midX + 50) sender = "them";
      else {
        var bubbleCenter = (leftMost + rightMost) / 2;
        if (bubbleCenter > midX + containerRect.width * 0.05) sender = "me";
        else sender = "them";
      }
    }

    // ── Reply detection ──
    var replyTo = null;
    var replyPatterns = [
      /You replied to (.+?)(?:\n|$)/i,
      /Replied to (.+?)(?:\n|$)/i,
      /Respondiste a (.+?)(?:\n|$)/i,
      /En respuesta a (.+?)(?:\n|$)/i,
    ];
    for (var p = 0; p < replyPatterns.length; p++) {
      var match = text.match(replyPatterns[p]);
      if (match) {
        replyTo = match[1].trim();
        break;
      }
    }

    // ── Clean text ──
    var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var cleanLines = [];
    var skipNext = false;

    for (var k = 0; k < lines.length; k++) {
      var line = lines[k];
      if (/^(You replied to|Replied to|Respondiste a|En respuesta a)/i.test(line)) {
        skipNext = true;
        continue;
      }
      if (skipNext) { skipNext = false; continue; }
      if (/^(Liked a message|Le gustó un mensaje|Sent an attachment)/i.test(line)) continue;
      if (/^\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)$/i.test(line)) continue;
      cleanLines.push(line);
    }

    var msgText = cleanLines.join(" ").trim();
    msgText = msgText.replace(/\s*\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)\s*$/i, "").trim();

    var timeMatch = text.match(/(\d{1,2}:\d{2}\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))/i);

    // ── Media ──
    var media = [];
    if (child.querySelector("video")) media.push("video");
    if (child.querySelector("audio")) media.push("audio");
    var imgs = child.querySelectorAll("img");
    for (var m = 0; m < imgs.length; m++) {
      var img = imgs[m];
      var w = img.getBoundingClientRect().width;
      if (w < 40) continue;
      if ((img.src || "").includes("profile") || (img.src || "").includes("avatar")) continue;
      media.push("foto");
    }

    if (!msgText && media.length === 0) continue;

    // Unique key for deduplication
    var key = sender + ":" + (msgText || media.join(",")).slice(0, 80);

    messages.push({
      type: "msg",
      sender: sender,
      text: msgText || "",
      time: timeMatch ? timeMatch[1] : null,
      replyTo: replyTo,
      media: media,
      _key: key,
    });
  }

  return messages;
}

// ── Main extraction with scroll ──
async function doExtraction(options, sendResponse) {
  var mode = options.scrollMode || "auto-down"; // auto-down, auto-up, full
  var speed = options.speed || "normal";

  var delayMs = speed === "fast" ? 300 : speed === "slow" ? 800 : 500;

  var container = findChatContainer();
  if (!container) {
    sendResponse({ error: "No se encontró el chat. Abre una conversación de Instagram." });
    return;
  }

  var scroller = findScrollParent(container);
  if (!scroller) {
    sendResponse({ error: "No se encontró el contenedor scrolleable del chat." });
    return;
  }

  window.__igExtractStatus = "Preparando...";
  window.__igExtractCount = 0;

  // Collected messages with dedup
  var allMessages = [];
  var seenKeys = new Set();

  function addMessages(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (!seenKeys.has(msgs[i]._key)) {
        seenKeys.add(msgs[i]._key);
        allMessages.push(msgs[i]);
      }
    }
    window.__igExtractCount = allMessages.filter(function (m) { return m.type === "msg"; }).length;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  try {
    if (mode === "full") {
      // Scroll to the very top first
      window.__igExtractStatus = "Scrolleando al inicio...";
      scroller.scrollTop = 0;
      await sleep(1500);

      // Keep scrolling up until no more content loads
      var prevScrollTop = -1;
      var stuckCount = 0;
      while (scroller.scrollTop > 0 || stuckCount < 3) {
        scroller.scrollTop = 0;
        await sleep(800);
        if (scroller.scrollTop === prevScrollTop) {
          stuckCount++;
        } else {
          stuckCount = 0;
        }
        prevScrollTop = scroller.scrollTop;
        if (stuckCount >= 3) break;
        if (extractionAborted) break;
      }
      await sleep(500);
    }

    if (mode === "auto-up") {
      // Read current position, then scroll up
      var prevTop = scroller.scrollTop;
      var stuckCount = 0;
      var scrollStep = scroller.clientHeight * 0.7;

      while (!extractionAborted) {
        // Read visible messages
        var visible = readVisibleMessages(container);
        addMessages(visible);
        window.__igExtractStatus = "Leyendo hacia arriba...";

        // Scroll up
        scroller.scrollTop -= scrollStep;
        await sleep(delayMs);

        // Check if we're stuck (reached the top)
        if (Math.abs(scroller.scrollTop - prevTop) < 5) {
          stuckCount++;
          if (stuckCount >= 3) break;
        } else {
          stuckCount = 0;
        }
        prevTop = scroller.scrollTop;

        // Wait for Instagram to render new messages
        await sleep(delayMs);
      }

      // Final read
      var visible = readVisibleMessages(container);
      addMessages(visible);

      // Reverse order since we scrolled up (messages are collected bottom-to-top)
      allMessages.reverse();

    } else {
      // auto-down or full (after scrolling to top)
      var prevTop = scroller.scrollTop;
      var stuckCount = 0;
      var scrollStep = scroller.clientHeight * 0.7;

      while (!extractionAborted) {
        // Read visible messages
        var visible = readVisibleMessages(container);
        addMessages(visible);
        window.__igExtractStatus = "Leyendo... " + window.__igExtractCount + " mensajes";

        // Scroll down
        scroller.scrollTop += scrollStep;
        await sleep(delayMs);

        // Check if stuck (reached bottom)
        if (Math.abs(scroller.scrollTop - prevTop) < 5) {
          stuckCount++;
          if (stuckCount >= 3) break;
        } else {
          stuckCount = 0;
        }
        prevTop = scroller.scrollTop;

        await sleep(delayMs);
      }

      // Final read
      var visible = readVisibleMessages(container);
      addMessages(visible);
    }

    // Clean up _key from messages before sending
    var cleanMessages = allMessages.map(function (m) {
      var copy = Object.assign({}, m);
      delete copy._key;
      return copy;
    });

    window.__igExtractStatus = "Listo";

    sendResponse({
      messages: cleanMessages,
      count: cleanMessages.filter(function (m) { return m.type === "msg"; }).length,
    });
  } catch (err) {
    sendResponse({ error: "Error durante extracción: " + err.message });
  }
}
