/**
 * CaptureRegistry — Global singleton that holds parked captures across workflow switches.
 *
 * When a workflow switch happens, input nodes (camera, video, mic) park their captures
 * here instead of destroying them. The captures keep running in the background, writing
 * frames/audio to workflow-namespaced store keys (e.g. "wf-123::camera-1").
 *
 * When the user switches back, nodes reclaim their parked captures and resume writing
 * to plain keys for downstream node compatibility.
 */

import type { FrameCapture } from "./frameCapture";
import type { AudioCapture } from "./audioCapture";
import { useFrameStore } from "./frameStore";
import { useAudioStore } from "./audioStore";

// ─── Parked capture types ───

export interface ParkedCamera {
  type: "camera";
  capture: FrameCapture;
  nodeId: string;
  workflowId: string;
}

export interface ParkedVideo {
  type: "video";
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  intervalId: ReturnType<typeof setInterval> | null;
  objectUrl: string;
  fileName: string;
  fps: number;
  active: boolean;
  nodeId: string;
  workflowId: string;
}

export interface ParkedMic {
  type: "mic";
  capture: AudioCapture;
  nodeId: string;
  workflowId: string;
}

export interface ParkedAudioFile {
  type: "audioFile";
  decodedPcm: Float32Array;
  objectUrl: string;
  fileName: string;
  intervalId: ReturnType<typeof setInterval> | null;
  position: number;
  active: boolean;
  loop: boolean;
  nodeId: string;
  workflowId: string;
}

export type ParkedCapture = ParkedCamera | ParkedVideo | ParkedMic | ParkedAudioFile;

// ─── Global switch state ───

let _switching = false;
let _switchFromWorkflowId: string | null = null;

// ─── Parked captures registry ───

const _parked = new Map<string, ParkedCapture>();

function makeKey(workflowId: string, nodeId: string): string {
  return `${workflowId}::${nodeId}`;
}

/** Call BEFORE clearing the canvas during a workflow switch. */
export function prepareSwitch(fromWorkflowId: string) {
  _switching = true;
  _switchFromWorkflowId = fromWorkflowId;
}

/** Call AFTER the new workflow's nodes have been set. */
export function completeSwitch() {
  _switching = false;
  _switchFromWorkflowId = null;
}

/** Check if we're currently in the middle of a workflow switch. */
export function isSwitching(): boolean {
  return _switching;
}

/** Get the workflow ID we're switching away from. */
export function getSwitchFromWorkflowId(): string | null {
  return _switchFromWorkflowId;
}

/** Park a capture so it survives component unmount. */
export function parkCapture(
  workflowId: string,
  nodeId: string,
  entry: ParkedCapture
) {
  _parked.set(makeKey(workflowId, nodeId), entry);
}

/** Reclaim a previously parked capture (removes it from the registry). */
export function reclaimCapture(
  workflowId: string,
  nodeId: string
): ParkedCapture | undefined {
  const key = makeKey(workflowId, nodeId);
  const entry = _parked.get(key);
  if (entry) _parked.delete(key);
  return entry;
}

/** Peek at a parked capture without removing it. */
export function getParked(
  workflowId: string,
  nodeId: string
): ParkedCapture | undefined {
  return _parked.get(makeKey(workflowId, nodeId));
}

/** Destroy all parked captures for a specific workflow (e.g. on workflow delete). */
export function destroyWorkflowCaptures(workflowId: string) {
  for (const [key, entry] of _parked.entries()) {
    if (entry.workflowId !== workflowId) continue;

    const nsKey = makeKey(workflowId, entry.nodeId);

    if (entry.type === "camera") {
      entry.capture.destroy();
      useFrameStore.getState().removeFrame(nsKey);
    } else if (entry.type === "video") {
      if (entry.intervalId) clearInterval(entry.intervalId);
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.load();
      URL.revokeObjectURL(entry.objectUrl);
      useFrameStore.getState().removeFrame(nsKey);
    } else if (entry.type === "mic") {
      entry.capture.destroy();
      useAudioStore.getState().removeAudio(nsKey);
    } else if (entry.type === "audioFile") {
      if (entry.intervalId) clearInterval(entry.intervalId);
      URL.revokeObjectURL(entry.objectUrl);
      useAudioStore.getState().removeAudio(nsKey);
    }

    _parked.delete(key);
  }
}

/** Destroy ALL parked captures (e.g. on app shutdown). */
export function destroyAllCaptures() {
  for (const [, entry] of _parked.entries()) {
    if (entry.type === "camera") {
      entry.capture.destroy();
    } else if (entry.type === "video") {
      if (entry.intervalId) clearInterval(entry.intervalId);
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.load();
      URL.revokeObjectURL(entry.objectUrl);
    } else if (entry.type === "mic") {
      entry.capture.destroy();
    } else if (entry.type === "audioFile") {
      if (entry.intervalId) clearInterval(entry.intervalId);
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
  _parked.clear();
}
