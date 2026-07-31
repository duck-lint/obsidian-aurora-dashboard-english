import { Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import type AuroraDashboardPlugin from "./main";
import type { InstalledPlugin } from "./models";

export class QuickPluginModal extends Modal {
  private installed: InstalledPlugin[] = [];

  constructor(
    app: App,
    private readonly dashboardPlugin: AuroraDashboardPlugin
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("aurora-quick-plugin-modal");
    this.installed = await this.dashboardPlugin.getInstalledPlugins();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv("aurora-modal-header");
    header.createEl("h2", { text: "Manage plugin shortcuts" });
    header.createEl("p", {
      text: "Reorder shortcuts or add and remove plugins installed in this vault."
    });

    const byId = new Map(this.installed.map((plugin) => [plugin.id, plugin]));
    const selectedIds = this.dashboardPlugin.data.settings.quickPluginIds;
    const selected = selectedIds
      .map((id) => byId.get(id))
      .filter((plugin): plugin is InstalledPlugin => plugin !== undefined);
    const selectedSet = new Set(selected.map((plugin) => plugin.id));
    const available = this.installed.filter(
      (plugin) => !selectedSet.has(plugin.id)
    );

    this.renderSection("Selected shortcuts", selected, true);
    this.renderSection("Available plugins", available, false);

    const actions = this.contentEl.createDiv("aurora-settings-actions");
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: "Done",
      attr: { type: "button" }
    });
    done.addEventListener("click", () => this.close());
  }

  private renderSection(
    heading: string,
    plugins: InstalledPlugin[],
    selected: boolean
  ): void {
    const section = this.contentEl.createDiv("aurora-plugin-manager-section");
    const title = section.createDiv("aurora-plugin-manager-heading");
    title.createEl("h3", { text: heading });
    title.createSpan({ text: String(plugins.length) });
    const list = section.createDiv("aurora-plugin-manager-list");

    if (plugins.length === 0) {
      list.createDiv({
        cls: "aurora-plugin-manager-empty",
        text: selected ? "No shortcuts selected" : "No more plugins available"
      });
      return;
    }

    plugins.forEach((plugin, index) => {
      const row = list.createDiv("aurora-plugin-manager-row");
      const mark = row.createSpan("aurora-plugin-manager-mark");
      mark.setText(pluginInitial(plugin.name));
      const copy = row.createSpan("aurora-plugin-manager-copy");
      copy.createSpan({
        cls: "aurora-plugin-manager-name",
        text: plugin.name
      });
      copy.createSpan({
        cls: "aurora-plugin-manager-description",
        text: plugin.description || plugin.id
      });
      const controls = row.createSpan("aurora-plugin-manager-controls");

      if (selected) {
        this.createRowButton(controls, "arrow-up", "Move up", index === 0, () =>
          this.move(plugin.id, -1)
        );
        this.createRowButton(
          controls,
          "arrow-down",
          "Move down",
          index === plugins.length - 1,
          () => this.move(plugin.id, 1)
        );
        this.createRowButton(controls, "x", "Remove", false, () =>
          this.remove(plugin.id)
        );
      } else {
        this.createRowButton(controls, "plus", "Add", false, () =>
          this.add(plugin.id)
        );
      }
    });
  }

  private createRowButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    disabled: boolean,
    action: () => void
  ): void {
    const button = parent.createEl("button", {
      cls: "aurora-plugin-manager-button",
      attr: {
        type: "button",
        "aria-label": label,
        title: label
      }
    });
    button.disabled = disabled;
    setIcon(button, icon);
    button.addEventListener("click", action);
  }

  private move(id: string, offset: number): void {
    const ids = [...this.dashboardPlugin.data.settings.quickPluginIds];
    const index = ids.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void this.save(ids);
  }

  private remove(id: string): void {
    void this.save(
      this.dashboardPlugin.data.settings.quickPluginIds.filter(
        (pluginId) => pluginId !== id
      )
    );
  }

  private add(id: string): void {
    const ids = this.dashboardPlugin.data.settings.quickPluginIds;
    if (ids.includes(id)) return;
    void this.save([...ids, id]);
  }

  private async save(ids: string[]): Promise<void> {
    this.dashboardPlugin.data.settings.quickPluginIds = ids;
    await this.dashboardPlugin.saveDashboardPreferences();
    this.render();
  }
}

export function pluginInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "P";
}
