import { ChatHistory } from "./ChatHistory";
export class ChatUI {
  readonly element = document.createElement("section");
  readonly input = document.createElement("input");
  private messages = document.createElement("div");
  private suggestions = document.createElement("div");
  private history = new ChatHistory();
  private completions: string[] = [];
  private completionIndex = -1;
  private unlock: Promise<void> = Promise.resolve();
  private transition = 0;
  relocking = false;
  isOpen = false;
  constructor(
    root: HTMLElement,
    private send: (text: string) => Promise<void>,
    private complete: (text: string) => string[],
    private closeCallback: () => void,
  ) {
    try {
      this.history = new ChatHistory(
        JSON.parse(localStorage.getItem("whitebrick-command-history") ?? "[]"),
      );
    } catch {
      /* Local history is optional. */
    }
    this.element.id = "chat";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Lokale chat");
    this.messages.className = "chat-messages";
    this.messages.setAttribute("role", "log");
    this.messages.setAttribute("aria-live", "polite");
    this.input.id = "chat-input";
    this.input.maxLength = 1024;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.placeholder = "Bericht of /command";
    this.input.setAttribute("aria-label", "Chatbericht of command");
    this.suggestions.className = "chat-suggestions";
    this.element.append(this.messages, this.suggestions, this.input);
    root.append(this.element);
    this.input.addEventListener("input", () => {
      this.completionIndex = -1;
      this.refreshSuggestions();
    });
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.input.value =
          e.key === "ArrowUp"
            ? this.history.up(this.input.value)
            : this.history.down();
        this.refreshSuggestions();
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (this.completionIndex < 0)
          this.completions = this.complete(this.input.value);
        if (this.completions.length) {
          this.completionIndex =
            this.completionIndex < 0
              ? e.shiftKey
                ? this.completions.length - 1
                : 0
              : (this.completionIndex +
                  (e.shiftKey ? this.completions.length - 1 : 1)) %
                this.completions.length;
          this.input.value = this.completions[this.completionIndex];
          this.input.setSelectionRange(
            this.input.value.length,
            this.input.value.length,
          );
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        void this.submit();
      }
    });
    this.element.addEventListener("mousedown", (e) => e.stopPropagation());
    this.element.addEventListener("wheel", (e) => e.stopPropagation());
  }
  private refreshSuggestions() {
    this.completions = this.complete(this.input.value);
    this.completionIndex = -1;
    this.suggestions.textContent = this.completions.slice(0, 7).join("\n");
  }
  private async submit() {
    const value = this.input.value.trim();
    if (!value) {
      this.close();
      return;
    }
    this.history.add(value);
    try {
      localStorage.setItem(
        "whitebrick-command-history",
        JSON.stringify(this.history.entries),
      );
    } catch {
      /* Storage failure must not block commands. */
    }
    // Re-lock inside the Enter gesture; waiting for IndexedDB may lose browser activation.
    const sending = this.send(value);
    this.close();
    try {
      await sending;
    } catch (error) {
      this.add(
        error instanceof Error ? error.message : "Bericht mislukt.",
        "error",
      );
    }
  }
  open(initial = "") {
    this.transition++;
    this.relocking = false;
    this.isOpen = true;
    this.element.hidden = false;
    this.element.classList.add("open");
    this.input.value = initial;
    this.history.reset();
    this.refreshSuggestions();
    if (document.pointerLockElement) {
      this.unlock = new Promise((resolve) => {
        const unlocked = () => {
          if (!document.pointerLockElement) {
            document.removeEventListener("pointerlockchange", unlocked);
            resolve();
          }
        };
        document.addEventListener("pointerlockchange", unlocked);
        document.exitPointerLock();
      });
    } else this.unlock = Promise.resolve();
    this.input.focus();
    this.messages.scrollTop = this.messages.scrollHeight;
  }
  close(relock = true) {
    const token = ++this.transition,
      wasOpen = this.isOpen;
    this.isOpen = false;
    this.element.classList.remove("open");
    this.input.blur();
    this.suggestions.textContent = "";
    this.relocking = relock && wasOpen;
    if (this.relocking)
      void this.unlock.then(() => {
        if (token !== this.transition) return;
        this.closeCallback();
        this.relocking = false;
      });
  }
  add(text: string, kind: "local" | "system" | "error" = "system") {
    const row = document.createElement("div");
    row.className = "chat-message " + kind;
    row.textContent = text;
    row.dataset.time = String(performance.now());
    this.messages.append(row);
    while (this.messages.childElementCount > 200)
      this.messages.firstElementChild?.remove();
    this.messages.scrollTop = this.messages.scrollHeight;
  }
  tick(visible: boolean) {
    this.element.hidden = !visible;
    const now = performance.now();
    for (const row of this.messages.children) {
      const age = (now - Number((row as HTMLElement).dataset.time)) / 1000;
      (row as HTMLElement).style.opacity = this.isOpen
        ? "1"
        : String(Math.max(0, Math.min(1, (12 - age) / 2)));
      (row as HTMLElement).hidden = !this.isOpen && age >= 12;
    }
  }
  clear() {
    this.close(false);
    this.messages.replaceChildren();
  }
}
