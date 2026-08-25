# CookieMaster

A small Manifest V3 Chrome extension for importing and exporting cookies in
either **Netscape format** (`cookies.txt`) or **JSON format**.

## Install (load unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the extension, then click its icon to open CookieMaster

## Import

1. Open the **Import** tab
2. Choose a file (or drag it onto the drop zone) or paste raw content into
   the text box — format (Netscape vs JSON) is auto-detected
3. Optionally toggle:
   - **Overwrite existing** — replaces any cookie already set for the same
     name/domain/path before writing the new one
   - **Skip expired** — skips cookies whose expiration timestamp is in the past
4. Click **Import Cookies**
5. Review the success/skipped/failed counts; expand **Details / errors** for
   a per-cookie breakdown

Supports the common `#HttpOnly_` line prefix in Netscape files, and JSON
exports from tools like Cookie-Editor, EditThisCookie, or
Puppeteer/Playwright's `context.cookies()`.

## Export

1. Open the **Export** tab
2. Choose scope:
   - **Current site** — cookies for the active tab's domain and its subdomains
   - **All cookies** — every cookie in the browser
3. Choose format: **JSON** or **Netscape (cookies.txt)**
4. Click **Generate Export** to preview the output
5. **Copy** to clipboard, or **Download File** to save it (`.json` or `.txt`)

## Notes

- Needs `cookies` + `<all_urls>` to read/write cookies for arbitrary domains,
  `activeTab` to know the current site for export, `downloads` to save export
  files, and `clipboardWrite` for the Copy button — all expected for a tool
  like this.
- A cookie import can fail if the domain/scheme combination isn't valid
  (e.g. `secure: true` cookies need an `https://` URL, derived automatically
  from the cookie's own `secure` flag).
- Everything runs locally in the popup — no external network calls.
