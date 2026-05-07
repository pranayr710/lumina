"use client";

import React, { useState, useEffect } from "react";
import { Handle, Position } from "reactflow";
import { Wifi, Play, Square, Globe } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";

export default function IpCameraNode({ id, selected, data }: any) {
  const [url, setUrl] = useState(data.url || "rtsp://admin:password@192.168.1.100:554/live");
  const [active, setActive] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    const unsub = pipelineSocket.on("ip_camera_frame", (payload: any) => {
      if (payload.node_id === id) {
        setFrame(payload.image);
      }
    });
    return () => unsub();
  }, [id]);

  const toggle = () => {
    const newState = !active;
    setActive(newState);
    pipelineSocket.send("ip_camera_connect", {
      node_id: id,
      url,
      active: newState
    });
  };

  return (
    <NodeShell
      accent="#4285F4"
      title="IP Camera"
      icon={<Wifi size={16} />}
      status={active ? "running" : "idle"}
      selected={selected}
      width={360}
    >
      <div className="bg-[#0a0a0f] aspect-video rounded-lg overflow-hidden mb-4 relative font-sans">
        {frame ? (
          <img src={`data:image/jpeg;base64,${frame}`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-700">
            <Globe size={40} className="animate-pulse" />
          </div>
        )}
      </div>

      <div className="space-y-3 font-sans">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">RTSP / Stream URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={active}
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-md px-2.5 py-1.5 text-xs text-slate-300 outline-none focus:border-blue-500/40 nodrag"
          />
        </div>

        <button
          onClick={toggle}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
          style={{
            background: active ? "#ef444420" : "rgba(66, 133, 244, 0.15)",
            color: active ? "#ef4444" : "#4285F4",
            border: `1px solid ${active ? "#ef444430" : "rgba(66, 133, 244, 0.25)"}`,
          }}
        >
          {active ? <Square size={14} /> : <Play size={14} />}
          {active ? "Disconnect" : "Connect Stream"}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="frames" className="w-3 h-3 bg-[#4285F4] border-2 border-[#13131a]" />
    </NodeShell>
  );
}
