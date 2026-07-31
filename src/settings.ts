import {
  Modal,
  PluginSettingTab,
  Setting,
  normalizePath
} from "obsidian";
import type { App, SettingDefinitionItem } from "obsidian";
import type AuroraDashboardPlugin from "./main";
import type { StartupMode } from "./models";
import { normalizeTodoFilePath } from "./core";

type AuroraSettingKey =
  | "displayName"
  | "openOnStartup"
  | "startupMode"
  | "todoFilePath"
  | "shortNoteWordThreshold"
  | "excludedFolders"
  | "showEstimatedHistory"
  | "activityHistoryDays";

export class AuroraSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly auroraPlugin: AuroraDashboardPlugin
  ) {
    super(app, auroraPlugin);
  }

  display(): void {
    renderSettings(this.containerEl, this.auroraPlugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<AuroraSettingKey>[] {
    return [
      {
        name: "Greeting name",
        desc: "Optional. Leave blank to show only the time-based greeting.",
        control: {
          type: "text",
          key: "displayName",
          defaultValue: "",
          placeholder: "For example, Sean"
        }
      },
      {
        name: "Open dashboard on startup",
        desc: "Show Dashboard automatically when the Obsidian workspace is ready.",
        control: {
          type: "toggle",
          key: "openOnStartup",
          defaultValue: true
        }
      },
      {
        name: "Startup mode",
        desc: "Replacing the active tab feels more like a home page; a new tab keeps your last note open.",
        control: {
          type: "dropdown",
          key: "startupMode",
          defaultValue: "replace-active",
          options: {
            "replace-active": "Replace active tab",
            "new-tab": "Open in new tab"
          }
        }
      },
      {
        name: "Todo file path",
        desc: "Leave blank to hide Todo items. Enter a vault-relative Markdown path to read open tasks from that file.",
        control: {
          type: "text",
          key: "todoFilePath",
          defaultValue: "",
          placeholder: "For example, Todo.md or Work/Todo.md"
        }
      },
      {
        name: "Empty or very short threshold",
        desc: "Notes with this many words or fewer are counted as empty or very short.",
        control: {
          type: "slider",
          key: "shortNoteWordThreshold",
          defaultValue: 10,
          min: 0,
          max: 100,
          step: 5
        }
      },
      {
        name: "Excluded folders",
        desc: "One vault-relative path per line; subfolders are excluded too.",
        control: {
          type: "textarea",
          key: "excludedFolders",
          defaultValue: "",
          placeholder: "Templates\nArchive/Attachments",
          rows: 4
        }
      },
      {
        name: "Show estimated history",
        desc: "Daily activity before installation cannot be recovered exactly; when enabled, it is estimated from current word counts and modification dates.",
        control: {
          type: "toggle",
          key: "showEstimatedHistory",
          defaultValue: true
        }
      },
      {
        name: "Activity calendar range",
        desc: "Choose how many days appear in the dashboard heatmap.",
        control: {
          type: "dropdown",
          key: "activityHistoryDays",
          defaultValue: "365",
          options: {
            "90": "Last 90 days",
            "180": "Last 180 days",
            "365": "Last 365 days"
          }
        }
      }
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.auroraPlugin.data.settings;

    switch (key as AuroraSettingKey) {
      case "displayName":
        return settings.displayName;
      case "openOnStartup":
        return settings.openOnStartup;
      case "startupMode":
        return settings.startupMode;
      case "todoFilePath":
        return settings.todoFilePath;
      case "shortNoteWordThreshold":
        return settings.shortNoteWordThreshold;
      case "excludedFolders":
        return settings.excludedFolders.join("\n");
      case "showEstimatedHistory":
        return settings.showEstimatedHistory;
      case "activityHistoryDays":
        return String(settings.activityHistoryDays);
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.auroraPlugin.data.settings;

    switch (key as AuroraSettingKey) {
      case "displayName":
        if (typeof value === "string") settings.displayName = value.trim();
        break;
      case "openOnStartup":
        if (typeof value === "boolean") settings.openOnStartup = value;
        break;
      case "startupMode":
        if (value === "replace-active" || value === "new-tab") {
          settings.startupMode = value;
        }
        break;
      case "todoFilePath":
        if (typeof value === "string") {
          settings.todoFilePath = normalizeTodoFilePath(value);
        }
        break;
      case "shortNoteWordThreshold":
        if (typeof value === "number" && Number.isFinite(value)) {
          settings.shortNoteWordThreshold = Math.min(100, Math.max(0, value));
        }
        break;
      case "excludedFolders":
        if (typeof value === "string") {
          settings.excludedFolders = parseExcludedFolders(value);
        }
        break;
      case "showEstimatedHistory":
        if (typeof value === "boolean") settings.showEstimatedHistory = value;
        break;
      case "activityHistoryDays": {
        const days = Number(value);
        if (days === 90 || days === 180 || days === 365) {
          settings.activityHistoryDays = days;
        }
        break;
      }
      default:
        return;
    }

    await this.auroraPlugin.saveSettings();
  }
}

export class AuroraSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly auroraPlugin: AuroraDashboardPlugin
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("aurora-settings-modal");
    renderSettings(this.contentEl, this.auroraPlugin, () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function renderSettings(
  container: HTMLElement,
  plugin: AuroraDashboardPlugin,
  close?: () => void
): void {
  container.empty();
  container.createEl("h2", { text: "Dashboard settings" });
  container.createEl("p", {
    cls: "setting-item-description aurora-settings-intro",
    text: "All statistics and activity records stay in the current vault and are never sent over the network."
  });

  new Setting(container)
    .setName("Greeting name")
    .setDesc("Optional. Leave blank to show only the time-based greeting.")
    .addText((text) =>
      text
        .setPlaceholder("For example, Sean")
        .setValue(plugin.data.settings.displayName)
        .onChange(async (value) => {
          plugin.data.settings.displayName = value.trim();
          await plugin.saveSettings();
        })
    );

  new Setting(container)
    .setName("Open dashboard on startup")
    .setDesc("Show Dashboard automatically when the Obsidian workspace is ready.")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.data.settings.openOnStartup)
        .onChange(async (value) => {
          plugin.data.settings.openOnStartup = value;
          await plugin.saveSettings();
        })
    );

  new Setting(container)
    .setName("Startup mode")
    .setDesc("Replacing the active tab feels more like a home page; a new tab keeps your last note open.")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("replace-active", "Replace active tab")
        .addOption("new-tab", "Open in new tab")
        .setValue(plugin.data.settings.startupMode)
        .onChange(async (value) => {
          plugin.data.settings.startupMode = value as StartupMode;
          await plugin.saveSettings();
        })
    );

  new Setting(container)
    .setName("Todo file path")
    .setDesc(
      "Leave blank to hide Todo items. Enter a vault-relative Markdown path to read open tasks from that file."
    )
    .addText((text) =>
      text
        .setPlaceholder("For example, Todo.md or Work/Todo.md")
        .setValue(plugin.data.settings.todoFilePath)
        .onChange(async (value) => {
          plugin.data.settings.todoFilePath = normalizeTodoFilePath(value);
          await plugin.saveSettings();
        })
    );

  new Setting(container)
    .setName("Empty or very short threshold")
    .setDesc("Notes with this many words or fewer are counted as empty or very short.")
    .addSlider((slider) =>
      slider
        .setLimits(0, 100, 5)
        .setValue(plugin.data.settings.shortNoteWordThreshold)
        .onChange(async (value) => {
          plugin.data.settings.shortNoteWordThreshold = value;
          await plugin.saveSettings();
        })
    );

  new Setting(container)
    .setName("Excluded folders")
    .setDesc("One vault-relative path per line; subfolders are excluded too.")
    .addTextArea((text) => {
      text
        .setPlaceholder("Templates\nArchive/Attachments")
        .setValue(plugin.data.settings.excludedFolders.join("\n"))
        .onChange(async (value) => {
          plugin.data.settings.excludedFolders = parseExcludedFolders(value);
          await plugin.saveSettings();
        });
      text.inputEl.rows = 4;
    });

  new Setting(container)
    .setName("Show estimated history")
    .setDesc(
      "Daily activity before installation cannot be recovered exactly; when enabled, it is estimated from current word counts and modification dates."
    )
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.data.settings.showEstimatedHistory)
        .onChange(async (value) => {
          plugin.data.settings.showEstimatedHistory = value;
          await plugin.saveSettings();
        })
    );

  new Setting(container)
    .setName("Activity calendar range")
    .setDesc("Choose how many days appear in the dashboard heatmap.")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("90", "Last 90 days")
        .addOption("180", "Last 180 days")
        .addOption("365", "Last 365 days")
        .setValue(String(plugin.data.settings.activityHistoryDays))
        .onChange(async (value) => {
          plugin.data.settings.activityHistoryDays = Number(value);
          await plugin.saveSettings();
        })
    );

  if (close) {
    const actions = container.createDiv("aurora-settings-actions");
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: "Done",
      attr: { type: "button" }
    });
    done.addEventListener("click", close);
  }
}

function parseExcludedFolders(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((path) => normalizePath(path.trim()))
    .filter(Boolean);
}
