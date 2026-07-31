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
    header.createEl("h2", { text: "管理快捷插件" });
    header.createEl("p", {
      text: "调整顶部快捷入口的顺序，或从当前仓库已安装的插件中增删。"
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

    this.renderSection("快捷入口", selected, true);
    this.renderSection("可添加插件", available, false);

    const actions = this.contentEl.createDiv("aurora-settings-actions");
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: "完成",
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
        text: selected ? "还没有快捷入口" : "没有更多可添加的插件"
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
        this.createRowButton(controls, "arrow-up", "上移", index === 0, () =>
          this.move(plugin.id, -1)
        );
        this.createRowButton(
          controls,
          "arrow-down",
          "下移",
          index === plugins.length - 1,
          () => this.move(plugin.id, 1)
        );
        this.createRowButton(controls, "x", "移除", false, () =>
          this.remove(plugin.id)
        );
      } else {
        this.createRowButton(controls, "plus", "添加", false, () =>
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
