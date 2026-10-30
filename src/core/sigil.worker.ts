import { processIntention } from './intention';
import { composeWheelSigil, type WheelMode } from './wheel';

const scope = self as unknown as {
  postMessage: (value: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

scope.onmessage = (event: MessageEvent) => {
  const data = event.data as
    | { input?: string; wheelMode?: WheelMode; requestId?: number }
    | null;
  try {
    const intention = processIntention(data?.input ?? '');
    const sigil = composeWheelSigil(intention, {
      mode: data?.wheelMode === 'single' ? 'single' : 'multi',
    });
    scope.postMessage({
      ok: true,
      requestId: data?.requestId,
      sigil,
    });
  } catch (error) {
    scope.postMessage({
      ok: false,
      requestId: data?.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
