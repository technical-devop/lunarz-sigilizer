import { composeWheelSigil, processIntention, type WheelMode } from '../core';

export interface WorkerRequest {
  readonly input?: string;
  readonly wheelMode?: WheelMode;
  readonly regeneration?: number;
}

type MessageHandler = ((event: MessageEvent) => void) | null;
type ErrorHandler = ((event: ErrorEvent) => void) | null;

export class FakeWorker {
  static instances: FakeWorker[] = [];
  static defer = true;

  readonly url: string | URL;
  readonly options?: WorkerOptions;
  onmessage: MessageHandler = null;
  onerror: ErrorHandler = null;
  terminated = false;
  request: WorkerRequest | null = null;

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(data: WorkerRequest): void {
    this.request = data;
    const run = (): void => {
      if (this.terminated) {
        return;
      }
      try {
        const intention = processIntention(data.input ?? '');
        const sigil = composeWheelSigil(intention, {
          mode: data.wheelMode === 'single' ? 'single' : 'multi',
        });
        if (!this.terminated) {
          this.onmessage?.({
            data: { ok: true, sigil },
          } as MessageEvent);
        }
      } catch (error) {
        if (!this.terminated) {
          this.onmessage?.({
            data: { ok: false, error: String(error) },
          } as MessageEvent);
        }
      }
    };
    if (FakeWorker.defer) {
      queueMicrotask(run);
    } else {
      run();
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  static reset(): void {
    FakeWorker.instances = [];
    FakeWorker.defer = true;
  }
}

export class ErrorWorker extends FakeWorker {
  override postMessage(data: WorkerRequest): void {
    this.request = data;
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onerror?.({
          message: 'simulated worker startup failure',
          preventDefault: () => undefined,
        } as ErrorEvent);
      }
    });
  }
}

export class SilentWorker extends FakeWorker {
  override postMessage(data: WorkerRequest): void {
    this.request = data;
  }
}
