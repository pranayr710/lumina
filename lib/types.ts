export interface BackendStatus {
  connected: boolean;
  vlm_loaded: boolean;
  npu_active: boolean;
}

export type NodeCategory = "input" | "ai" | "logic" | "output";

export interface NodeTypeInfo {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  accent: string;
  icon: string;
}

export interface LogicCondition {
  id: string;
  operator: "contains" | "not_contains" | "equals" | "starts_with" | "regex";
  value: string;
}

export interface WorkflowNodeData {
  prompt?: string;
  interval?: number;
  conditions?: LogicCondition[];
  mode?: "any" | "all";
  systemPrompt?: string;
  webhookUrl?: string;
  soundPreset?: string;
  emailTo?: string;
  emailSubject?: string;
  smsTo?: string;
  code?: string;
}

export const NODE_CATALOG: NodeTypeInfo[] = [
  {
    type: "camera",
    label: "Camera",
    description: "Live camera feed",
    category: "input",
    accent: "#4285F4", // Google Blue
    icon: "Camera",
  },
  {
    type: "video",
    label: "Video Input",
    description: "Play video file as camera input",
    category: "input",
    accent: "#00E5FF", // Cyan
    icon: "Film",
  },
  {
    type: "detection",
    label: "Object Detect",
    description: "YOLO object detection (NPU)",
    category: "ai",
    accent: "#FBBC05", // Google Yellow / Amber
    icon: "ScanSearch",
  },
  {
    type: "visualLlm",
    label: "Visual LLM (Gemini/VLM)",
    description: "Vision AI analysis of camera feed",
    category: "ai",
    accent: "#8A2BE2", // Gemini Purple/Violet
    icon: "Eye",
  },
  {
    type: "llm",
    label: "LLM (Gemini/Llama)",
    description: "Text generation & processing",
    category: "ai",
    accent: "#4285F4", // Google Blue
    icon: "MessageSquare",
  },
  {
    type: "timer",
    label: "Timer / Schedule",
    description: "Time-based triggers",
    category: "logic",
    accent: "#FF5722", // Cyber Orange
    icon: "Timer",
  },
  {
    type: "logic",
    label: "Logic",
    description: "Conditional routing (if/then)",
    category: "logic",
    accent: "#FBBC05", // Google Yellow
    icon: "GitBranch",
  },
  {
    type: "mic",
    label: "Microphone",
    description: "Live audio capture",
    category: "input",
    accent: "#00E5FF", // Cyan
    icon: "Mic",
  },
  {
    type: "audioFile",
    label: "Audio Input",
    description: "Play audio file as mic input",
    category: "input",
    accent: "#4285F4", // Google Blue
    icon: "Music",
  },
  {
    type: "audioDetect",
    label: "Audio Detect",
    description: "YamNet sound classification (ONNX)",
    category: "ai",
    accent: "#8A2BE2", // Violet
    icon: "AudioLines",
  },
  {
    type: "audioLlm",
    label: "Audio LLM",
    description: "AI audio understanding (OmniNeural)",
    category: "ai",
    accent: "#FF4081", // Neon Pink
    icon: "Ear",
  },
  {
    type: "soundAction",
    label: "Sound Alert",
    description: "Play alert sound when triggered",
    category: "output",
    accent: "#EA4335", // Google Red
    icon: "Volume2",
  },
  {
    type: "logAction",
    label: "Log",
    description: "Timestamped event log with CSV export",
    category: "output",
    accent: "#34A853", // Google Green
    icon: "FileText",
  },
  {
    type: "notifyAction",
    label: "Notification",
    description: "Desktop notification alert",
    category: "output",
    accent: "#FBBC05", // Google Yellow
    icon: "Bell",
  },
  {
    type: "screenshotAction",
    label: "Screenshot",
    description: "Capture and save camera frames",
    category: "output",
    accent: "#00E5FF", // Cyan
    icon: "Aperture",
  },
  {
    type: "webhookAction",
    label: "Webhook",
    description: "HTTP POST to external URL",
    category: "output",
    accent: "#8A2BE2", // Violet
    icon: "Webhook",
  },
  {
    type: "emailAction",
    label: "Email",
    description: "Send email alert (needs internet)",
    category: "output",
    accent: "#4285F4", // Google Blue
    icon: "Mail",
  },
  {
    type: "smsAction",
    label: "SMS",
    description: "Send SMS via Twilio (needs internet)",
    category: "output",
    accent: "#00E5FF", // Cyan
    icon: "MessageCircle",
  },
  {
    type: "whisperStt",
    label: "Whisper STT",
    description: "High-accuracy local transcription",
    category: "ai",
    accent: "#34A853", // Google Green
    icon: "ListRestart",
  },
  {
    type: "faceMatch",
    label: "Face Match (VLM)",
    description: "Compare faces against reference",
    category: "ai",
    accent: "#34A853", // Google Green
    icon: "UserCheck",
  },
  {
    type: "pose",
    label: "Pose / Safety",
    description: "Detect human poses & falls",
    category: "ai",
    accent: "#00E5FF", // Cyan
    icon: "Accessibility",
  },
  {
    type: "ocr",
    label: "OCR / Text (VLM)",
    description: "Extract text from images (VLM)",
    category: "ai",
    accent: "#8A2BE2", // Violet
    icon: "Type",
  },
  {
    type: "script",
    label: "Python Script",
    description: "Run custom Python logic",
    category: "logic",
    accent: "#EA4335", // Google Red
    icon: "Code2",
  },
  {
    type: "ipCamera",
    label: "IP Camera",
    description: "Connect via RTSP / HTTP stream",
    category: "input",
    accent: "#4285F4", // Google Blue
    icon: "Globe",
  },
  {
    type: "debounce",
    label: "Debounce",
    description: "Rate limit triggers (cooldown)",
    category: "logic",
    accent: "#FF5722", // Cyber Orange
    icon: "Timer",
  },
  {
    type: "merge",
    label: "Merge",
    description: "Combine multiple inputs (AND/OR)",
    category: "logic",
    accent: "#8A2BE2", // Violet
    icon: "GitMerge",
  },
  {
    type: "fileAction",
    label: "File Save",
    description: "Append data to local CSV/TXT",
    category: "output",
    accent: "#607D8B", // Steel Grey
    icon: "FileOutput",
  },
  {
    type: "mqttAction",
    label: "MQTT Publish",
    description: "Send alerts to IoT brokers",
    category: "output",
    accent: "#00E5FF", // Cyan
    icon: "Radio",
  },
  {
    type: "speakAction",
    label: "Speak / TTS",
    description: "Voice output via browser",
    category: "output",
    accent: "#8A2BE2", // Violet
    icon: "Volume2",
  },
  {
    type: "discordAction",
    label: "Discord",
    description: "Send Discord webhooks",
    category: "output",
    accent: "#5865F2", // Discord Blue/Purple
    icon: "MessageSquare",
  },
  {
    type: "slackAction",
    label: "Slack",
    description: "Send Slack messages",
    category: "output",
    accent: "#E01E5A", // Slack Red
    icon: "Slack",
  },
  {
    type: "googleSheetsAction",
    label: "Google Sheets",
    description: "Append data to a Sheet",
    category: "output",
    accent: "#34A853", // Google Green
    icon: "Table",
  },
  // ── Hackathon additions ──────────────────────────────────────────────────
  {
    type: "geminiLive",
    label: "Gemini Live",
    description: "Real-time bidirectional Gemini streaming",
    category: "ai",
    accent: "#FBBC05",
    icon: "Zap",
  },
  {
    type: "toolUse",
    label: "Tool Use",
    description: "Gemini function calling — invoke external tools",
    category: "ai",
    accent: "#6366F1",
    icon: "Wrench",
  },
];
