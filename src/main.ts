import { Notice, Plugin, TFile } from "obsidian";
import {
  AuroraDashboardView,
  VIEW_TYPE_AURORA_DASHBOARD
} from "./dashboard-view";
import {
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  type AuroraPluginData,
  type StartupMode
} from "./models";
import { AuroraSettingTab } from "./settings";
import { StatsService } from "./stats-service";

export default class AuroraDashboardPlugin extends Plugin {
  data: AuroraPluginData = structuredClone(DEFAULT_DATA);
  stats!: StatsService;
  private saveTimer: number | null = null;
  private vaultEventsRegistered = false;

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.stats = new StatsService(this.app, this);

    this.registerView(
      VIEW_TYPE_AURORA_DASHBOARD,
      (leaf) => new AuroraDashboardView(leaf, this)
    );

    this.addRibbonIcon("layout-dashboard", "打开 Aurora Dashboard", () => {
      void this.openDashboard("new-tab");
    });

    this.addCommand({
      id: "open-dashboard",
      name: "打开首页看板",
      callback: () => void this.openDashboard("new-tab")
    });

    this.addCommand({
      id: "refresh-dashboard",
      name: "重新扫描首页统计",
      callback: () => {
        this.stats.invalidate();
        this.refreshDashboardViews(true);
        new Notice("Aurora Dashboard 正在重新扫描");
      }
    });

    this.addSettingTab(new AuroraSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      if (this.data.settings.openOnStartup) {
        window.setTimeout(() => {
          void this.openDashboard(this.data.settings.startupMode);
        }, 0);
      }
    });
  }

  onunload(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveData(this.data);
    }
  }

  async openDashboard(
    mode: StartupMode = this.data.settings.startupMode
  ): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_AURORA_DASHBOARD
    )[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf =
      mode === "new-tab"
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_AURORA_DASHBOARD,
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  requestDataSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.data);
    }, 500);
  }

  async saveSettings(): Promise<void> {
    this.stats.invalidate();
    await this.saveData(this.data);
    this.refreshDashboardViews(true);
  }

  refreshDashboardViews(force = false): void {
    if (force) this.stats.invalidate();
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_AURORA_DASHBOARD)
      .forEach((leaf) => {
        if (leaf.view instanceof AuroraDashboardView) {
          leaf.view.requestRefresh();
        }
      });
  }

  private async loadPluginData(): Promise<void> {
    const saved = (await this.loadData()) as Partial<AuroraPluginData> | null;
    this.data = {
      ...structuredClone(DEFAULT_DATA),
      ...saved,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(saved?.settings ?? {})
      },
      activity: saved?.activity ?? {},
      fileWordCounts: saved?.fileWordCounts ?? {},
      trackingStartedAt: saved?.trackingStartedAt ?? null
    };
  }

  private registerVaultEvents(): void {
    if (this.vaultEventsRegistered) return;
    this.vaultEventsRegistered = true;

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        void this.stats.recordFileChange(file).then(() => {
          this.refreshDashboardViews();
        });
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        void this.stats.recordFileChange(file, true).then(() => {
          this.refreshDashboardViews();
        });
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.stats.recordDelete(file);
        this.refreshDashboardViews();
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.stats.recordRename(file, oldPath);
        this.refreshDashboardViews();
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.refreshDashboardViews();
      })
    );
  }
}
