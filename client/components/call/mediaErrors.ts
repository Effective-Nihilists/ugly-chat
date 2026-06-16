/**
 * Classify a getUserMedia / device error into an actionable category + a
 * human-readable message, so the call lobby can guide the user instead of
 * failing silently (the old VideoCall.join() swallowed every error in a
 * `console.warn`, which is why "no webcam, no prompt" looked like nothing
 * happened). Mirrors the monolith's `client/common/video/mediaErrors.ts`.
 */
export type MediaErrorKind =
  | 'denied' // user/OS blocked camera or mic
  | 'notFound' // no camera/mic connected
  | 'inUse' // device held by another app
  | 'overconstrained' // requested deviceId/constraints unsatisfiable
  | 'insecure' // not https / not a secure context
  | 'unsupported' // browser lacks mediaDevices (in-app webview, old browser)
  | 'unknown';

export interface ClassifiedMediaError {
  kind: MediaErrorKind;
  /** Short title for the lobby header. */
  title: string;
  /** One or two sentences telling the user what to do. */
  help: string;
  /** Whether retrying (re-request) is worthwhile vs. needing settings changes. */
  recoverable: boolean;
}

export function isSecureMediaContext(): boolean {
  if (typeof window === 'undefined') return false;
  // getUserMedia requires a secure context (https or localhost).
  return window.isSecureContext === true;
}

export function hasMediaDevices(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export function classifyMediaError(err: unknown): ClassifiedMediaError {
  if (!isSecureMediaContext()) {
    return {
      kind: 'insecure',
      title: 'Camera needs a secure connection',
      help: 'Video calls require an https connection. Reload over https and try again.',
      recoverable: false,
    };
  }
  if (!hasMediaDevices()) {
    return {
      kind: 'unsupported',
      title: 'Camera not supported here',
      help: 'This browser can’t access the camera. Open ugly.chat in Safari or Chrome instead of an in-app browser.',
      recoverable: false,
    };
  }

  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        kind: 'denied',
        title: 'Camera & mic are blocked',
        help: 'Permission was denied. Click the camera icon in your browser’s address bar (or Settings → site permissions) to allow camera and microphone, then retry.',
        recoverable: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        kind: 'notFound',
        title: 'No camera or mic found',
        help: 'No camera or microphone is connected. Plug one in (or check it’s enabled) and retry.',
        recoverable: true,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        kind: 'inUse',
        title: 'Camera is in use',
        help: 'Another app is using your camera or mic. Close it (Zoom, Meet, Photo Booth…) and retry.',
        recoverable: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        kind: 'overconstrained',
        title: 'Selected device unavailable',
        help: 'The chosen camera or mic isn’t available. Pick a different one below.',
        recoverable: true,
      };
    default:
      return {
        kind: 'unknown',
        title: 'Couldn’t start camera',
        help: 'Something went wrong accessing your camera or mic. Retry, or pick a different device below.',
        recoverable: true,
      };
  }
}
