"use client";

import { useState } from "react";
import { ReactFlowProvider } from "reactflow";
import Canvas from "@/c/Canvas";
import LandingPage from "@/c/LandingPage";

export default function Home() {
  const [entered, setEntered] = useState(false);

  if (!entered) {
    return <LandingPage onEnter={() => setEntered(true)} />;
  }

  return (
    <ReactFlowProvider>
      <div className="h-screen w-screen overflow-hidden bg-[#030305]">
        <Canvas />
      </div>
    </ReactFlowProvider>
  );
}
