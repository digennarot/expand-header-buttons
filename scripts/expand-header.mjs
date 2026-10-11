/**
 * Expand Header Buttons v2.0 — Foundry VTT v13 / v14
 *
 * Creates a vertical sidebar on the left side of sheets with buttons
 * normally hidden in the three-dot overflow menu.
 *
 * Features:
 *  - Reads header controls from the application itself (works with the v13
 *    dropdown, the v14 context menu and the dnd5e 6.x context menu)
 *  - Supports ApplicationV2 sheets (core, dnd5e 6.x) and legacy V1 document
 *    sheets (pf2e 8.x)
 *  - Disabled buttons stay in the three-dot menu instead of vanishing
 *  - Optional icon-only header buttons for V1 sheets
 *  - GM-only mode
 *  - Per-button toggle via settings
 */

const MODULE_ID = "expand-header-buttons";
const SIDEBAR_CLASS = "ehb-sidebar";
const HIDDEN_CLASS = "ehb-hidden";
const ICON_ONLY_CLASS = "ehb-icon-only";
const SKIP_ACTIONS = new Set(["close", "toggleControls"]);

/** Set while this module reads an app's full control list, so the menu filter stays out. */
const BYPASS = Symbol(`${MODULE_ID}.bypass`);
/** Keys of the controls an app's sidebar currently holds (undefined until first built). */
const SIDEBAR_KEYS = Symbol(`${MODULE_ID}.sidebarKeys`);
/** Set once an app was re-rendered after a failed sidebar build, so it cannot loop. */
const RETRIED = Symbol(`${MODULE_ID}.retried`);
/** Live entries of a sidebar element, read at click time. */
const ENTRIES = Symbol(`${MODULE_ID}.entries`);

/** Classes on V1 header buttons that are structural or toggle with state, so never part of a key. */
const V1_IGNORED_CLASSES = new Set([
  "header-button", "control", "disabled", "active", "inactive", "locked", "unlocked",
  "selected", "toggled", "open", "closed", "on", "off", "hidden", HIDDEN_CLASS,
]);

/** Classes v1.0 picked up from the dropdown icon element but which are not part of the icon. */
const LEGACY_ICON_NOISE = new Set(["control-icon", "fa-fw"]);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Controls seen this session, so the config menu can list them after sheets close. */
const seenControls = new Map();

let disabledKeys = new Set();
let disabledLegacy = new Set();

// ——————————————————————————————————————————
// Settings
// ——————————————————————————————————————————

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing v2.0`);

  game.settings.register(MODULE_ID, "gmOnly", {
    name: "GM Only",
    hint: "If enabled, the sidebar only appears for the GM. Players will see the default three-dot menu.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshOpenApps(),
  });

  game.settings.register(MODULE_ID, "iconOnlyHeader", {
    name: "Icon-only Header Buttons",
    hint: "Hide the text of header buttons that stay in the title bar of V1 sheets (e.g. Pathfinder 2e) and show it as a tooltip instead.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshOpenApps(),
  });

  game.settings.register(MODULE_ID, "disabledButtons", {
    name: "Disabled Buttons",
    hint: "Buttons that remain in the default menu.",
    scope: "world",
    config: false,
    type: String,
    default: "[]",
    onChange: (value) => {
      setDisabledKeys(value);
      refreshOpenApps();
    },
  });

  game.settings.register(MODULE_ID, "knownButtons", {
    name: "Known Buttons",
    hint: "Label and icon of disabled buttons, so the configuration can list them while no sheet is open.",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.registerMenu(MODULE_ID, "buttonConfig", {
    name: "Configure Buttons",
    label: "Choose which buttons to show",
    hint: "Toggle individually which buttons appear in the sidebar. Open a sheet first so its buttons are detected.",
    icon: "fa-solid fa-bars",
    type: EHBConfigApp,
    restricted: true,
  });
});

Hooks.once("setup", () => {
  setDisabledKeys(game.settings.get(MODULE_ID, "disabledButtons"));
});

/*
 * Core fires getHeaderControls{Class} for each class in the chain, ending with
 * ApplicationV2, whenever the control list is built (render, v14 context menu,
 * dnd5e context menu). Registering at ready runs this filter after the hooks
 * other modules registered during init/setup to add their own controls.
 */
Hooks.once("ready", () => {
  Hooks.on("getHeaderControlsApplicationV2", filterHeaderControls);
});

function setDisabledKeys(value) {
  try { disabledKeys = new Set(JSON.parse(value)); }
  catch (e) { disabledKeys = new Set(); }
  disabledLegacy = new Set([...disabledKeys].filter(isLegacyKey).map(normalizeIcon));
}

function getSetting(key) {
  try { return game.settings.get(MODULE_ID, key); }
  catch (e) { return undefined; }
}

function isActiveForUser() {
  if (!game.user) return false;
  return !(getSetting("gmOnly") && !game.user.isGM);
}

// ——————————————————————————————————————————
// Keys
// ——————————————————————————————————————————

/** Keys written by v2.0 start with "v1|" or "v2|"; anything else is an icon key from v1.0. */
function isLegacyKey(key) {
  return !/^v[12]\|/.test(key);
}

/** Compare icon keys from v1.0 (which included "control-icon fa-fw") with plain icon classes. */
function normalizeIcon(value) {
  return String(value ?? "").split(/\s+/).filter(c => c && !LEGACY_ICON_NOISE.has(c)).sort().join(" ");
}

/** A button is disabled if its key, or the icon-based key used by v1.0, was disabled. */
function isDisabled(info) {
  if (disabledKeys.has(info.key)) return true;
  return !!info.legacyKey && disabledLegacy.has(normalizeIcon(info.legacyKey));
}

/** The listed controls a stored key applies to (directly, or as a v1.0 icon key). */
function controlsForKey(key, controls) {
  if (!isLegacyKey(key)) return controls.filter(c => c.key === key);
  const icon = normalizeIcon(key);
  return controls.filter(c => c.legacyKey && normalizeIcon(c.legacyKey) === icon);
}

/** Readable label and icon for a stored key when no metadata was saved for it. */
function describeStoredKey(key) {
  if (isLegacyKey(key)) {
    const iconClass = key.split(/\s+/).filter(c => c && !LEGACY_ICON_NOISE.has(c)).join(" ");
    return { label: "Unknown button (no open sheet)", iconClass, action: "" };
  }
  const [kind, a = "", b = "", c = ""] = key.split("|");
  if (kind === "v2") {
    // v2|action  or  v2||icon|label
    if (a) return { label: localizeLabel(a), iconClass: "", action: a };
    return { label: localizeLabel(c) || "Unknown button", iconClass: b, action: "" };
  }
  // v1|class  or  v1||icon  or  v1|||label
  if (a) return { label: a, iconClass: "", action: "" };
  if (b) return { label: "Unknown button (no open sheet)", iconClass: b, action: "" };
  return { label: c || "Unknown button", iconClass: "", action: "" };
}

// ——————————————————————————————————————————
// Refresh
// ——————————————————————————————————————————

function openApps() {
  return new Set([
    ...(foundry.applications.instances?.values() ?? []),
    ...Object.values(ui.windows ?? {}),
  ]);
}

/**
 * Apply changed settings to every open window. ApplicationV2 windows are
 * re-rendered so a three-dot menu built at render time is rebuilt with the new
 * filter; the render hook then rebuilds the sidebar.
 */
function refreshOpenApps() {
  for (const app of openApps()) {
    if (!app?.rendered) continue;
    if (app instanceof ApplicationV2) {
      if (!isEligibleV2(app)) continue;
      delete app[SIDEBAR_KEYS];
      app.render();
    }
    else safeBuild(app);
  }
}

// ——————————————————————————————————————————
// ApplicationV2 — remove sidebar controls from the three-dot menu
// ——————————————————————————————————————————

function filterHeaderControls(app, controls) {
  if (app?.[BYPASS] || !Array.isArray(controls)) return;
  for (let i = controls.length - 1; i >= 0; i--) {
    if (isInSidebar(app, controls[i])) controls.splice(i, 1);
  }
}

/**
 * Whether a control is shown in the app's sidebar. Once a sidebar was built
 * this is exactly what it holds, so a failed or skipped build never hides a
 * control from the menu. Before the first build (the first frame render) it
 * predicts the result with the same rules collectControls uses.
 */
function isInSidebar(app, control) {
  const keys = app[SIDEBAR_KEYS];
  if (keys) return keys.has(describeV2Control(control).key);
  if (!isEligibleV2(app) || !isActiveForUser()) return false;
  if (SKIP_ACTIONS.has(control.action) || !getV2Handler(app, control)) return false;
  return !isDisabled(describeV2Control(control));
}

function isEligibleV2(app) {
  return app instanceof ApplicationV2 && app.hasFrame && !(app instanceof EHBConfigApp);
}

/**
 * Resolve what a left click on a header control should run, or null when the
 * action does not accept left clicks (dnd5e drops those from its menu as well).
 */
function getV2Handler(app, control) {
  if (typeof control.onClick === "function") return (event) => control.onClick.call(app, event);
  let handler = app.options.actions?.[control.action];
  if (handler && typeof handler === "object") {
    if (Array.isArray(handler.buttons) && !handler.buttons.includes(0)) return null;
    handler = handler.handler;
  }
  if (typeof handler === "function") return (event, target) => handler.call(app, event, target);
  return (event, target) => app._onClickAction?.(event, target);
}

/**
 * Keys never contain localized text, so they are the same for every client.
 * Controls with an action are keyed by the action alone, since their label and
 * icon may change with state; others by icon and raw label.
 */
function describeV2Control(control) {
  const action = control.action || "";
  const iconClass = control.icon || "";
  const rawLabel = control.label || "";
  return {
    key: action ? `v2|${action}` : `v2||${iconClass}|${rawLabel}`,
    legacyKey: iconClass || action || rawLabel,
    action,
    label: localizeLabel(rawLabel),
    iconClass,
  };
}

/** All visible header controls of an ApplicationV2, ignoring this module's filter. */
function getV2Controls(app) {
  app[BYPASS] = true;
  try {
    return Array.from(app._headerControlButtons?.() ?? []);
  } catch (err) {
    console.warn(`${MODULE_ID} |`, err);
    return [];
  } finally {
    delete app[BYPASS];
  }
}

/**
 * Stand-in for the header control element that core would pass as `target`.
 * It is detached (like the v14 context menu entry), so it never matches the
 * application's own delegated [data-action] listeners.
 */
function makeControlTarget(control) {
  const el = document.createElement("button");
  el.type = "button";
  el.classList.add("header-control");
  if (control.action) el.dataset.action = control.action;
  return el;
}

// ——————————————————————————————————————————
// V1 document sheets (pf2e 8.x and other legacy sheets)
// ——————————————————————————————————————————

/** Only V1 document sheets get a sidebar; dialogs, pickers and config windows are left alone. */
function isEligibleV1(app) {
  if (!app?.options?.popOut || app instanceof ApplicationV2) return false;
  const DocumentSheetV1 = foundry.appv1?.api?.DocumentSheet;
  if (DocumentSheetV1 && app instanceof DocumentSheetV1) return true;
  return app.document instanceof foundry.abstract.Document;
}

function getV1Header(app) {
  const appEl = app.element?.[0] ?? app.element;
  if (!(appEl instanceof HTMLElement)) return {};
  return { appEl, header: appEl.querySelector(":scope > .window-header") };
}

/** All header buttons of a V1 window, including Close. */
function getV1HeaderButtons(header) {
  return Array.from(header.querySelectorAll(".header-button"))
    .filter(el => !el.closest(`.${SIDEBAR_CLASS}`));
}

/**
 * Keys use the button's identifying class (pf2e: "configure-creature", core:
 * "configure-sheet"), never its localized text or toggling state. Without one,
 * the icon is used, and the text only as a last resort.
 */
function describeV1Button(el) {
  const iconClass = el.querySelector("i")?.className?.trim() || "";
  const label = getV1Label(el);
  const cls = Array.from(el.classList).filter(c => !V1_IGNORED_CLASSES.has(c)).sort().join(" ");
  let key;
  if (cls) key = `v1|${cls}`;
  else if (iconClass) key = `v1||${iconClass}`;
  else key = `v1|||${label}`;
  return { key, action: el.dataset.action || "", label, iconClass };
}

/** The button's current text. Icon-only mode only hides it visually, so it stays readable. */
function getV1Label(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("i, svg").forEach(i => i.remove());
  const text = clone.textContent.trim();
  if (text) return localizeLabel(text);
  // Fall back to a tooltip only if it is not the one this module added
  const tooltip = el.dataset.ehbTooltip ? "" : (el.dataset.tooltipText || el.dataset.tooltip);
  return localizeLabel(tooltip || el.title || "");
}

/** Hide the text of V1 header buttons (CSS) and show it as a plain-text tooltip. */
function applyIconOnly(appEl, header) {
  const enabled = !!getSetting("iconOnlyHeader");
  appEl.classList.toggle(ICON_ONLY_CLASS, enabled);
  for (const el of getV1HeaderButtons(header)) {
    // Undo what this module added before, so labels always reflect the current text
    if (el.dataset.ehbTooltip) {
      delete el.dataset.tooltipText;
      delete el.dataset.ehbTooltip;
    }
    if (el.dataset.ehbAria) {
      el.removeAttribute("aria-label");
      delete el.dataset.ehbAria;
    }
    if (!enabled) continue;

    const label = getV1Label(el);
    if (!label) continue;
    if (!el.dataset.tooltip && !el.dataset.tooltipText) {
      el.dataset.tooltipText = label;
      el.dataset.ehbTooltip = "1";
    }
    if (!el.hasAttribute("aria-label")) {
      el.setAttribute("aria-label", label);
      el.dataset.ehbAria = "1";
    }
  }
}

// ——————————————————————————————————————————
// Collect controls (shared by the sidebar, the menu filter and the config window)
// ——————————————————————————————————————————

/**
 * Every header control of an application that could be moved to the sidebar,
 * with what clicking it runs. Controls that can never be moved (Close, the
 * three-dot toggle, actions that do not take left clicks) are counted in
 * `fixedCount` instead. Returns null for applications this module ignores.
 */
function collectControls(app) {
  if (app instanceof ApplicationV2) {
    if (!isEligibleV2(app) || !app.window?.header) return null;
    const controls = [];
    let fixedCount = 0;
    for (const control of getV2Controls(app)) {
      if (SKIP_ACTIONS.has(control.action)) continue;
      const run = getV2Handler(app, control);
      if (!run) {
        fixedCount++;
        continue;
      }
      controls.push({ ...describeV2Control(control), run, target: () => makeControlTarget(control) });
    }
    return { controls, fixedCount };
  }

  if (!isEligibleV1(app)) return null;
  const { header } = getV1Header(app);
  if (!header) return null;
  const controls = [];
  for (const el of getV1HeaderButtons(header)) {
    if (el.classList.contains("close")) continue;
    controls.push({ ...describeV1Button(el), sourceEl: el, run: () => el.click() });
  }
  return { controls, fixedCount: 0 };
}

function remember(info) {
  const { key, legacyKey, action, label, iconClass } = info;
  seenControls.set(key, { key, legacyKey, action, label, iconClass });
}

// ——————————————————————————————————————————
// Render Hooks
// ——————————————————————————————————————————

Hooks.on("renderApplicationV2", (app) => safeBuild(app));
Hooks.on("renderApplication", (app) => safeBuild(app));

function safeBuild(app) {
  try {
    if (app instanceof ApplicationV2) buildSidebarV2(app);
    else buildSidebarV1(app);
  } catch (err) {
    console.warn(`${MODULE_ID} |`, err);
    if (!(app instanceof ApplicationV2) || !isEligibleV2(app)) return;
    // Nothing is in the sidebar, so nothing may be missing from the menu either
    app.element?.querySelectorAll(`:scope > .${SIDEBAR_CLASS}`).forEach(s => s.remove());
    app[SIDEBAR_KEYS] = new Set();
    if (!app[RETRIED]) {
      app[RETRIED] = true;
      app.render();
    }
  }
}

// ——————————————————————————————————————————
// Build Sidebar — ApplicationV2 (core, dnd5e 6.x)
// ——————————————————————————————————————————

function buildSidebarV2(app) {
  if (!isEligibleV2(app)) return;
  const appEl = app.element;
  if (!appEl) return;

  const collected = isActiveForUser() ? collectControls(app) : null;
  const entries = [];
  let menuCount = collected?.fixedCount ?? 0;
  for (const info of collected?.controls ?? []) {
    remember(info);
    if (isDisabled(info)) menuCount++;
    else entries.push(info);
  }

  app[SIDEBAR_KEYS] = new Set(entries.map(e => e.key));
  syncV13Dropdown(app, entries);

  // Hide the three-dot toggle when every control lives in the sidebar
  if (app.window?.controls) {
    app.window.controls.style.display = (entries.length && !menuCount) ? "none" : "";
  }

  const sidebar = mountSidebar(appEl, entries);
  if (!sidebar) return;

  // dnd5e sheets with left-side tabs (e.g. the compendium browser): sit beside them
  const leftTabs = appEl.querySelector(":scope nav.tabs.tabs-left");
  sidebar.style.marginRight = leftTabs?.offsetWidth ? `${leftTabs.offsetWidth + 4}px` : "";
}

/**
 * v13 renders its dropdown at render time, before this module's render hook
 * has built the sidebar. Hide the items that ended up in the sidebar, and show
 * any that did not.
 */
function syncV13Dropdown(app, entries) {
  const dropdown = app.window?.controlsDropdown;
  if (!dropdown) return;
  const actions = new Set(entries.map(e => e.action).filter(Boolean));
  const icons = new Set(entries.filter(e => !e.action).map(e => normalizeIcon(e.iconClass)).filter(Boolean));
  for (const item of dropdown.querySelectorAll(":scope > li, :scope > button, :scope > a")) {
    const action = item.dataset.action || item.querySelector("[data-action]")?.dataset.action || "";
    const icon = normalizeIcon(item.querySelector("i")?.className);
    const moved = action ? actions.has(action) : (!!icon && icons.has(icon));
    item.classList.toggle(HIDDEN_CLASS, moved);
  }
}

// ——————————————————————————————————————————
// Build Sidebar — V1 document sheets
// ——————————————————————————————————————————

function buildSidebarV1(app) {
  if (!isEligibleV1(app)) return;
  const { appEl, header } = getV1Header(app);
  if (!header) return;

  applyIconOnly(appEl, header);

  const entries = [];
  if (isActiveForUser()) {
    for (const info of collectControls(app)?.controls ?? []) {
      remember(info);
      if (!isDisabled(info)) entries.push(info);
    }
  }

  const moved = new Set(entries.map(e => e.sourceEl));
  for (const el of getV1HeaderButtons(header)) el.classList.toggle(HIDDEN_CLASS, moved.has(el));

  mountSidebar(appEl, entries);
}

// ——————————————————————————————————————————
// Sidebar element
// ——————————————————————————————————————————

/**
 * Put the sidebar for `entries` on the window, reusing the existing one when
 * the same buttons are shown so re-renders (HP changes, item drags) neither
 * rebuild nor replay the slide-in animation. Returns the sidebar, or null.
 */
function mountSidebar(appEl, entries) {
  const existing = appEl.querySelector(`:scope > .${SIDEBAR_CLASS}`);
  if (!entries.length) {
    existing?.remove();
    return null;
  }

  const signature = entries.map(e => [e.key, e.label, e.iconClass].join("\u0000")).join("\u0001");
  if (existing?.dataset.signature === signature) {
    existing[ENTRIES] = entries;
    existing.querySelectorAll(":scope > .ehb-sidebar-btn").forEach((btn, i) => syncDisabled(btn, entries[i]));
    return existing;
  }

  const sidebar = createSidebar(entries);
  sidebar.dataset.signature = signature;
  // Only animate the first appearance, not a rebuild of a visible sidebar
  if (!existing) sidebar.classList.add("ehb-enter");
  existing?.remove();
  appEl.appendChild(sidebar);
  return sidebar;
}

function createSidebar(entries) {
  const sidebar = document.createElement("div");
  sidebar.classList.add(SIDEBAR_CLASS);
  sidebar[ENTRIES] = entries;

  entries.forEach((entry, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("ehb-sidebar-btn");
    // Not data-action: the app's own delegated listeners must not see these buttons
    if (entry.action) btn.dataset.ehbAction = entry.action;
    // Plain text: data-tooltip would be localized and rendered as HTML
    btn.dataset.tooltipText = entry.label;
    btn.dataset.tooltipDirection = "LEFT";
    btn.setAttribute("aria-label", entry.label);

    const icon = document.createElement("i");
    icon.className = entry.iconClass || "fa-solid fa-circle";
    icon.inert = true;
    btn.appendChild(icon);
    syncDisabled(btn, entry);

    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Read the entry at click time: re-renders swap in fresh handlers
      const current = sidebar[ENTRIES]?.[index] ?? entry;
      try {
        await current.run(event, current.target?.() ?? btn);
      } catch (err) {
        console.error(`${MODULE_ID} | "${current.label}" failed:`, err);
      }
    });
    // Keep right clicks from reaching the app's context menus and listeners
    btn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    sidebar.appendChild(btn);
  });
  return sidebar;
}

/** pf2e marks unavailable header buttons with a.disabled / [disabled]. */
function syncDisabled(btn, entry) {
  const src = entry?.sourceEl;
  btn.disabled = !!(src?.classList.contains("disabled") || src?.hasAttribute("disabled"));
}

function localizeLabel(label) {
  if (!label) return "";
  try { return game.i18n.localize(label); }
  catch (e) { return label; }
}

// ——————————————————————————————————————————
// Discover all buttons for config
// ——————————————————————————————————————————

function discoverAllButtons() {
  for (const app of openApps()) {
    if (!app?.rendered) continue;
    for (const info of collectControls(app)?.controls ?? []) remember(info);
  }

  // Keep previously disabled buttons listed even when no sheet shows them right now
  const seen = [...seenControls.values()];
  const known = getSetting("knownButtons") ?? {};
  const placeholders = [];
  for (const key of disabledKeys) {
    if (controlsForKey(key, seen).length) continue;
    placeholders.push({ key, missing: true, ...describeStoredKey(key), ...(known[key] ?? {}) });
  }

  const controls = [...seen, ...placeholders];
  console.log(`${MODULE_ID} | Config: found ${controls.length} buttons`);
  return controls;
}

// ——————————————————————————————————————————
// Config App
// ——————————————————————————————————————————

class EHBConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ehb-config",
    tag: "form",
    window: {
      title: "Expand Header Buttons — Configure",
      icon: "fa-solid fa-bars",
      contentClasses: ["standard-form"],
    },
    position: { width: 480, height: "auto" },
    form: {
      handler: EHBConfigApp.#onSubmit,
      closeOnSubmit: true,
    },
    actions: {
      toggleAll: EHBConfigApp.#onToggleAll,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/config.html`, scrollable: [".ehb-config-list"] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  async _prepareContext(options) {
    this._controls = discoverAllButtons();
    return {
      // Field names are positional, so no two keys can collide
      controls: this._controls.map((b, i) => ({
        ...b,
        enabled: !isDisabled(b),
        field: `btn-${i}`,
      })),
      buttons: [{ type: "submit", icon: "fa-solid fa-save", label: "Save" }],
    };
  }

  static #onToggleAll(event, target) {
    const checked = target.dataset.state === "on";
    for (const input of this.element.querySelectorAll(".ehb-config-list input[type=checkbox]")) {
      input.checked = checked;
    }
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const controls = this._controls ?? [];
    const isChecked = (c) => !!data[`btn-${controls.indexOf(c)}`];
    const disabled = new Set();
    const known = {};

    // Placeholder rows ("not open") are decided by their own checkbox below.
    // Other stored keys of buttons that are not listed stay as they are. A v1.0
    // icon key may cover buttons on sheets that are not open, so it is only
    // dropped when the user enabled one of the listed buttons it applies to.
    const live = controls.filter(c => !c.missing);
    const placeholderKeys = new Set(controls.filter(c => c.missing).map(c => c.key));
    for (const key of disabledKeys) {
      if (placeholderKeys.has(key)) continue;
      const matches = controlsForKey(key, live);
      if (!matches.length) disabled.add(key);
      else if (isLegacyKey(key) && !matches.some(isChecked)) disabled.add(key);
    }

    for (const c of controls) {
      if (isChecked(c)) continue;
      disabled.add(c.key);
      if (!c.missing) known[c.key] = { label: c.label, iconClass: c.iconClass, action: c.action };
    }

    const previous = getSetting("knownButtons") ?? {};
    for (const key of disabled) known[key] ??= previous[key];
    await game.settings.set(MODULE_ID, "knownButtons", JSON.parse(JSON.stringify(known)));
    await game.settings.set(MODULE_ID, "disabledButtons", JSON.stringify([...disabled]));
    ui.notifications.info("Expand Header Buttons: Settings saved.");
  }
}
