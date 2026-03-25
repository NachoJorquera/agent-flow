export interface Disposable {
  dispose(): void
}

export class TypedEventEmitter<T> implements Disposable {
  private listeners: Array<(e: T) => void> = []

  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener)
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener)
        if (index >= 0) this.listeners.splice(index, 1)
      },
    }
  }

  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value)
  }

  dispose(): void {
    this.listeners = []
  }
}

