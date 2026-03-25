import { powerSaveBlocker } from 'electron'

export class PowerSaveManager {
  private blockerId: number | null = null

  update(activeSessionCount: number): void {
    if (activeSessionCount > 0) {
      if (this.blockerId == null) {
        this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
      }
      return
    }

    if (this.blockerId != null && powerSaveBlocker.isStarted(this.blockerId)) {
      powerSaveBlocker.stop(this.blockerId)
    }
    this.blockerId = null
  }

  dispose(): void {
    this.update(0)
  }
}

