export class ChatHistory {
  entries: string[];
  private index: number;
  private draft = "";
  constructor(entries: string[] = []) {
    this.entries = entries
      .filter((v) => typeof v === "string" && v.length <= 1024)
      .slice(-100);
    this.index = this.entries.length;
  }
  add(value: string) {
    if (value && this.entries.at(-1) !== value) this.entries.push(value);
    this.entries = this.entries.slice(-100);
    this.reset();
  }
  reset() {
    this.index = this.entries.length;
    this.draft = "";
  }
  up(current: string) {
    if (this.index === this.entries.length) this.draft = current;
    this.index = Math.max(0, this.index - 1);
    return this.entries[this.index] ?? current;
  }
  down() {
    this.index = Math.min(this.entries.length, this.index + 1);
    return this.index === this.entries.length
      ? this.draft
      : this.entries[this.index];
  }
}
