import { ItemView, Notice, TFile, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import ForceGraph3D from "3d-force-graph";
import type {
  ForceGraph3DInstance,
  LinkObject,
  NodeObject
} from "3d-force-graph";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  PointsMaterial
} from "three";
import {
  activityLevel,
  formatCompactNumber,
  localDateKey,
  normalizeTodoFilePath
} from "./core";
import { DetailModal, type DetailItem } from "./detail-modal";
import type AuroraDashboardPlugin from "./main";
import type {
  DailyActivity,
  DashboardSnapshot,
  InstalledPlugin,
  KnowledgeGraphSnapshot,
  OpenTask,
  NoteMetric
} from "./models";
import { QuickPluginModal, pluginInitial } from "./quick-plugin-modal";
import { AuroraSettingsModal } from "./settings";

export const VIEW_TYPE_AURORA_DASHBOARD = "aurora-dashboard-view";

export class AuroraDashboardView extends ItemView {
  private refreshTimer: number | null = null;
  private renderDisposers: Array<() => void> = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AuroraDashboardPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_AURORA_DASHBOARD;
  }

  getDisplayText(): string {
    return "Dashboard";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("aurora-dashboard-view-content");
    this.renderLoading();
    await this.refresh(true);
  }

  onClose(): Promise<void> {
    this.clearRenderResources();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    return Promise.resolve();
  }

  requestRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 900);
  }

  async refresh(force = false): Promise<void> {
    try {
      const [snapshot, installedPlugins] = await Promise.all([
        this.plugin.stats.scan(force),
        this.plugin.getInstalledPlugins()
      ]);
      await this.plugin.initializeQuickPlugins(installedPlugins);
      this.render(snapshot, installedPlugins);
    } catch (error) {
      this.renderError(error);
    }
  }

  private renderLoading(): void {
    this.contentEl.empty();
    const root = this.contentEl.createDiv(
      "aurora-dashboard aurora-dashboard-loading"
    );
    const mark = root.createDiv("aurora-loading-mark");
    setIcon(mark, "loader-circle");
    root.createEl("h2", { text: "Scanning your vault" });
    root.createEl("p", { text: "The first scan may take a few seconds." });
  }

  private renderError(error: unknown): void {
    this.clearRenderResources();
    this.contentEl.empty();
    const root = this.contentEl.createDiv(
      "aurora-dashboard aurora-dashboard-error"
    );
    const mark = root.createDiv("aurora-error-mark");
    setIcon(mark, "circle-alert");
    root.createEl("h2", { text: "Unable to generate the dashboard" });
    root.createEl("p", {
      text: error instanceof Error ? error.message : "An unknown error occurred"
    });
    const retry = root.createEl("button", {
      cls: "mod-cta",
      text: "Retry scan",
      attr: { type: "button" }
    });
    retry.addEventListener("click", () => void this.refresh(true));
  }

  private render(
    snapshot: DashboardSnapshot,
    installedPlugins: InstalledPlugin[]
  ): void {
    this.clearRenderResources();
    this.contentEl.empty();
    const root = this.contentEl.createDiv("aurora-dashboard");

    this.renderHeader(root, snapshot);
    this.renderQuickPlugins(root, installedPlugins);
    this.renderMetrics(root, snapshot);

    const focusGrid = root.createDiv("aurora-dashboard-grid aurora-focus-grid");
    const todoCount = snapshot.taskNotes.reduce(
      (sum, note) => sum + note.tasks.length,
      0
    );
    const todoSurface = this.createSurface(
      focusGrid,
      "Todo",
      this.plugin.data.settings.todoFilePath
        ? `${todoCount} open tasks`
        : "No file configured"
    );
    todoSurface.addClass("aurora-todo-surface");
    this.renderTodoList(todoSurface, snapshot);

    const graphSurface = this.createSurface(
      focusGrid,
      "Knowledge graph",
      `${snapshot.graph.nodes.length} nodes · ${snapshot.graph.edges.length} connections`
    );
    graphSurface.addClass("aurora-graph-surface");
    this.renderGalaxyGraph(graphSurface, snapshot.graph);

    const activitySurface = this.createSurface(
      focusGrid,
      "Writing activity",
      this.activitySubtitle()
    );
    activitySurface.addClass("aurora-activity-surface");
    this.renderHeatmap(activitySurface, snapshot);

    const issuesSurface = this.createSurface(
      root,
      "Needs attention",
      "Click to view notes"
    );
    issuesSurface.addClass("aurora-issues-surface");
    this.renderIssues(issuesSurface, snapshot);

    const lowerGrid = root.createDiv("aurora-dashboard-grid aurora-lower-grid");
    const trendSurface = this.createSurface(
      lowerGrid,
      "Words added per day",
      "Last 30 days"
    );
    trendSurface.addClass("aurora-trend-surface");
    this.renderTrendChart(trendSurface, snapshot.trend);

    const recentSurface = this.createSurface(
      lowerGrid,
      "Recent notes",
      `${snapshot.modifiedToday} modified today`
    );
    recentSurface.addClass("aurora-recent-surface");
    this.renderRecentNotes(recentSurface, snapshot);

    const structureSurface = this.createSurface(
      root,
      "Vault structure",
      "Markdown notes by top-level folder"
    );
    structureSurface.addClass("aurora-structure-surface");
    this.renderStructure(structureSurface, snapshot);

    const footer = root.createDiv("aurora-dashboard-footer");
    const scope = footer.createSpan({
      text: `Scope: ${snapshot.noteCount} Markdown notes`
    });
    scope.setAttr("aria-label", "Statistics scope");
    footer.createSpan({
      text: this.plugin.data.settings.showEstimatedHistory
        ? "Writing activity includes estimated pre-installation data"
        : "Only precise activity since installation is shown"
    });
  }

  private renderQuickPlugins(
    root: HTMLElement,
    installedPlugins: InstalledPlugin[]
  ): void {
    const section = root.createDiv("aurora-quick-plugins");
    const label = section.createSpan("aurora-quick-plugins-label");
    label.createSpan({ text: "Plugin shortcuts" });
    const scroller = section.createDiv("aurora-quick-plugins-scroll");
    this.listen(scroller, "wheel", (event) => {
      if (
        scroller.scrollWidth > scroller.clientWidth &&
        Math.abs(event.deltaY) > Math.abs(event.deltaX)
      ) {
        scroller.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    });
    const byId = new Map(
      installedPlugins.map((plugin) => [plugin.id, plugin])
    );
    const selected = this.plugin.data.settings.quickPluginIds
      .map((id) => byId.get(id))
      .filter((plugin): plugin is InstalledPlugin => plugin !== undefined);

    if (selected.length === 0) {
      scroller.createSpan({
        cls: "aurora-quick-plugins-empty",
        text: "Add a plugin shortcut"
      });
    } else {
      selected.forEach((plugin) => {
        const link = scroller.createEl("a", {
          cls: "aurora-plugin-shortcut",
          href: `obsidian://show-plugin?id=${encodeURIComponent(plugin.id)}`,
          attr: {
            "aria-label": `Open ${plugin.name}`,
            title: plugin.description || plugin.name
          }
        });
        link.createSpan({
          cls: "aurora-plugin-shortcut-mark",
          text: pluginInitial(plugin.name)
        });
        link.createSpan({
          cls: "aurora-plugin-shortcut-name",
          text: plugin.name
        });
      });
    }

    const manage = this.createIconButton(section, "sliders-horizontal", "Manage plugin shortcuts");
    manage.addClass("aurora-quick-plugins-manage");
    this.listen(manage, "click", () => {
      new QuickPluginModal(this.app, this.plugin).open();
    });
  }

  private renderHeader(
    root: HTMLElement,
    snapshot: DashboardSnapshot
  ): void {
    const header = root.createDiv("aurora-dashboard-header");
    const copy = header.createDiv("aurora-dashboard-heading");
    const displayName = this.plugin.data.settings.displayName;
    copy.createEl("h1", {
      text: `${greeting()}${displayName ? `，${displayName}` : ""}`
    });
    copy.createEl("p", {
      text: `${this.app.vault.getName()} · ${snapshot.noteCount} notes · ${formatUpdatedTime(snapshot.generatedAt)}`
    });

    const actions = header.createDiv("aurora-dashboard-actions");
    const refresh = this.createIconButton(actions, "refresh-cw", "Refresh scan");
    this.listen(refresh, "click", () => {
      refresh.addClass("is-spinning");
      void this.refresh(true).finally(() => refresh.removeClass("is-spinning"));
    });
    const settings = this.createIconButton(actions, "settings", "Open settings");
    this.listen(settings, "click", () => {
      new AuroraSettingsModal(this.app, this.plugin).open();
    });
  }

  private renderMetrics(root: HTMLElement, snapshot: DashboardSnapshot): void {
    const metrics = root.createDiv("aurora-metrics");
    this.createMetricCard(
      metrics,
      "files",
      formatCompactNumber(snapshot.noteCount),
      "Notes",
      "accent-blue",
      () =>
        this.openDetails(
          "All notes",
          "Sorted by most recently modified",
          [...snapshot.notes]
            .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime)
            .map((note) => noteDetail(note, `${note.words} words`))
        )
    );
    this.createMetricCard(
      metrics,
      "type",
      formatCompactNumber(snapshot.totalWords),
      "Total words",
      "accent-green",
      () =>
        this.openDetails(
          "Word count details",
          "Readable CJK characters and non-CJK word groups",
          [...snapshot.notes]
            .sort((a, b) => b.words - a.words)
            .map((note) => noteDetail(note, `${note.words} words`))
        )
    );
    this.createMetricCard(
      metrics,
      "link",
      formatCompactNumber(snapshot.unlinkedNotes.length),
      "Unlinked notes",
      "accent-yellow",
      () =>
        this.openDetails(
          "Notes without backlinks",
          "These notes are not referenced by other notes",
          snapshot.unlinkedNotes.map((note) =>
            noteDetail(note, `${note.outgoingLinks} outgoing links`)
          )
        )
    );
    this.createMetricCard(
      metrics,
      "file-warning",
      formatCompactNumber(snapshot.shortNotes.length),
      "Empty or very short",
      "accent-purple",
      () =>
        this.openDetails(
          "Empty or very short notes",
          `Current threshold: ${this.plugin.data.settings.shortNoteWordThreshold} words or fewer`,
          snapshot.shortNotes.map((note) =>
            noteDetail(note, `${note.words} words`)
          )
        )
    );
  }

  private renderTodoList(
    surface: HTMLElement,
    snapshot: DashboardSnapshot
  ): void {
    const list = surface.createDiv("aurora-todo-list");
    const configuredPath = normalizeTodoFilePath(
      this.plugin.data.settings.todoFilePath
    );
    const todos = snapshot.taskNotes.flatMap((note) =>
      note.tasks.map((task) => ({ file: note.file, task }))
    );

    if (!configuredPath) {
      this.renderTodoEmpty(
        list,
        "file-cog",
        "Todo file is not configured",
        "Enter a vault-relative Markdown file path in settings."
      );
      return;
    }

    if (todos.length === 0) {
      const configuredFile = this.app.vault.getAbstractFileByPath(configuredPath);
      this.renderTodoEmpty(
        list,
        configuredFile instanceof TFile ? "circle-check-big" : "file-warning",
        configuredFile instanceof TFile
          ? "This file has no open tasks"
          : "Configured Todo file not found",
        configuredFile instanceof TFile ? configuredPath : `Check the path: ${configuredPath}`
      );
      return;
    }

    todos.slice(0, 7).forEach(({ file, task }) => {
      const row = list.createDiv("aurora-todo-row");
      const complete = row.createEl("button", {
        cls: "aurora-todo-check",
        attr: {
          type: "button",
          "aria-label": `Complete task: ${task.text}`,
          title: "Mark as complete"
        }
      });
      setIcon(complete, "circle");
      this.listen(complete, "click", () => {
        void this.saveTodoUpdate(file, task, { completed: true }, complete);
      });

      const copy = row.createDiv("aurora-todo-copy");
      const input = copy.createEl("input", {
        cls: "aurora-todo-input",
        value: task.text,
        attr: {
          type: "text",
          "aria-label": `Edit task: ${task.text}`
        }
      });
      copy.createSpan({
        cls: "aurora-todo-path",
        text: `${file.basename} · Line ${task.line + 1}`
      });
      const commit = (): void => {
        const value = input.value.trim();
        if (!value || value === task.text) {
          input.value = task.text;
          return;
        }
        void this.saveTodoUpdate(file, task, { text: value }, input);
      };
      this.listen(input, "blur", commit);
      this.listen(input, "keydown", (event) => {
        if (event.key === "Enter") input.blur();
        if (event.key === "Escape") {
          input.value = task.text;
          input.blur();
        }
      });

      const open = this.createIconButton(row, "external-link", "Open task note");
      open.addClass("aurora-todo-open");
      this.listen(open, "click", () => {
        void this.app.workspace.getLeaf(false).openFile(file);
      });
    });

    if (todos.length > 7) {
      const more = list.createEl("button", {
        cls: "aurora-todo-more",
        text: `View ${todos.length - 7} more`,
        attr: { type: "button" }
      });
      this.listen(more, "click", () => {
        this.openDetails(
          "Open tasks",
          "Click a task to open its note",
          todos.map(({ file, task }) => ({
            file,
            title: task.text,
            subtitle: file.path,
            badge: `Line ${task.line + 1}`
          }))
        );
      });
    }
  }

  private renderTodoEmpty(
    list: HTMLElement,
    iconName: string,
    title: string,
    description: string
  ): void {
    const empty = list.createDiv("aurora-todo-empty");
    const icon = empty.createSpan();
    setIcon(icon, iconName);
    empty.createSpan({ cls: "aurora-todo-empty-title", text: title });
    empty.createSpan({ cls: "aurora-todo-empty-description", text: description });
    const configure = empty.createEl("button", {
      text: "Configure Todo file",
      attr: { type: "button" }
    });
    this.listen(configure, "click", () => {
      new AuroraSettingsModal(this.app, this.plugin).open();
    });
  }

  private async saveTodoUpdate(
    file: TFile,
    task: OpenTask,
    update: { completed?: boolean; text?: string },
    control: HTMLElement
  ): Promise<void> {
    control.addClass("is-saving");
    if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) {
      control.disabled = true;
    }
    try {
      await this.plugin.updateTask(file, task, update);
      await this.refresh(true);
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Task update failed. Refresh and try again."
      );
      control.removeClass("is-saving");
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLButtonElement
      ) {
        control.disabled = false;
      }
    }
  }

  private renderGalaxyGraph(
    surface: HTMLElement,
    snapshot: KnowledgeGraphSnapshot
  ): void {
    const body = surface.createDiv("aurora-galaxy-graph");
    if (snapshot.nodes.length === 0) {
      body.createDiv({ cls: "aurora-empty-state", text: "No connections to display" });
      return;
    }

    const nodes: GalaxyNode[] = snapshot.nodes.map((node) => ({
      id: node.file.path,
      file: node.file,
      degree: node.degree,
      color: galaxyColor(node.file.path),
      val: Math.max(1.1, Math.log2(node.degree + 2))
    }));
    const links: GalaxyLink[] = snapshot.edges.map((edge) => ({
      source: edge.source,
      target: edge.target
    }));
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    try {
      const graph = new ForceGraph3D(body, {
        controlType: "orbit",
        rendererConfig: {
          alpha: true,
          antialias: true,
          powerPreference: "high-performance"
        }
      }) as unknown as ForceGraph3DInstance<GalaxyNode, GalaxyLink>;
      const focusGraph = (duration: number): void => {
        graph.zoomToFit(0, 12);
        const camera = graph.cameraPosition();
        graph.cameraPosition(
          {
            x: camera.x * 0.25,
            y: camera.y * 0.25,
            z: camera.z * 0.25
          },
          { x: 0, y: 0, z: 0 },
          duration
        );
      };
      graph
        .warmupTicks(70)
        .cooldownTicks(150)
        .graphData({ nodes, links })
        .backgroundColor("rgba(5, 6, 18, 0.98)")
        .showNavInfo(false)
        .nodeId("id")
        .nodeLabel((node) =>
          `${escapeHtml(node.file.basename)}<br><span>${node.degree} connections</span>`
        )
        .nodeColor((node) => node.color)
        .nodeVal((node) => node.val)
        .nodeRelSize(3.2)
        .nodeOpacity(0.92)
        .nodeResolution(10)
        .linkColor(() => "#a996ff")
        .linkOpacity(0.46)
        .linkWidth(0.72)
        .linkDirectionalParticles(reduceMotion ? 0 : 1)
        .linkDirectionalParticleColor(() => "#ff4f9a")
        .linkDirectionalParticleWidth(1.15)
        .linkDirectionalParticleSpeed(0.0036)
        .onNodeClick((node) => {
          void this.app.workspace.getLeaf(false).openFile(node.file);
        })
        .onEngineStop(() => focusGraph(650));

      const stars = createGalaxyStars(900);
      graph.scene().add(stars);
      graph.cameraPosition({ z: 560 });

      const resize = (): void => {
        graph
          .width(Math.max(300, body.clientWidth))
          .height(Math.max(340, body.clientHeight));
      };
      const observer = new ResizeObserver(resize);
      observer.observe(body);
      resize();
      const focusTimer = window.setTimeout(() => {
        focusGraph(800);
      }, 900);

      let animationFrame = 0;
      const animateStars = (): void => {
        stars.rotation.y += 0.00045;
        stars.rotation.x += 0.00008;
        animationFrame = window.requestAnimationFrame(animateStars);
      };
      if (!reduceMotion) animateStars();

      this.renderDisposers.push(() => {
        observer.disconnect();
        window.clearTimeout(focusTimer);
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        graph.scene().remove(stars);
        stars.geometry.dispose();
        stars.material.dispose();
        graph._destructor();
      });
    } catch (error) {
      body.empty();
      body.createDiv({
        cls: "aurora-empty-state",
        text:
          error instanceof Error
            ? `The 3D graph failed to load: ${error.message}`
            : "The 3D graph failed to load"
      });
    }
  }

  private renderHeatmap(
    surface: HTMLElement,
    snapshot: DashboardSnapshot
  ): void {
    const values = snapshot.activity
      .map((day) => day.addedWords)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    const max =
      values[Math.max(0, Math.floor(values.length * 0.9) - 1)] ??
      values.at(-1) ??
      1;
    const today = localDateKey(new Date());
    const grid = surface.createDiv("aurora-heatmap-grid");
    grid.dataset.range = String(
      this.plugin.data.settings.activityHistoryDays
    );
    snapshot.activity.forEach((day) => {
      const cell = grid.createEl("button", {
        cls: "aurora-heatmap-cell",
        attr: {
          type: "button",
          "aria-label": activityAriaLabel(day)
        }
      });
      cell.dataset.level = String(activityLevel(day.addedWords, max));
      if (day.estimated) cell.addClass("is-estimated");
      if (day.date === today) cell.addClass("is-today");
      this.listen(cell, "click", () => this.openActivityDay(day));
    });

    const legend = surface.createDiv("aurora-heatmap-legend");
    legend.createSpan({ text: "Less" });
    for (let level = 1; level <= 5; level += 1) {
      const swatch = legend.createSpan("aurora-heatmap-swatch");
      swatch.dataset.level = String(level);
    }
    legend.createSpan({ text: "More" });
  }

  private renderIssues(
    surface: HTMLElement,
    snapshot: DashboardSnapshot
  ): void {
    const list = surface.createDiv("aurora-issue-list");
    this.createIssueRow(
      list,
      "square-check-big",
      "Open tasks from Todo file",
      snapshot.taskNotes.reduce((sum, note) => sum + note.tasks.length, 0),
      () => {
        if (!this.plugin.data.settings.todoFilePath) {
          new AuroraSettingsModal(this.app, this.plugin).open();
          return;
        }
        const items = snapshot.taskNotes.flatMap((note) =>
          note.tasks.map((task) => ({
            file: note.file,
            title: task.text,
            subtitle: note.file.path,
            badge: `Line ${task.line + 1}`
          }))
        );
        this.openDetails(
          "Open tasks",
          `Source: ${this.plugin.data.settings.todoFilePath}`,
          items
        );
      }
    );
    this.createIssueRow(
      list,
      "unlink",
      "Notes without backlinks",
      snapshot.unlinkedNotes.length,
      () =>
        this.openDetails(
          "Notes without backlinks",
          "These notes are not referenced by other notes",
          snapshot.unlinkedNotes.map((note) =>
            noteDetail(note, `${note.outgoingLinks} outgoing links`)
          )
        )
    );
    this.createIssueRow(
      list,
      "file-warning",
      "Empty or very short notes",
      snapshot.shortNotes.length,
      () =>
        this.openDetails(
          "Empty or very short notes",
          `Current threshold: ${this.plugin.data.settings.shortNoteWordThreshold} words or fewer`,
          snapshot.shortNotes.map((note) =>
            noteDetail(note, `${note.words} words`)
          )
        )
    );
  }

  private renderTrendChart(
    surface: HTMLElement,
    trend: DailyActivity[]
  ): void {
    const chartWrap = surface.createDiv("aurora-chart-wrap");
    const canvas = chartWrap.createEl("canvas", {
      cls: "aurora-trend-chart",
      attr: { role: "img", "aria-label": "Words added per day over the last 30 days" }
    });
    const tooltip = chartWrap.createDiv("aurora-chart-tooltip");
    tooltip.hide();
    const draw = (): ChartGeometry =>
      drawTrendChart(canvas, trend, surface);
    let geometry = draw();
    const observer = new ResizeObserver(() => {
      geometry = draw();
    });
    observer.observe(chartWrap);
    this.renderDisposers.push(() => observer.disconnect());

    this.listen(canvas, "mousemove", (event) => {
      if (trend.length === 0 || geometry.points.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const index = nearestPointIndex(geometry.points, x);
      const point = geometry.points[index];
      const day = trend[index];
      if (!point || !day) return;
      tooltip.empty();
      tooltip.createSpan({
        cls: "aurora-chart-tooltip-date",
        text: formatDateLabel(day.date)
      });
      tooltip.createSpan({
        text: `${new Intl.NumberFormat("en-CA").format(day.addedWords)} words`
      });
      tooltip.setCssProps({
        "--aurora-tooltip-left": `${Math.min(rect.width - 120, Math.max(8, point.x - 42))}px`,
        "--aurora-tooltip-top": `${Math.max(8, point.y - 54)}px`
      });
      tooltip.show();
    });
    this.listen(canvas, "mouseleave", () => tooltip.hide());
    this.listen(canvas, "click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const index = nearestPointIndex(
        geometry.points,
        event.clientX - rect.left
      );
      const day = trend[index];
      if (day) this.openActivityDay(day);
    });

    const chartFooter = surface.createDiv("aurora-chart-footer");
    const latest = trend.at(-1);
    chartFooter.createSpan({
      text: latest
        ? `${new Intl.NumberFormat("en-CA").format(latest.addedWords)} words today`
        : "No activity yet"
    });
    if (trend.some((day) => day.estimated)) {
      chartFooter.createSpan({
        cls: "aurora-estimate-label",
        text: "Includes estimated history"
      });
    }
  }

  private renderRecentNotes(
    surface: HTMLElement,
    snapshot: DashboardSnapshot
  ): void {
    const list = surface.createDiv("aurora-recent-list");
    if (snapshot.recentNotes.length === 0) {
      list.createDiv({ cls: "aurora-empty-state", text: "No notes yet" });
      return;
    }
    snapshot.recentNotes.slice(0, 5).forEach((note) => {
      const row = list.createEl("button", {
        cls: "aurora-recent-row",
        attr: { type: "button" }
      });
      const icon = row.createSpan("aurora-recent-icon");
      setIcon(icon, "file-text");
      const copy = row.createSpan("aurora-recent-copy");
      copy.createSpan({
        cls: "aurora-recent-title",
        text: note.file.basename
      });
      copy.createSpan({
        cls: "aurora-recent-path",
        text: note.file.parent?.path ?? "/"
      });
      row.createSpan({
        cls: "aurora-recent-time",
        text: relativeTime(note.file.stat.mtime)
      });
      const arrow = row.createSpan("aurora-row-arrow");
      setIcon(arrow, "chevron-right");
      this.listen(row, "click", () => {
        void this.app.workspace.getLeaf(false).openFile(note.file);
      });
    });
  }

  private renderStructure(
    surface: HTMLElement,
    snapshot: DashboardSnapshot
  ): void {
    const list = surface.createDiv("aurora-structure-list");
    const maxCount = snapshot.folders[0]?.noteCount ?? 1;
    snapshot.folders.slice(0, 8).forEach((folder, index) => {
      const row = list.createEl("button", {
        cls: "aurora-structure-row",
        attr: { type: "button" }
      });
      const icon = row.createSpan("aurora-structure-icon");
      setIcon(icon, "folder");
      const copy = row.createSpan("aurora-structure-copy");
      const heading = copy.createSpan("aurora-structure-heading");
      heading.createSpan({
        cls: "aurora-structure-name",
        text: folder.name
      });
      heading.createSpan({
        cls: "aurora-structure-count",
        text: `${folder.noteCount} notes`
      });
      const bar = copy.createSpan("aurora-structure-bar");
      const fill = bar.createSpan("aurora-structure-bar-fill");
      fill.dataset.color = String((index % 5) + 1);
      fill.setCssProps({
        "--aurora-structure-fill-width": `${Math.max(3, (folder.noteCount / maxCount) * 100)}%`
      });
      row.createSpan({
        cls: "aurora-structure-words",
        text: `${formatCompactNumber(folder.wordCount)} words`
      });
      const arrow = row.createSpan("aurora-row-arrow");
      setIcon(arrow, "chevron-right");
      this.listen(row, "click", () => {
        const metricsByPath = new Map(
          snapshot.notes.map((note) => [note.file.path, note])
        );
        this.openDetails(
          folder.name,
          `${folder.noteCount} notes · ${formatCompactNumber(folder.wordCount)} words`,
          folder.files.map((file) => {
            const metric = metricsByPath.get(file.path);
            return {
              file,
              subtitle: file.path,
              badge: metric ? `${metric.words} words` : undefined
            };
          })
        );
      });
    });
  }

  private createSurface(
    parent: HTMLElement,
    title: string,
    subtitle: string
  ): HTMLElement {
    const surface = parent.createDiv("aurora-surface");
    const header = surface.createDiv("aurora-surface-header");
    header.createEl("h2", { text: title });
    header.createSpan({ text: subtitle });
    return surface;
  }

  private createMetricCard(
    parent: HTMLElement,
    iconName: string,
    value: string,
    label: string,
    colorClass: string,
    onClick: () => void
  ): void {
    const button = parent.createEl("button", {
      cls: `aurora-metric ${colorClass}`,
      attr: { type: "button", "aria-label": `${label}：${value}` }
    });
    const icon = button.createSpan("aurora-metric-icon");
    setIcon(icon, iconName);
    const copy = button.createSpan("aurora-metric-copy");
    copy.createSpan({ cls: "aurora-metric-value", text: value });
    copy.createSpan({ cls: "aurora-metric-label", text: label });
    const arrow = button.createSpan("aurora-row-arrow");
    setIcon(arrow, "chevron-right");
    this.listen(button, "click", onClick);
  }

  private createIssueRow(
    parent: HTMLElement,
    iconName: string,
    label: string,
    count: number,
    onClick: () => void
  ): void {
    const row = parent.createEl("button", {
      cls: "aurora-issue-row",
      attr: { type: "button" }
    });
    const icon = row.createSpan("aurora-issue-icon");
    setIcon(icon, iconName);
    row.createSpan({ cls: "aurora-issue-label", text: label });
    row.createSpan({
      cls: "aurora-issue-count",
      text: new Intl.NumberFormat("zh-CN").format(count)
    });
    const arrow = row.createSpan("aurora-row-arrow");
    setIcon(arrow, "chevron-right");
    this.listen(row, "click", onClick);
  }

  private createIconButton(
    parent: HTMLElement,
    iconName: string,
    label: string
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "aurora-icon-button",
      attr: { type: "button", "aria-label": label, title: label }
    });
    setIcon(button, iconName);
    return button;
  }

  private openDetails(
    title: string,
    description: string,
    items: DetailItem[]
  ): void {
    new DetailModal(this.app, title, description, items).open();
  }

  private openActivityDay(day: DailyActivity): void {
    this.openDetails(
      formatDateLabel(day.date),
      `${new Intl.NumberFormat("en-CA").format(day.addedWords)} words · ${day.edits} edits${day.estimated ? " · estimated" : ""}`,
      day.files.map((file) => ({ file, subtitle: file.path }))
    );
  }

  private activitySubtitle(): string {
    const days = this.plugin.data.settings.activityHistoryDays;
    if (days >= 365) return "Last 12 months";
    if (days >= 180) return "Last 6 months";
    return `Last ${days} days`;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    eventName: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): void {
    element.addEventListener(eventName, handler);
    this.renderDisposers.push(() =>
      element.removeEventListener(eventName, handler)
    );
  }

  private clearRenderResources(): void {
    this.renderDisposers.forEach((dispose) => dispose());
    this.renderDisposers = [];
  }
}

interface GalaxyNode extends NodeObject {
  id: string;
  file: TFile;
  degree: number;
  color: string;
  val: number;
}

interface GalaxyLink extends LinkObject<GalaxyNode> {
  source: string | GalaxyNode;
  target: string | GalaxyNode;
}

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartGeometry {
  points: ChartPoint[];
}

function createGalaxyStars(
  count: number
): Points<BufferGeometry, PointsMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const palette = ["#f8f5ff", "#ff63a7", "#a884ff", "#66d9ff"];
  let seed = 0x51f15e;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let index = 0; index < count; index += 1) {
    const radius = 250 + random() * 850;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
    const color = new Color(palette[Math.floor(random() * palette.length)]);
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: 1.65,
    transparent: true,
    opacity: 0.78,
    vertexColors: true,
    blending: AdditiveBlending,
    depthWrite: false
  });
  return new Points(geometry, material);
}

function galaxyColor(path: string): string {
  const palette = ["#ff4f9a", "#b78cff", "#6dd6ff", "#f4a4d2", "#f7d76d"];
  return palette[stableHash(path) % palette.length]!;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function drawTrendChart(
  canvas: HTMLCanvasElement,
  trend: DailyActivity[],
  tokenRoot: HTMLElement
): ChartGeometry {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(190, rect.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return { points: [] };
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const style = getComputedStyle(tokenRoot);
  const gridColor =
    style.getPropertyValue("--aurora-chart-grid").trim() ||
    "rgba(136, 152, 170, 0.18)";
  const lineColor =
    style.getPropertyValue("--aurora-accent-blue").trim() || "#88c0d0";
  const textColor =
    style.getPropertyValue("--aurora-text-muted").trim() || "#a3adba";
  const padding = { top: 18, right: 18, bottom: 30, left: 45 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...trend.map((day) => day.addedWords));
  const roundedMax = roundChartMax(maxValue);

  context.font =
    "11px var(--font-interface, -apple-system, BlinkMacSystemFont, sans-serif)";
  context.textBaseline = "middle";
  context.strokeStyle = gridColor;
  context.fillStyle = textColor;
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + (plotHeight / 4) * step;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    const value = roundedMax - (roundedMax / 4) * step;
    context.textAlign = "right";
    context.fillText(shortAxisNumber(value), padding.left - 9, y);
  }

  const points = trend.map((day, index) => {
    const x =
      padding.left +
      (trend.length <= 1 ? 0 : (plotWidth * index) / (trend.length - 1));
    const y =
      padding.top + plotHeight * (1 - day.addedWords / roundedMax);
    return { x, y };
  });

  if (points.length > 0) {
    context.strokeStyle = lineColor;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();

    points.forEach((point, index) => {
      if (index % 3 !== 0 && index !== points.length - 1) return;
      context.fillStyle = lineColor;
      context.beginPath();
      context.arc(point.x, point.y, index === points.length - 1 ? 4 : 2.5, 0, Math.PI * 2);
      context.fill();
    });
  }

  context.fillStyle = textColor;
  context.textAlign = "center";
  [0, 7, 14, 21, 29].forEach((index) => {
    const day = trend[index];
    const point = points[index];
    if (!day || !point) return;
    context.fillText(formatShortDate(day.date), point.x, height - 10);
  });

  return { points };
}

function nearestPointIndex(points: ChartPoint[], x: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function roundChartMax(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function shortAxisNumber(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function noteDetail(note: NoteMetric, badge?: string): DetailItem {
  return {
    file: note.file,
    title: note.file.basename,
    subtitle: note.file.path,
    badge
  };
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 6) return "Up late?";
  if (hour < 11) return "Good morning";
  if (hour < 14) return "Good afternoon";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatUpdatedTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "Updated just now";
  if (diff < 3_600_000) return `Updated ${Math.floor(diff / 60_000)} minutes ago`;
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} minutes ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hours ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat("en-CA", {
    month: "numeric",
    day: "numeric"
  }).format(timestamp);
}

function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${date}T00:00:00`));
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return `${parsed.getMonth() + 1}-${parsed.getDate()}`;
}

function activityAriaLabel(day: DailyActivity): string {
  const source = day.estimated ? ", estimated" : "";
  return `${formatDateLabel(day.date)}, ${day.addedWords} words, ${day.edits} edits${source}`;
}
