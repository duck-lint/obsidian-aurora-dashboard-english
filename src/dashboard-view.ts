import { ItemView, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import {
  activityLevel,
  formatCompactNumber,
  localDateKey
} from "./core";
import { DetailModal, type DetailItem } from "./detail-modal";
import type AuroraDashboardPlugin from "./main";
import type {
  DailyActivity,
  DashboardSnapshot,
  NoteMetric
} from "./models";
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
    return "Aurora Dashboard";
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
      const snapshot = await this.plugin.stats.scan(force);
      this.render(snapshot);
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

  private render(snapshot: DashboardSnapshot): void {
    this.clearRenderResources();
    this.contentEl.empty();
    const root = this.contentEl.createDiv("aurora-dashboard");

    this.renderHeader(root, snapshot);
    this.renderMetrics(root, snapshot);

    const heroGrid = root.createDiv("aurora-dashboard-grid aurora-hero-grid");
    const activitySurface = this.createSurface(
      heroGrid,
      "Writing activity",
      this.activitySubtitle()
    );
    activitySurface.addClass("aurora-activity-surface");
    this.renderHeatmap(activitySurface, snapshot);

    const issuesSurface = this.createSurface(
      heroGrid,
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
        ? "Dashed cells show estimated pre-installation activity"
        : "Only precise activity since installation is shown"
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
    const body = surface.createDiv("aurora-heatmap-body");
    const weekdayLabels = body.createDiv("aurora-heatmap-weekdays");
    weekdayLabels.createSpan({ text: "" });
    weekdayLabels.createSpan({ text: "Mon" });
    weekdayLabels.createSpan({ text: "" });
    weekdayLabels.createSpan({ text: "Wed" });
    weekdayLabels.createSpan({ text: "" });
    weekdayLabels.createSpan({ text: "Fri" });
    weekdayLabels.createSpan({ text: "" });

    const content = body.createDiv("aurora-heatmap-content");
    const monthLabels = content.createDiv("aurora-heatmap-months");
    monthNamesForRange(snapshot.activity).forEach((month) => {
      monthLabels.createSpan({ text: month });
    });

    const grid = content.createDiv("aurora-heatmap-grid");
    const firstDate = snapshot.activity[0]?.date;
    if (firstDate) {
      const firstDay = new Date(`${firstDate}T00:00:00`).getDay();
      for (let index = 0; index < firstDay; index += 1) {
        grid.createSpan("aurora-heatmap-placeholder");
      }
    }
    const today = localDateKey(new Date());
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
      this.listen(cell, "click", () =>
        this.openActivityDay(day)
      );
    });

    const legend = surface.createDiv("aurora-heatmap-legend");
    legend.createSpan({ text: "Less" });
    for (let level = 0; level <= 5; level += 1) {
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
      "Open tasks",
      snapshot.taskNotes.reduce((sum, note) => sum + note.tasks.length, 0),
      () => {
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
          "Click a task to open its note",
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

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartGeometry {
  points: ChartPoint[];
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

function monthNamesForRange(activity: DailyActivity[]): string[] {
  const months: string[] = [];
  let previous = -1;
  activity.forEach((day) => {
    const month = new Date(`${day.date}T00:00:00`).getMonth();
    if (month !== previous) {
      months.push(new Intl.DateTimeFormat("en-CA", { month: "short" }).format(new Date(2026, month, 1)));
      previous = month;
    }
  });
  return months;
}
