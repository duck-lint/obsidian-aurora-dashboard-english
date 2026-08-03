import { ItemView, Notice, TFile, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
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
  DailyLinkCount,
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
  private galaxyGraphResource: GalaxyGraphResource | null = null;

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
    this.disposeGalaxyGraph();
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
    this.disposeGalaxyGraph();
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
      text: "Scan again",
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
        ? `${todoCount} incomplete`
        : "No file configured"
    );
    todoSurface.addClass("aurora-todo-surface");
    this.renderTodoList(todoSurface, snapshot);

    const graphSurface = this.createSurface(
      focusGrid,
      "Knowledge Graph",
      `${snapshot.graph.nodes.length} nodes · ${snapshot.graph.edges.length} connections`
    );
    graphSurface.addClass("aurora-graph-surface");
    this.renderGalaxyGraph(graphSurface, snapshot.graph);

    const activitySurface = this.createSurface(
      focusGrid,
      "Writing Activity",
      this.activitySubtitle()
    );
    activitySurface.addClass("aurora-activity-surface");
    this.renderHeatmap(activitySurface, snapshot);

    const currentLinkCount = snapshot.linkHistory.at(-1)?.count ?? 0;
    const linkSurface = this.createSurface(
      focusGrid,
      "Resolved links",
      `365 days · ${formatCompactNumber(currentLinkCount)}`
    );
    linkSurface.addClass("aurora-link-surface");
    this.renderLinkChart(linkSurface, snapshot.linkHistory);

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
      "Words added",
      "Past 30 days"
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
      "File structure",
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
        ? "Writing activity includes estimates from before installation"
        : "Showing exact activity since installation"
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
    const refresh = this.createIconButton(actions, "refresh-cw", "Scan again");
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
          "CJK characters and words in other languages counted from readable text",
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
          "These notes have not been referenced by other notes",
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
          `Current threshold: no more than ${this.plugin.data.settings.shortNoteWordThreshold} words`,
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
        "No Todo file configured",
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
          ? "This file has no incomplete tasks"
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
        text: `${file.basename} · line ${task.line + 1}`
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
          "Incomplete tasks",
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
    const graphKey = knowledgeGraphKey(snapshot);
    if (this.galaxyGraphResource?.key === graphKey) {
      surface.appendChild(this.galaxyGraphResource.body);
      return;
    }

    this.disposeGalaxyGraph();
    const body = surface.createDiv("aurora-galaxy-graph");
    if (snapshot.nodes.length === 0) {
      body.createDiv({ cls: "aurora-empty-state", text: "No connections to display" });
      return;
    }

    const nodes: GalaxyNode[] = snapshot.nodes.map((node) => ({
      id: node.file.path,
      file: node.file,
      degree: node.degree,
      color: galaxyColor(node.file.path)
    }));
    const links: GalaxyLink[] = snapshot.edges.map((edge) => ({
      source: edge.source,
      target: edge.target
    }));
    // Keep this renderer Canvas 2D-only. A second WebGL graph in Obsidian's
    // Electron renderer can evict the native graph's GPU context.
    const scene = createGalaxyScene(nodes, links);
    const canvas = body.createEl("canvas", {
      cls: "aurora-galaxy-canvas",
      attr: {
        role: "img",
        "aria-label": "Rotatable and zoomable 3D galaxy knowledge graph"
      }
    });
    const tooltip = body.createDiv("aurora-galaxy-tooltip");
    tooltip.hide();
    let points: GalaxyCanvasPoint[] = [];
    const camera: GalaxyCamera = {
      yaw: -0.42,
      pitch: 0.18,
      zoom: 1.18
    };
    let animationFrame = 0;
    let lastFrame = 0;
    let visible = true;
    let disposed = false;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const draw = (time = performance.now()): void => {
      points = drawGalaxyCanvas(
        canvas,
        scene,
        camera,
        reduceMotion ? 0 : time / 1000
      );
      lastFrame = time;
    };
    const scheduleAnimation = (): void => {
      if (
        disposed ||
        reduceMotion ||
        !visible ||
        document.hidden ||
        animationFrame !== 0
      ) {
        return;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    const animate = (time: number): void => {
      animationFrame = 0;
      if (time - lastFrame >= 32) draw(time);
      scheduleAnimation();
    };
    const resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(body);
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) {
        draw();
        scheduleAnimation();
      } else if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    });
    intersectionObserver.observe(body);
    const handleVisibility = (): void => {
      if (document.hidden) {
        if (animationFrame !== 0) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
      } else {
        draw();
        scheduleAnimation();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    draw();
    scheduleAnimation();

    const nearestNode = (
      event: PointerEvent | MouseEvent
    ): GalaxyCanvasPoint | null => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let nearest: GalaxyCanvasPoint | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      points
        .slice()
        .sort((left, right) => left.depth - right.depth)
        .forEach((point) => {
          const distance = Math.hypot(point.x - x, point.y - y);
          if (
            distance <= Math.max(10, point.radius + 5) &&
            distance < nearestDistance
          ) {
            nearest = point;
            nearestDistance = distance;
          }
        });
      return nearest;
    };
    let pointerId: number | null = null;
    let pointerX = 0;
    let pointerY = 0;
    let dragDistance = 0;
    const handlePointerDown = (event: PointerEvent): void => {
      pointerId = event.pointerId;
      pointerX = event.clientX;
      pointerY = event.clientY;
      dragDistance = 0;
      canvas.setPointerCapture(event.pointerId);
      canvas.addClass("is-dragging");
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (pointerId === event.pointerId) {
        const deltaX = event.clientX - pointerX;
        const deltaY = event.clientY - pointerY;
        pointerX = event.clientX;
        pointerY = event.clientY;
        dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
        camera.yaw += deltaX * 0.008;
        camera.pitch = Math.max(
          -Math.PI * 0.42,
          Math.min(Math.PI * 0.42, camera.pitch + deltaY * 0.008)
        );
        draw();
        tooltip.hide();
        return;
      }
      const point = nearestNode(event);
      canvas.toggleClass("is-node-hovered", point !== null);
      if (!point) {
        tooltip.hide();
        return;
      }
      tooltip.setText(`${point.node.file.basename} · ${point.node.degree} connections`);
      tooltip.setCssProps({
        "--aurora-tooltip-left": `${Math.min(body.clientWidth - 170, point.x + 10)}px`,
        "--aurora-tooltip-top": `${Math.max(42, point.y - 22)}px`
      });
      tooltip.show();
    };
    const finishPointer = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      pointerId = null;
      canvas.removeClass("is-dragging");
    };
    const handlePointerLeave = (): void => {
      canvas.removeClass("is-node-hovered");
      tooltip.hide();
    };
    const handleClick = (event: MouseEvent): void => {
      if (dragDistance > 5) {
        dragDistance = 0;
        return;
      }
      const point = nearestNode(event);
      if (point) void this.app.workspace.getLeaf(false).openFile(point.node.file);
    };
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      camera.zoom = Math.max(
        0.72,
        Math.min(2.5, camera.zoom * Math.exp(-event.deltaY * 0.0012))
      );
      draw();
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("wheel", handleWheel);
      body.remove();
    };
    this.galaxyGraphResource = { key: graphKey, body, dispose };
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
      "Incomplete Todo tasks",
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
          "Incomplete tasks",
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
          "These notes have not been referenced by other notes",
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
          `Current threshold: no more than ${this.plugin.data.settings.shortNoteWordThreshold} words`,
          snapshot.shortNotes.map((note) =>
            noteDetail(note, `${note.words} words`)
          )
        )
    );
  }

  private renderLinkChart(
    surface: HTMLElement,
    history: DailyLinkCount[]
  ): void {
    const chartWrap = surface.createDiv("aurora-link-chart-wrap");
    const canvas = chartWrap.createEl("canvas", {
      cls: "aurora-link-chart",
      attr: {
        role: "img",
        "aria-label": "Cumulative resolved links over the past 365 days"
      }
    });
    const tooltip = chartWrap.createDiv("aurora-chart-tooltip");
    tooltip.hide();
    const draw = (): ChartGeometry =>
      drawLinkChart(canvas, history, surface);
    let geometry = draw();
    const observer = new ResizeObserver(() => {
      geometry = draw();
    });
    observer.observe(chartWrap);
    this.renderDisposers.push(() => observer.disconnect());

    this.listen(canvas, "mousemove", (event) => {
      if (history.length === 0 || geometry.points.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const index = nearestPointIndex(
        geometry.points,
        event.clientX - rect.left
      );
      const point = geometry.points[index];
      const day = history[index];
      if (!point || !day) return;
      tooltip.empty();
      tooltip.createSpan({
        cls: "aurora-chart-tooltip-date",
        text: formatDateLabel(day.date)
      });
      tooltip.createSpan({
        text: `${new Intl.NumberFormat("en-CA").format(day.count)} cumulative resolved links`
      });
      if (day.estimated) {
        tooltip.createSpan({
          cls: "aurora-chart-tooltip-source",
          text: "Estimated from source-note modification dates"
        });
      }
      tooltip.setCssProps({
        "--aurora-tooltip-left": `${Math.min(rect.width - 145, Math.max(8, point.x - 55))}px`,
        "--aurora-tooltip-top": `${Math.max(8, point.y - 66)}px`
      });
      tooltip.show();
    });
    this.listen(canvas, "mouseleave", () => tooltip.hide());

    chartWrap.createDiv({
      cls: "aurora-link-chart-note",
      text: history.some((day) => day.estimated)
        ? "History estimated from source-note modification dates"
        : "Exact daily snapshots"
    });
  }

  private renderTrendChart(
    surface: HTMLElement,
    trend: DailyActivity[]
  ): void {
    const chartWrap = surface.createDiv("aurora-chart-wrap");
    const canvas = chartWrap.createEl("canvas", {
      cls: "aurora-trend-chart",
      attr: { role: "img", "aria-label": "Words added per day over the past 30 days" }
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
          ? `Today ${new Intl.NumberFormat("en-CA").format(latest.addedWords)} words`
          : "No activity"
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
      text: new Intl.NumberFormat("en-CA").format(count)
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
    if (days >= 365) return "Past 12 months";
    if (days >= 180) return "Past 6 months";
    return `Past ${days} days`;
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

  private disposeGalaxyGraph(): void {
    this.galaxyGraphResource?.dispose();
    this.galaxyGraphResource = null;
  }
}

interface GalaxyGraphResource {
  key: string;
  body: HTMLElement;
  dispose: () => void;
}

interface GalaxyNode {
  id: string;
  file: TFile;
  degree: number;
  color: string;
  x?: number;
  y?: number;
  z?: number;
}

interface GalaxyLink {
  source: string;
  target: string;
}

interface ResolvedGalaxyLink {
  source: GalaxyNode;
  target: GalaxyNode;
  phase: number;
}

interface GalaxyStar {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  color: string;
}

interface GalaxyScene {
  nodes: GalaxyNode[];
  links: ResolvedGalaxyLink[];
  stars: GalaxyStar[];
}

interface GalaxyCamera {
  yaw: number;
  pitch: number;
  zoom: number;
}

interface GalaxyCanvasPoint {
  node: GalaxyNode;
  x: number;
  y: number;
  radius: number;
  depth: number;
}

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartGeometry {
  points: ChartPoint[];
}

function knowledgeGraphKey(snapshot: KnowledgeGraphSnapshot): string {
  let hash = 2166136261;
  const add = (value: string): void => {
    for (const character of value) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
  };
  snapshot.nodes.forEach((node) => add(`${node.file.path}:${node.degree}|`));
  snapshot.edges.forEach((edge) => add(`${edge.source}>${edge.target}|`));
  return `${snapshot.nodes.length}:${snapshot.edges.length}:${hash >>> 0}`;
}

function createGalaxyScene(
  nodes: GalaxyNode[],
  links: GalaxyLink[]
): GalaxyScene {
  const maxDegree = Math.max(1, ...nodes.map((node) => node.degree));
  nodes.forEach((node) => {
    const random = seededRandom(stableHash(node.id));
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const degreeWeight = Math.sqrt(node.degree / maxDegree);
    const radius = 34 + (1 - degreeWeight) * 145 + random() * 34;
    node.x = radius * Math.sin(phi) * Math.cos(theta);
    node.y = radius * Math.cos(phi) * 0.86;
    node.z = radius * Math.sin(phi) * Math.sin(theta);
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resolvedLinks = links.flatMap((link, index): ResolvedGalaxyLink[] => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) return [];
    return [{ source, target, phase: (index * 0.61803398875) % 1 }];
  });

  relaxGalaxyLayout(nodes, resolvedLinks);
  const random = seededRandom(0x51f15e);
  const starColors = ["#f8f5ff", "#ff63a7", "#a884ff", "#66d9ff"];
  const stars = Array.from({ length: 190 }, (): GalaxyStar => {
    const radius = 235 + random() * 330;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.cos(phi),
      z: radius * Math.sin(phi) * Math.sin(theta),
      size: 0.45 + random() * 1.15,
      alpha: 0.18 + random() * 0.5,
      color: starColors[Math.floor(random() * starColors.length)]!
    };
  });
  return { nodes, links: resolvedLinks, stars };
}

function relaxGalaxyLayout(
  nodes: GalaxyNode[],
  links: ResolvedGalaxyLink[]
): void {
  const forceX = new Float32Array(nodes.length);
  const forceY = new Float32Array(nodes.length);
  const forceZ = new Float32Array(nodes.length);
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  for (let iteration = 0; iteration < 36; iteration += 1) {
    forceX.fill(0);
    forceY.fill(0);
    forceZ.fill(0);
    for (let left = 0; left < nodes.length; left += 1) {
      const a = nodes[left]!;
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const az = a.z ?? 0;
      forceX[left] = (forceX[left] ?? 0) - ax * 0.0018;
      forceY[left] = (forceY[left] ?? 0) - ay * 0.0018;
      forceZ[left] = (forceZ[left] ?? 0) - az * 0.0018;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const b = nodes[right]!;
        const dx = ax - (b.x ?? 0);
        const dy = ay - (b.y ?? 0);
        const dz = az - (b.z ?? 0);
        const distanceSquared = dx * dx + dy * dy + dz * dz + 36;
        const strength = 68 / distanceSquared;
        forceX[left] = (forceX[left] ?? 0) + dx * strength;
        forceY[left] = (forceY[left] ?? 0) + dy * strength;
        forceZ[left] = (forceZ[left] ?? 0) + dz * strength;
        forceX[right] = (forceX[right] ?? 0) - dx * strength;
        forceY[right] = (forceY[right] ?? 0) - dy * strength;
        forceZ[right] = (forceZ[right] ?? 0) - dz * strength;
      }
    }
    links.forEach((link) => {
      const sourceIndex = nodeIndex.get(link.source);
      const targetIndex = nodeIndex.get(link.target);
      if (sourceIndex === undefined || targetIndex === undefined) return;
      const dx = (link.target.x ?? 0) - (link.source.x ?? 0);
      const dy = (link.target.y ?? 0) - (link.source.y ?? 0);
      const dz = (link.target.z ?? 0) - (link.source.z ?? 0);
      const distance = Math.max(1, Math.hypot(dx, dy, dz));
      const spring = (distance - 48) * 0.0065;
      const fx = (dx / distance) * spring;
      const fy = (dy / distance) * spring;
      const fz = (dz / distance) * spring;
      forceX[sourceIndex] = (forceX[sourceIndex] ?? 0) + fx;
      forceY[sourceIndex] = (forceY[sourceIndex] ?? 0) + fy;
      forceZ[sourceIndex] = (forceZ[sourceIndex] ?? 0) + fz;
      forceX[targetIndex] = (forceX[targetIndex] ?? 0) - fx;
      forceY[targetIndex] = (forceY[targetIndex] ?? 0) - fy;
      forceZ[targetIndex] = (forceZ[targetIndex] ?? 0) - fz;
    });
    const step = 0.82 - iteration * 0.012;
    nodes.forEach((node, index) => {
      node.x = (node.x ?? 0) + forceX[index]! * step;
      node.y = (node.y ?? 0) + forceY[index]! * step;
      node.z = (node.z ?? 0) + forceZ[index]! * step;
    });
  }

  const positionedNodes = nodes.filter((node) => node.degree > 0);
  const layoutNodes = positionedNodes.length > 0 ? positionedNodes : nodes;
  if (layoutNodes.length === 0) return;
  const center = layoutNodes.reduce(
    (sum, node) => ({
      x: sum.x + (node.x ?? 0),
      y: sum.y + (node.y ?? 0),
      z: sum.z + (node.z ?? 0)
    }),
    { x: 0, y: 0, z: 0 }
  );
  center.x /= layoutNodes.length;
  center.y /= layoutNodes.length;
  center.z /= layoutNodes.length;
  nodes.forEach((node) => {
    node.x = (node.x ?? 0) - center.x;
    node.y = (node.y ?? 0) - center.y;
    node.z = (node.z ?? 0) - center.z;
  });
  const radii = layoutNodes
    .map((node) => Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0))
    .sort((left, right) => left - right);
  const percentileRadius =
    radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.94))] ?? 1;
  const scale = 150 / Math.max(1, percentileRadius);
  nodes.forEach((node) => {
    let x = (node.x ?? 0) * scale;
    let y = (node.y ?? 0) * scale;
    let z = (node.z ?? 0) * scale;
    const radius = Math.hypot(x, y, z);
    if (radius > 205) {
      const clamp = 205 / radius;
      x *= clamp;
      y *= clamp;
      z *= clamp;
    }
    node.x = x;
    node.y = y;
    node.z = z;
  });
}

function drawGalaxyCanvas(
  canvas: HTMLCanvasElement,
  scene: GalaxyScene,
  camera: GalaxyCamera,
  time: number
): GalaxyCanvasPoint[] {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, rect.width);
  const height = Math.max(340, rect.height);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return [];
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(
    width * 0.48,
    height * 0.46,
    0,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72
  );
  background.addColorStop(0, "#10112d");
  background.addColorStop(0.48, "#08091a");
  background.addColorStop(1, "#03040d");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const yaw = camera.yaw + time * 0.035;
  const project = (x: number, y: number, z: number): ProjectedPoint => {
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(camera.pitch);
    const sinPitch = Math.sin(camera.pitch);
    const rotatedX = x * cosYaw + z * sinYaw;
    const yawZ = -x * sinYaw + z * cosYaw;
    const rotatedY = y * cosPitch - yawZ * sinPitch;
    const rotatedZ = y * sinPitch + yawZ * cosPitch;
    const perspective = 430 / Math.max(150, 430 + rotatedZ);
    const scale = (Math.min(width, height) / 410) * camera.zoom * perspective;
    return {
      x: width / 2 + rotatedX * scale,
      y: height / 2 + rotatedY * scale,
      depth: rotatedZ,
      scale
    };
  };

  scene.stars.forEach((star) => {
    const point = project(star.x, star.y, star.z);
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return;
    context.globalAlpha = star.alpha * Math.max(0.35, point.scale);
    context.fillStyle = star.color;
    context.beginPath();
    context.arc(point.x, point.y, star.size * Math.max(0.5, point.scale), 0, Math.PI * 2);
    context.fill();
  });
  context.globalAlpha = 1;

  const points = scene.nodes.map((node): GalaxyCanvasPoint => {
    const projected = project(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    return {
      node,
      x: projected.x,
      y: projected.y,
      radius:
        (1.65 + Math.min(4.6, Math.log2(node.degree + 2))) *
        Math.max(0.58, projected.scale),
      depth: projected.depth
    };
  });
  const pointById = new Map(points.map((point) => [point.node.id, point]));

  scene.links.forEach((link) => {
    const source = pointById.get(link.source.id);
    const target = pointById.get(link.target.id);
    if (!source || !target) return;
    const depthFactor = Math.max(
      0.28,
      Math.min(1, 0.72 - (source.depth + target.depth) / 900)
    );
    context.strokeStyle = `rgba(174, 151, 255, ${0.2 + depthFactor * 0.34})`;
    context.lineWidth = 0.55 + depthFactor * 0.7;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
  });

  const particleStride = Math.max(1, Math.ceil(scene.links.length / 180));
  scene.links.forEach((link, index) => {
    if (index % particleStride !== 0) return;
    const progress = (time * 0.09 + link.phase) % 1;
    const point = project(
      (link.source.x ?? 0) + ((link.target.x ?? 0) - (link.source.x ?? 0)) * progress,
      (link.source.y ?? 0) + ((link.target.y ?? 0) - (link.source.y ?? 0)) * progress,
      (link.source.z ?? 0) + ((link.target.z ?? 0) - (link.source.z ?? 0)) * progress
    );
    context.globalAlpha = 0.72;
    context.fillStyle = "#ff5aa6";
    context.beginPath();
    context.arc(point.x, point.y, Math.max(0.7, point.scale * 1.15), 0, Math.PI * 2);
    context.fill();
  });

  points
    .slice()
    .sort((left, right) => right.depth - left.depth)
    .forEach((point) => {
      context.shadowColor = point.node.color;
      context.shadowBlur = 5 + point.radius;
      context.fillStyle = point.node.color;
      context.globalAlpha = Math.max(0.52, Math.min(0.96, 0.78 - point.depth / 900));
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fill();
    });
  context.shadowBlur = 0;
  context.globalAlpha = 1;
  return points;
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
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

function drawLinkChart(
  canvas: HTMLCanvasElement,
  history: DailyLinkCount[],
  tokenRoot: HTMLElement
): ChartGeometry {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(220, rect.width);
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
    style.getPropertyValue("--aurora-accent-purple").trim() || "#b48ead";
  const areaColor =
    style.getPropertyValue("--aurora-link-area").trim() ||
    "rgba(180, 142, 173, 0.22)";
  const textColor =
    style.getPropertyValue("--aurora-text-muted").trim() || "#a3adba";
  const padding = { top: 18, right: 14, bottom: 31, left: 39 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...history.map((day) => day.count));
  const roundedMax = roundChartMax(maxValue);

  context.font =
    "10px var(--font-interface, -apple-system, BlinkMacSystemFont, sans-serif)";
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
    context.fillText(shortAxisNumber(value), padding.left - 7, y);
  }

  const points = history.map((day, index) => ({
    x:
      padding.left +
      (history.length <= 1 ? 0 : (plotWidth * index) / (history.length - 1)),
    y: padding.top + plotHeight * (1 - day.count / roundedMax)
  }));

  if (points.length > 0) {
    const first = points[0]!;
    const last = points.at(-1)!;
    context.fillStyle = areaColor;
    context.beginPath();
    context.moveTo(first.x, padding.top + plotHeight);
    points.forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(last.x, padding.top + plotHeight);
    context.closePath();
    context.fill();

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

    context.fillStyle = lineColor;
    context.beginPath();
    context.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = textColor;
  context.textAlign = "center";
  const tickIndexes = [
    0,
    Math.floor((history.length - 1) / 2),
    Math.max(0, history.length - 1)
  ];
  [...new Set(tickIndexes)].forEach((index) => {
    const day = history[index];
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
  if (value >= 1000) {
    const scaled = value / 1000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/u, "")}k`;
  }
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
  if (hour < 6) return "Late night";
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
