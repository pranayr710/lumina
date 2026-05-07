"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Aperture, Download, Camera } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useFrameStore } from "@/l/frameStore";

export default function ScreenshotNode({ id, selected }: NodeProps) {
  const [savedCount, setSavedCount] = useState(0);
  const [lastThumbnail, setLastThumbnail] = useState<string | null>(null);
  const [triggerCount, setTriggerCount] = useState(0);
  const lastSaveRef = useRef<number>(0);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");
  const edges = useEdges();

  const cameraSourceId = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "camera");
    return edge?.source ?? null;
  }, [edges, id]);

  const captureScreenshot = useCallback(() => {
    if (!cameraSourceId) return;
    const frame = useFrameStore.getState().getFrame(cameraSourceId);
    if (!frame) return;

    const now = Date.now();
    if (now - lastSaveRef.current < 2000) return;
    lastSaveRef.current = now;

    setLastThumbnail(`data:image/jpeg;base64,${frame}`);
    setSavedCount((c) => c + 1);

    const a = document.createElement("a");
    a.href = `data:image/jpeg;base64,${frame}`;
    a.download = `lumina-screenshot-${Date.now()}.jpg`;
    a.click();
  }, [cameraSourceId]);

  useEffect(() => {
    if (!sourceOutput || sourceVersion === 0) return;
    setTriggerCount((c) => c + 1);
    captureScreenshot();
  }, [sourceVersion]);

  return (
    <NodeShell
      accent="#4285F4"
      title="Screenshot"
      icon={<Aperture size={16} />}
      status={triggerCount > 0 ? "running" : "idle"}
      selected={selected}
      width={340}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="camera"
        data-tooltip="camera"
        style={{ background: "#4285F4", border: "2px solid #13131a", top: "35%" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        data-tooltip="trigger"
        style={{ background: "#FBBC05", border: "2px solid #13131a", top: "65%" }}
      />

      {!cameraSourceId && (
        <div className="flex items-center gap-2 mb-3 px-2.5 py-2 rounded-md font-sans" style={{ background: "#0a0a0f", border: "1px solid #1e1e2e" }}>
          <Camera size={14} className="text-slate-600" />
          <span className="text-xs text-slate-500">Connect a camera or video source</span>
        </div>
      )}

      {lastThumbnail && (
        <div className="relative rounded-lg overflow-hidden mb-3 font-sans" style={{ aspectRatio: "16/9", background: "#0a0a0f" }}>
          <img src={lastThumbnail} alt="Last capture" className="w-full h-full object-cover" />
          <div className="absolute top-1.5 left-1.5 bg-black/70 text-[9px] text-[#4285F4] px-1.5 py-0.5 rounded font-mono">
            Last capture
          </div>
        </div>
      )}

      <button
        onClick={() => {
          lastSaveRef.current = 0;
          captureScreenshot();
        }}
        disabled={!cameraSourceId}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors nodrag disabled:opacity-40 cursor-pointer font-sans"
        style={{ background: "rgba(66, 133, 244, 0.15)", color: "#4285F4", border: "1px solid rgba(66, 133, 244, 0.25)" }}
      >
        <Download size={12} />
        Capture Now
      </button>

      <div className="mt-3 flex items-center justify-between font-sans">
        <span className="text-xs font-mono text-blue-500/70">{savedCount} saved</span>
        <span className="text-xs font-mono text-slate-500">{triggerCount} triggers</span>
      </div>
    </NodeShell>
  );
}
