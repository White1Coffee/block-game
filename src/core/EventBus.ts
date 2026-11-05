export class EventBus<T> {
  private listeners = new Set<(event: T) => void>();
  subscribe(listener: (event: T) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: T) {
    this.listeners.forEach((listener) => listener(event));
  }
  clear() {
    this.listeners.clear();
  }
}
