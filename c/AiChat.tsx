"use client";

import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Sparkles, Loader, User, Bot, X, Mic, MicOff, GitBranch } from "lucide-react";
import { pipelineSocket } from "@/l/websocket";
import { useWorkflowStore } from "@/l/workflowStore";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "I'm your Lumina co-pilot. I can help you build and refine your visual AI pipelines on-device. Try: 'Add a logic node that triggers if text contains danger'." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setLoading(true);

    const store = useWorkflowStore.getState();
    const activeWf = store.workflows.find(w => w.id === store.activeWorkflowId);

    // Thin out the workflow to save tokens and prevent truncation errors
    const thinWorkflow = activeWf ? {
      nodes: activeWf.nodes.map(n => ({
        id: n.id,
        type: n.type,
        data: n.data,
        position: n.position // AI needs to know relative positions
      })),
      edges: activeWf.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      }))
    } : null;

    pipelineSocket.send("chat_refine", {
      prompt: userMsg,
      current_workflow: thinWorkflow
    });
  };

  const toggleVoice = () => {
    if (!("webkitSpeechRecognition" in window)) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    
    if (isRecording) {
      setIsRecording(false);
      return;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
    };

    recognition.start();
  };

  useEffect(() => {
    const unsub = pipelineSocket.on("chat_result", (payload: any) => {
      setLoading(false);
      if (payload.response) {
        setMessages(prev => [...prev, { role: "assistant", content: payload.response }]);
      }
      if (payload.new_workflow) {
        // Ensure all nodes have valid positions to prevent ReactFlow crashes
        const safeNodes = (payload.new_workflow.nodes || []).map((n: any, idx: number) => ({
          ...n,
          position: {
            x: n.position?.x ?? 250,
            y: n.position?.y ?? (100 + (idx * 100))
          }
        }));
        // Apply the new workflow to the store
        const store = useWorkflowStore.getState();
        store.autosave(safeNodes, payload.new_workflow.edges || []);
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="flex flex-col h-full glass border-l border-white/5 w-[380px] shadow-2xl relative overflow-hidden font-sans">
      {/* Background Glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#4285F4]/10 via-transparent to-transparent opacity-50 pointer-events-none" />

      <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#4285F4]/20 rounded-lg">
            <Sparkles size={18} className="text-[#4285F4]" />
          </div>
          <h2 className="text-sm font-bold text-white tracking-widest uppercase">Lumina Co-Pilot</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 relative z-10" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center shadow-lg ${m.role === "assistant" ? "bg-gradient-to-br from-[#4285F4] to-[#A855F7] text-white" : "bg-gradient-to-br from-[#EA4335] to-[#FBBC05] text-white"}`}>
              {m.role === "assistant" ? <Bot size={16} /> : <User size={16} />}
            </div>
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm ${m.role === "assistant" ? "bg-white/5 text-slate-200 rounded-tl-sm border border-white/10 backdrop-blur-sm" : "bg-[#4285F4]/10 text-blue-50 rounded-tr-sm border border-[#4285F4]/30 backdrop-blur-sm"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4285F4] to-[#A855F7] text-white flex items-center justify-center shadow-lg animate-pulse">
              <Bot size={16} />
            </div>
            <div className="bg-white/5 px-4 py-3 rounded-2xl rounded-tl-sm border border-white/10 backdrop-blur-sm flex gap-1.5 items-center">
              <div className="w-2 h-2 rounded-full bg-[#4285F4]/80 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-[#4285F4]/80 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 rounded-full bg-[#4285F4]/80 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t border-white/10 bg-black/20 relative z-10">
        <div className="relative group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())}
            placeholder="Ask Lumina AI to modify..."
            className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 pr-12 text-[13px] text-slate-100 placeholder-slate-500 outline-none focus:border-[#4285F4]/60 focus:bg-black/60 focus:ring-4 focus:ring-[#4285F4]/10 transition-all resize-none h-24 scrollbar-none"
          />
          <button
            onClick={toggleVoice}
            className={`absolute right-12 bottom-3 p-2.5 rounded-xl transition-all shadow-lg ${isRecording ? "bg-red-500 text-white animate-pulse" : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"}`}
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="absolute right-3 bottom-3 p-2.5 rounded-xl bg-gradient-to-br from-[#4285F4] to-[#A855F7] text-white hover:opacity-90 disabled:opacity-30 disabled:grayscale transition-all shadow-lg hover:shadow-[#4285F4]/25"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
