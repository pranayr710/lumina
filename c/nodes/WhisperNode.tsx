"use client";

import React, { useState, useEffect, useRef } from "react";
import { Handle, Position } from "reactflow";
import { ListRestart, MessageSquareQuote } from "lucide-react";
import { useAudioStore } from "@/l/audioStore";
import { useWorkflowStore } from "@/l/workflowStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { pipelineSocket } from "@/l/websocket";
import NodeShell from "./NodeShell";

export default function WhisperNode({ id, selected, data }: any) {
  const [transcript, setTranscript] = useState(data.text || "Waiting for audio...");
  const [loading, setLoading] = useState(false);
  const lastProcessedRef = useRef<string>("");
  const setOutput = useNodeOutputStore(state => state.setOutput);

  useEffect(() => {
    const unsub = pipelineSocket.on("whisper_result", (payload: any) => {
      if (payload.node_id === id) {
        setTranscript(payload.text);
        setLoading(false);
        setOutput(id, payload.text);
      }
    });
    return () => unsub();
  }, [id, setOutput]);

  useEffect(() => {
    const checkAudio = () => {
      const { workflows, activeWorkflowId } = useWorkflowStore.getState();
      const activeWorkflow = workflows.find(wf => wf.id === activeWorkflowId);
      if (!activeWorkflow) return;
      
      const edges = activeWorkflow.edges;
      const myInEdges = edges.filter(e => e.target === id && e.targetHandle === "audio");
      
      if (myInEdges.length > 0) {
        const sourceNodeId = myInEdges[0].source;
        const audio = useAudioStore.getState().audio[sourceNodeId];
        
        if (audio && audio !== lastProcessedRef.current) {
          lastProcessedRef.current = audio;
          setLoading(true);
          pipelineSocket.send("whisper_stt", {
            node_id: id,
            audio: audio
          });
        }
      }
    };

    const interval = setInterval(checkAudio, 1000);
    return () => clearInterval(interval);
  }, [id]);

  return (
    <NodeShell
      accent="#34A853"
      title="Whisper STT"
      icon={<ListRestart size={16} />}
      status={loading ? "running" : transcript !== "Waiting for audio..." ? "running" : "idle"}
      selected={selected}
      width={320}
    >
      <Handle 
        type="target" 
        position={Position.Left} 
        id="audio" 
        className="w-3 h-3 bg-[#FBBC05] border-2 border-[#13131a]" 
      />

      <div className="p-1 font-sans">
        <div className="bg-[#0a0a0f] border border-[#282838] rounded-xl p-4 min-h-[100px] flex flex-col gap-3">
          <MessageSquareQuote size={20} className="text-slate-700" />
          <p className="text-sm text-slate-300 leading-relaxed italic font-sans">
            "{transcript}"
          </p>
        </div>
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="output" 
        className="w-3 h-3 bg-[#34A853] border-2 border-[#13131a]" 
      />
    </NodeShell>
  );
}
