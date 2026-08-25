/* CookieMaster
 * Parses Netscape cookies.txt or JSON cookie exports and writes them
 * into the browser via chrome.cookies.set().
 */

const dropZone = document.getElementById("dropZone");
const dropLabel = document.getElementById("dropLabel");
const fileInput = document.getElementById("fileInput");
const pasteArea = document.getElementById("pasteArea");
const importBtn = document.getElementById("importBtn");
const overwriteExisting = document.getElementById("overwriteExisting");
const skipExpired = document.getElementById("skipExpired");

const progressSection = document.getElementById("progressSection");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");

const summarySection = document.getElementById("summarySection");
const successCountEl = document.getElementById("successCount");
const skipCountEl = document.getElementById("skipCount");
const failCountEl = document.getElementById("failCount");

const logDetails = document.getElementById("logDetails");
const logList = document.getElementById("logList");

let rawContent = "";

// ---------- Tab switching ----------

const tabBtns = document.querySelectorAll(".tab-btn");
const importPanel = document.getElementById("importPanel");
const exportPanel = document.getElementById("exportPanel");

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    importPanel.hidden = tab !== "import";
    exportPanel.hidden = tab !== "export";
    if (tab === "export") initExportPanel();
  });
});

// ---------- Input handling ----------

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    rawContent = reader.result;
    pasteArea.value = rawContent;
    dropLabel.textContent = `Loaded: ${file.name}`;
    refreshButtonState();
  };
  reader.readAsText(file);
});

dropZone.addEventListener("click", () => fileInput.click());

["dragover", "dragenter"].forEach(evt =>
  dropZone.addEventListener(evt, e => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  })
);

["dragleave", "dragend", "drop"].forEach(evt =>
  dropZone.addEventListener(evt, e => {
    dropZone.classList.remove("dragover");
  })
);

dropZone.addEventListener("drop", e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    rawContent = reader.result;
    pasteArea.value = rawContent;
    dropLabel.textContent = `Loaded: ${file.name}`;
    refreshButtonState();
  };
  reader.readAsText(file);
});

pasteArea.addEventListener("input", () => {
  rawContent = pasteArea.value;
  refreshButtonState();
});

function refreshButtonState() {
  importBtn.disabled = rawContent.trim().length === 0;
}

// ---------- Parsing ----------

function detectFormat(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "netscape";
}

function parseNetscape(text) {
  const cookies = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#")) {
      continue; // plain comment
    }

    const parts = line.split("\t");
    if (parts.length < 7) continue;

    const [domain, includeSubdomainsRaw, path, secureRaw, expirationRaw, name, ...valueParts] = parts;
    // value may itself contain tabs in rare malformed exports; rejoin defensively
    const value = valueParts.join("\t");

    cookies.push({
      domain,
      includeSubdomains: includeSubdomainsRaw.toUpperCase() === "TRUE",
      path: path || "/",
      secure: secureRaw.toUpperCase() === "TRUE",
      expirationDate: Number(expirationRaw) || undefined,
      name,
      value,
      httpOnly,
      sameSite: undefined
    });
  }

  return cookies;
}

function normalizeSameSite(value) {
  if (!value) return undefined;
  const v = String(value).toLowerCase();
  if (v === "no_restriction" || v === "none") return "no_restriction";
  if (v === "lax") return "lax";
  if (v === "strict") return "strict";
  return undefined;
}

function parseJson(text) {
  let data = JSON.parse(text);
  if (!Array.isArray(data)) {
    // Some exports wrap the array, e.g. { cookies: [...] }
    if (Array.isArray(data.cookies)) data = data.cookies;
    else throw new Error("JSON is not an array of cookies");
  }

  return data.map(c => {
    const domain = c.domain || c.Domain || "";
    const expiration =
      c.expirationDate ?? c.expiry ?? c.expires ?? c.expirationTime ?? undefined;

    return {
      domain,
      includeSubdomains: c.hostOnly === undefined ? domain.startsWith(".") : !c.hostOnly,
      path: c.path || "/",
      secure: !!c.secure,
      expirationDate: typeof expiration === "number" ? expiration : undefined,
      name: c.name,
      value: c.value ?? "",
      httpOnly: !!c.httpOnly,
      sameSite: normalizeSameSite(c.sameSite)
    };
  });
}

function parseCookies(text) {
  const format = detectFormat(text);
  return format === "json" ? parseJson(text) : parseNetscape(text);
}

// ---------- Import ----------

function buildCookieDetails(parsed) {
  const domain = parsed.domain.trim();
  const bareDomain = domain.replace(/^\./, "");
  const scheme = parsed.secure ? "https://" : "http://";
  const url = `${scheme}${bareDomain}${parsed.path}`;

  const details = {
    url,
    name: parsed.name,
    value: parsed.value,
    path: parsed.path,
    secure: parsed.secure,
    httpOnly: parsed.httpOnly
  };

  // Only set an explicit domain for host-spanning cookies; otherwise let
  // Chrome derive a host-only cookie from the URL.
  if (parsed.includeSubdomains) {
    details.domain = domain.startsWith(".") ? domain : `.${domain}`;
  }

  if (parsed.expirationDate) {
    details.expirationDate = parsed.expirationDate;
  }

  if (parsed.sameSite) {
    details.sameSite = parsed.sameSite;
  }

  return details;
}

function setCookie(details) {
  return new Promise(resolve => {
    chrome.cookies.set(details, cookie => {
      const err = chrome.runtime.lastError;
      if (err || !cookie) {
        resolve({ ok: false, error: err ? err.message : "Unknown error (rejected by browser)" });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

async function removeExistingCookie(details) {
  await new Promise(resolve => {
    chrome.cookies.remove({ url: details.url, name: details.name }, () => resolve());
  });
}

function logLine(text, cls) {
  const li = document.createElement("li");
  li.textContent = text;
  if (cls) li.style.color = `var(--${cls})`;
  logList.appendChild(li);
}

async function runImport() {
  let parsed;
  try {
    parsed = parseCookies(rawContent);
  } catch (e) {
    alert(`Could not parse input: ${e.message}`);
    return;
  }

  if (parsed.length === 0) {
    alert("No cookies found in the provided input.");
    return;
  }

  importBtn.disabled = true;
  progressSection.hidden = false;
  summarySection.hidden = true;
  logList.innerHTML = "";
  logDetails.hidden = false;

  const nowSeconds = Date.now() / 1000;
  let success = 0, skipped = 0, failed = 0;

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    progressFill.style.width = `${Math.round(((i + 1) / parsed.length) * 100)}%`;
    progressText.textContent = `Processing ${i + 1} / ${parsed.length}: ${item.name}`;

    if (!item.name || !item.domain) {
      skipped++;
      logLine(`Skipped (missing name/domain): ${JSON.stringify(item)}`, "warn");
      continue;
    }

    if (skipExpired.checked && item.expirationDate && item.expirationDate < nowSeconds) {
      skipped++;
      logLine(`Skipped (expired): ${item.name} @ ${item.domain}`, "warn");
      continue;
    }

    const details = buildCookieDetails(item);

    if (overwriteExisting.checked) {
      await removeExistingCookie(details);
    }

    const result = await setCookie(details);
    if (result.ok) {
      success++;
    } else {
      failed++;
      logLine(`Failed: ${item.name} @ ${item.domain} — ${result.error}`, "err");
    }
  }

  progressText.textContent = "Done.";
  successCountEl.textContent = success;
  skipCountEl.textContent = skipped;
  failCountEl.textContent = failed;
  summarySection.hidden = false;
  importBtn.disabled = false;

  if (failed === 0 && skipped === 0) {
    logDetails.hidden = true;
  }
}

importBtn.addEventListener("click", runImport);

// ---------- Export ----------

const currentDomainEl = document.getElementById("currentDomain");
const exportBtn = document.getElementById("exportBtn");
const exportPreview = document.getElementById("exportPreview");
const exportActions = document.getElementById("exportActions");
const exportCount = document.getElementById("exportCount");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

let currentTabDomain = "";
let exportPanelInitialized = false;

function initExportPanel() {
  if (exportPanelInitialized) return;
  exportPanelInitialized = true;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;
    try {
      currentTabDomain = new URL(tab.url).hostname;
      currentDomainEl.textContent = currentTabDomain;
    } catch (e) {
      currentDomainEl.textContent = "unavailable";
    }
  });
}

function getSelectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function cookiesToJson(cookies) {
  const mapped = cookies.map(c => ({
    domain: c.domain,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    hostOnly: c.hostOnly,
    session: c.session,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate,
    storeId: c.storeId
  }));
  return JSON.stringify(mapped, null, 2);
}

function cookiesToNetscape(cookies) {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by CookieMaster",
    ""
  ];

  for (const c of cookies) {
    const includeSubdomains = !c.hostOnly;
    const expiration = c.session ? 0 : Math.round(c.expirationDate || 0);
    const prefix = c.httpOnly ? "#HttpOnly_" : "";
    lines.push([
      `${prefix}${c.domain}`,
      includeSubdomains ? "TRUE" : "FALSE",
      c.path,
      c.secure ? "TRUE" : "FALSE",
      expiration,
      c.name,
      c.value
    ].join("\t"));
  }

  return lines.join("\n");
}

function fetchCookiesForExport() {
  const scope = getSelectedRadio("exportScope");
  return new Promise(resolve => {
    if (scope === "all") {
      chrome.cookies.getAll({}, resolve);
    } else {
      chrome.cookies.getAll({ domain: currentTabDomain }, resolve);
    }
  });
}

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = "Generating...";

  const cookies = await fetchCookiesForExport();
  const format = getSelectedRadio("exportFormat");
  const output = format === "json" ? cookiesToJson(cookies) : cookiesToNetscape(cookies);

  exportPreview.value = output;
  exportCount.textContent = `${cookies.length} cookie${cookies.length === 1 ? "" : "s"} exported`;
  exportActions.hidden = cookies.length === 0;

  exportBtn.disabled = false;
  exportBtn.textContent = "Generate Export";
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportPreview.value);
    const original = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = original), 1200);
  } catch (e) {
    alert("Could not copy to clipboard: " + e.message);
  }
});

downloadBtn.addEventListener("click", () => {
  const format = getSelectedRadio("exportFormat");
  const scope = getSelectedRadio("exportScope");
  const isJson = format === "json";
  const namePart = scope === "all" ? "all-cookies" : (currentTabDomain || "site-cookies");
  const filename = `${namePart}.${isJson ? "json" : "txt"}`;
  const mime = isJson ? "application/json" : "text/plain";

  const blob = new Blob([exportPreview.value], { type: mime });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    URL.revokeObjectURL(url);
  });
});
