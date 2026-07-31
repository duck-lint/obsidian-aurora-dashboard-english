import { Modal, setIcon } from "obsidian";
import type { App, TFile } from "obsidian";

export interface DetailItem {
  file: TFile;
  title?: string;
  subtitle?: string;
  badge?: string;
}

export class DetailModal extends Modal {
  private filteredItems: DetailItem[];

  constructor(
    app: App,
    private readonly heading: string,
    private readonly description: string,
    private readonly items: DetailItem[]
  ) {
    super(app);
    this.filteredItems = items;
  }

  onOpen(): void {
    this.modalEl.addClass("aurora-detail-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv("aurora-modal-header");
    header.createEl("h2", { text: this.heading });
    header.createEl("p", { text: this.description });

    const searchWrap = this.contentEl.createDiv("aurora-modal-search");
    const searchIcon = searchWrap.createSpan("aurora-modal-search-icon");
    setIcon(searchIcon, "search");
    const search = searchWrap.createEl("input", {
      attr: {
        type: "search",
        placeholder: `Search ${this.items.length} results`,
        "aria-label": "Search results"
      }
    });
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase();
      this.filteredItems = query
        ? this.items.filter((item) =>
            [item.title ?? item.file.basename, item.file.path, item.subtitle]
              .filter(Boolean)
              .some((value) => value?.toLocaleLowerCase().includes(query))
          )
        : this.items;
      this.renderList(list);
    });

    const summary = this.contentEl.createDiv("aurora-modal-summary");
    summary.setText(`${this.items.length} results`);
    const list = this.contentEl.createDiv("aurora-modal-list");
    this.renderList(list);
    window.setTimeout(() => search.focus(), 0);
  }

  private renderList(list: HTMLElement): void {
    list.empty();
    if (this.filteredItems.length === 0) {
      const empty = list.createDiv("aurora-modal-empty");
      const icon = empty.createSpan();
      setIcon(icon, "search-x");
      empty.createEl("p", { text: "No matching results" });
      return;
    }

    this.filteredItems.forEach((item) => {
      const row = list.createEl("button", {
        cls: "aurora-modal-row",
        attr: { type: "button" }
      });
      const icon = row.createSpan("aurora-modal-row-icon");
      setIcon(icon, "file-text");
      const copy = row.createSpan("aurora-modal-row-copy");
      copy.createSpan({
        cls: "aurora-modal-row-title",
        text: item.title ?? item.file.basename
      });
      copy.createSpan({
        cls: "aurora-modal-row-path",
        text: item.subtitle ?? item.file.path
      });
      if (item.badge) {
        row.createSpan({ cls: "aurora-modal-row-badge", text: item.badge });
      }
      const arrow = row.createSpan("aurora-modal-row-arrow");
      setIcon(arrow, "chevron-right");
      row.addEventListener("click", () => {
        void this.app.workspace.getLeaf(false).openFile(item.file);
        this.close();
      });
    });
  }
}
