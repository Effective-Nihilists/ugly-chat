/**
 * useAvDevices — camera/mic/speaker permission + enumeration + persisted
 * selection, for the pre-call lobby. Condenses the monolith's AVManager +
 * permission modules into one SSR-safe hook.
 *
 * The flow the lobby drives:
 *   1. `request()` → probe getUserMedia({video,audio}) to trigger the browser
 *      permission prompt, then immediately stop the probe tracks (the call
 *      acquires its own stream later) and enumerate labelled devices.
 *   2. user picks camera/mic/speaker → persisted to localStorage.
 *   3. lobby reads `selected` ids to build its preview + hands them to the call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyMediaError, hasMediaDevices, type ClassifiedMediaError } from './mediaErrors';

export type PermissionState = 'pending' | 'requesting' | 'granted' | 'denied';

export interface AvDevice {
  id: string;
  label: string;
}
export interface DevicePrefs {
  cameraId?: string | undefined;
  micId?: string | undefined;
  speakerId?: string | undefined;
}

const LS = { camera: 'uglychat:webcam', mic: 'uglychat:mic', speaker: 'uglychat:speaker' } as const;

function lsGet(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function lsSet(key: string, val: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* private mode — ignore */
  }
}

// Pick the persisted id if it still exists, else the first device.
function resolveSelected(list: AvDevice[], saved: string | undefined): string | undefined {
  if (list.length === 0) return undefined;
  if (saved && list.some((d) => d.id === saved)) return saved;
  return list[0]?.id;
}

export interface UseAvDevices {
  permission: PermissionState;
  error: ClassifiedMediaError | null;
  cameras: AvDevice[];
  mics: AvDevice[];
  speakers: AvDevice[];
  selected: DevicePrefs;
  /** Trigger the permission prompt + enumeration. Safe to call repeatedly. */
  request: () => Promise<boolean>;
  setCamera: (id: string) => void;
  setMic: (id: string) => void;
  setSpeaker: (id: string) => void;
}

export function useAvDevices(): UseAvDevices {
  const [permission, setPermission] = useState<PermissionState>('pending');
  const [error, setError] = useState<ClassifiedMediaError | null>(null);
  const [cameras, setCameras] = useState<AvDevice[]>([]);
  const [mics, setMics] = useState<AvDevice[]>([]);
  const [speakers, setSpeakers] = useState<AvDevice[]>([]);
  const [selected, setSelected] = useState<DevicePrefs>({
    cameraId: lsGet(LS.camera),
    micId: lsGet(LS.mic),
    speakerId: lsGet(LS.speaker),
  });

  const enumerate = useCallback(async () => {
    if (!hasMediaDevices()) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const toDev = (d: MediaDeviceInfo, fallback: string): AvDevice => ({
      id: d.deviceId,
      label: d.label || fallback,
    });
    const cams = devices.filter((d) => d.kind === 'videoinput').map((d, i) => toDev(d, `Camera ${i + 1}`));
    const microphones = devices.filter((d) => d.kind === 'audioinput').map((d, i) => toDev(d, `Microphone ${i + 1}`));
    const spk = devices.filter((d) => d.kind === 'audiooutput').map((d, i) => toDev(d, `Speaker ${i + 1}`));
    setCameras(cams);
    setMics(microphones);
    setSpeakers(spk);
    setSelected((prev) => ({
      cameraId: resolveSelected(cams, prev.cameraId ?? lsGet(LS.camera)),
      micId: resolveSelected(microphones, prev.micId ?? lsGet(LS.mic)),
      speakerId: resolveSelected(spk, prev.speakerId ?? lsGet(LS.speaker)),
    }));
  }, []);

  const request = useCallback(async (): Promise<boolean> => {
    if (!hasMediaDevices()) {
      setError(classifyMediaError(null));
      setPermission('denied');
      return false;
    }
    setPermission('requesting');
    setError(null);
    try {
      // Probe to trigger the prompt + unlock device labels; release immediately.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      probe.getTracks().forEach((t) => { t.stop(); });
      await enumerate();
      setPermission('granted');
      return true;
    } catch (err) {
      setError(classifyMediaError(err));
      setPermission('denied');
      // Even on a partial/denied grant some labels may be available.
      await enumerate().catch(() => undefined);
      return false;
    }
  }, [enumerate]);

  // Re-enumerate when devices are plugged/unplugged (only meaningful post-grant).
  useEffect(() => {
    if (!hasMediaDevices()) return undefined;
    const onChange = (): void => void enumerate().catch(() => undefined);
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => { navigator.mediaDevices.removeEventListener('devicechange', onChange); };
  }, [enumerate]);

  const setCamera = useCallback((id: string) => {
    lsSet(LS.camera, id);
    setSelected((p) => ({ ...p, cameraId: id }));
  }, []);
  const setMic = useCallback((id: string) => {
    lsSet(LS.mic, id);
    setSelected((p) => ({ ...p, micId: id }));
  }, []);
  const setSpeaker = useCallback((id: string) => {
    lsSet(LS.speaker, id);
    setSelected((p) => ({ ...p, speakerId: id }));
  }, []);

  // Keep a stable ref to avoid re-running consumers on every render.
  const reqRef = useRef(request);
  reqRef.current = request;

  return { permission, error, cameras, mics, speakers, selected, request, setCamera, setMic, setSpeaker };
}
