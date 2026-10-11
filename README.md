[README.md](https://github.com/user-attachments/files/26493249/README.md)
# Expand Header Buttons

![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v13%20%7C%20v14-informational)
![Version](https://img.shields.io/badge/version-2.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

A Foundry VTT v13/v14 module that creates a vertical sidebar on the left side of sheets, exposing buttons normally hidden in the three-dot overflow menu as always-visible, clickable icons.

![Preview]
expanded buttons on the side / settings / choosing which buttons appear next to
<img width="1180" height="463" alt="preview" src="https://github.com/user-attachments/assets/16d41f44-9786-4414-a106-a8b1775600a2" />

## Features

- **Vertical sidebar** — All header controls displayed as icons on the left side of every sheet
- **Per-button toggle** — Choose which buttons go to the sidebar and which stay in the three-dot menu
- **GM-only mode** — Optionally restrict the sidebar to the Game Master only
- **Icon-only header** — Optionally strip the text from V1 title-bar buttons, keeping just the icons
- **Minimize-aware** — Sidebar hides automatically when a sheet is minimized
- **Full module support** — Works with buttons added by other modules (Theatre Inserts, etc.)
- **No duplicates** — Reads header controls straight from the application, so each button appears once
- **V1 & V2 sheets** — Works with ApplicationV2 sheets (core, D&D 5e) and legacy V1 sheets (Pathfinder 2e header buttons)
- **Lightweight** — No dependencies, no libraries, pure vanilla JS + CSS

## Installation

### Foundry Module Browser
1. Open Foundry VTT and go to **Add-on Modules**
2. Click **Install Module**
3. Search for **"Expand Header Buttons"**
4. Click **Install**

### Manifest URL
1. Open Foundry VTT and go to **Add-on Modules**
2. Click **Install Module**
3. Paste this URL in the **Manifest URL** field at the bottom:
```
https://github.com/digennarot/expand-header-buttons/releases/latest/download/module.json
```
4. Click **Install**

## Configuration

After activating the module, go to **Settings → Module Settings → Expand Header Buttons**:

- **GM Only** — If enabled, only the GM sees the sidebar. Players see the default three-dot menu.
- **Icon-only Header Buttons** — On V1 sheets (e.g. Pathfinder 2e), hides the text of header buttons that stay in the title bar and shows it as a tooltip instead.
- **Configure Buttons** — Opens a window where you can toggle each button individually. Checked buttons appear in the sidebar; unchecked buttons remain in the three-dot menu.

> **Note:** Open a sheet first so its buttons show up in the configuration window. Buttons you have disabled stay listed even when no sheet is open. Changes apply to open sheets immediately.

## Compatibility

| | Version |
|---|---|
| **Foundry VTT** | v13 – v14 (verified against build 14.368) |
| **Systems** | System-agnostic. Supported: D&D 5e 6.x (ApplicationV2 sheets, requires Foundry 14.367+), Pathfinder 2e 8.6.x (V1 sheets) |
| **Modules** | Compatible with modules that add header controls (Theatre Inserts, etc.) |

## Support

Found a bug or have a suggestion? Open an issue on [GitHub](https://github.com/digennarot/expand-header-buttons/issues).

## License

This module is released under the [MIT License](LICENSE).
