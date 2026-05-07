"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { UserCheck, UserMinus, Camera, Loader, CheckCircle2, AlertCircle } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useFrameStore } from "@/l/frameStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";

export default function FaceMatchNode({ id, selected, data }: NodeProps) {
  const [referenceImage, setReferenceImage] = useState<string | null>(data.referenceImage || null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ match: boolean; confidence: number } | null>(null);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ referenceImage });
  }, [referenceImage, updateData]);

  const edges = useEdges();
  const camEdge = edges.find(e => e.target === id && e.targetHandle === "camera");
  const sourceNodeId = camEdge?.source || null;

  const enrollFace = useCallback(() => {
    if (!sourceNodeId) return;
    const frame = useFrameStore.getState().frames[sourceNodeId];
    if (frame) {
      setReferenceImage(`data:image/jpeg;base64,${frame}`);
      setResult(null);
    }
  }, [sourceNodeId]);

  const runMatch = useCallback(() => {
    if (!sourceNodeId || !referenceImage || processing) return;
    const currentFrame = useFrameStore.getState().frames[sourceNodeId];
    if (!currentFrame) return;

    setProcessing(true);
    
    const canvas = document.createElement("canvas");
    const img1 = new Image();
    const img2 = new Image();
    
    img1.src = referenceImage;
    img2.src = `data:image/jpeg;base64,${currentFrame}`;

    Promise.all([
      new Promise(resolve => img1.onload = resolve),
      new Promise(resolve => img2.onload = resolve)
    ]).then(() => {
      canvas.width = img1.width + img2.width;
      canvas.height = Math.max(img1.height, img2.height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img1, 0, 0);
        ctx.drawImage(img2, img1.width, 0);
        const combined = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
        
        pipelineSocket.send("vlm_analyze", {
          node_id: id,
          prompt: "The left half of this image is a reference face. The right half is a person being verified. Are they the same person? Return a JSON object with 'match' (boolean) and 'confidence' (0-100). Return ONLY JSON.",
          image: combined
        });
      }
    });
  }, [id, sourceNodeId, referenceImage, processing]);

  const { sourceVersion: triggerVersion } = useUpstreamTrigger(id, "trigger");
  useEffect(() => {
    if (triggerVersion > 0) runMatch();
  }, [triggerVersion, runMatch]);

  useEffect(() => {
    const unsub = pipelineSocket.on("vlm_result", (payload: any) => {
      if (payload.node_id === id) {
        setProcessing(false);
        try {
          const match = payload.analysis.match(/\{[\s\S]*\}/);
          if (match) {
            const data = JSON.parse(match[0]);
            setResult({ match: data.match, confidence: data.confidence });
            useNodeOutputStore.getState().setOutput(id, data.match ? "match" : "no_match");
          }
        } catch (e) {
          console.error("Face match parse error:", e);
        }
      }
    });
    return () => unsub();
  }, [id]);

  return (
    <NodeShell
      accent="#34A853"
      title="Face Matcher"
      icon={<UserCheck size={16} />}
      status={processing ? "running" : result?.match ? "running" : "idle"}
      selected={selected}
      width={340}
    >
      <Handle type="target" position={Position.Left} id="camera" style={{ top: "30%", background: "#4285F4" }} />
      <Handle type="target" position={Position.Left} id="trigger" style={{ top: "70%", background: "#FBBC05" }} />

      <div className="space-y-4 font-sans">
        <div className="space-y-2 font-sans">
          <div className="flex items-center justify-between font-sans">
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Reference (Enrolled)</label>
            <button 
              onClick={enrollFace}
              className="text-[9px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded border border-emerald-500/20 hover:bg-emerald-500/20 transition-all flex items-center gap-1 cursor-pointer font-sans"
            >
              <Camera size={10} />
              Enroll Face
            </button>
          </div>
          <div className="aspect-square bg-black rounded-lg overflow-hidden border border-[#1e1e2e] relative group">
            {referenceImage ? (
              <img src={referenceImage} className="w-full h-full object-cover" alt="Reference" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700">
                <UserMinus size={32} className="mb-2 opacity-20" />
                <p className="text-[9px] uppercase font-bold tracking-tighter opacity-40">No Reference</p>
              </div>
            )}
            {referenceImage && (
              <div className="absolute inset-0 bg-emerald-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                 <CheckCircle2 size={32} className="text-emerald-400" />
              </div>
            )}
          </div>
        </div>

        <div className={`p-3 rounded-xl border transition-all ${
          processing ? "bg-purple-500/5 border-purple-500/20" :
          result?.match ? "bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-emerald-500/5" :
          result ? "bg-red-500/5 border-red-500/20" :
          "bg-black/20 border-white/5"
        }`}>
          {processing ? (
            <div className="flex items-center gap-3">
              <Loader size={18} className="animate-spin text-purple-500" />
              <div className="flex-1">
                <p className="text-[10px] font-bold text-purple-400 uppercase">Analyzing Identity</p>
                <p className="text-[9px] text-slate-500 italic">Comparing with reference...</p>
              </div>
            </div>
          ) : result ? (
            <div className="flex items-center gap-3 font-sans">
              <div className={`p-1.5 rounded-lg ${result.match ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
                {result.match ? <UserCheck size={18} /> : <AlertCircle size={18} />}
              </div>
              <div className="flex-1 font-sans">
                <p className={`text-[10px] font-bold uppercase ${result.match ? "text-emerald-400" : "text-red-400"}`}>
                  {result.match ? "Identity Confirmed" : "Identity Mismatch"}
                </p>
                <p className="text-[9px] font-mono text-slate-500">Confidence: {result.confidence}%</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-slate-600 font-sans">
              <UserCheck size={18} />
              <p className="text-[10px] uppercase tracking-tight font-sans">Ready to match</p>
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="output" className="w-3 h-3 bg-emerald-500 border-2 border-[#13131a]" />
    </NodeShell>
  );
}
