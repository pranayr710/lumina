export const INDUSTRIAL_TEMPLATES = [
  {
    id: "smart-office-security",
    name: "Smart Office Security",
    description: "Face matching for entry + Slack notification for unrecognized faces.",
    nodes: [
      { id: "cam-1", type: "camera", position: { x: 100, y: 100 }, data: {} },
      { id: "face-1", type: "faceMatch", position: { x: 400, y: 100 }, data: { confidence: 70 } },
      { id: "logic-1", type: "logic", position: { x: 700, y: 100 }, data: { conditions: [{ id: "1", operator: "not_contains", value: "employee" }], mode: "any" } },
      { id: "slack-1", type: "slackAction", position: { x: 1000, y: 100 }, data: { text: "UNRECOGNIZED FACE DETECTED AT MAIN ENTRY" } }
    ],
    edges: [
      { id: "e1", source: "cam-1", target: "face-1", sourceHandle: "frames", targetHandle: "camera" },
      { id: "e2", source: "face-1", target: "logic-1", sourceHandle: "output", targetHandle: "input" },
      { id: "e3", source: "logic-1", target: "slack-1", sourceHandle: "match", targetHandle: "trigger" }
    ]
  },
  {
    id: "industrial-safety",
    name: "Industrial Safety Monitor",
    description: "Detection of missing PPE + SMS alert.",
    nodes: [
      { id: "cam-1", type: "camera", position: { x: 100, y: 300 }, data: {} },
      { id: "vlm-1", type: "visualLlm", position: { x: 400, y: 300 }, data: { prompt: "Is the worker wearing a helmet? Answer only 'yes' or 'no'.", interval: 5 } },
      { id: "logic-1", type: "logic", position: { x: 700, y: 300 }, data: { conditions: [{ id: "1", operator: "equals", value: "no" }], mode: "any" } },
      { id: "sms-1", type: "smsAction", position: { x: 1000, y: 300 }, data: { body: "SAFETY VIOLATION: NO HELMET DETECTED" } }
    ],
    edges: [
      { id: "e1", source: "cam-1", target: "vlm-1", sourceHandle: "frames", targetHandle: "camera" },
      { id: "e2", source: "vlm-1", target: "logic-1", sourceHandle: "response", targetHandle: "input" },
      { id: "e3", source: "logic-1", target: "sms-1", sourceHandle: "match", targetHandle: "trigger" }
    ]
  },
  {
    id: "inventory-logger",
    name: "AI Inventory Logger",
    description: "OCR tracking of box labels + logging to Google Sheets.",
    nodes: [
      { id: "cam-1", type: "camera", position: { x: 100, y: 500 }, data: {} },
      { id: "ocr-1", type: "ocr", position: { x: 400, y: 500 }, data: {} },
      { id: "gsheets-1", type: "googleSheetsAction", position: { x: 700, y: 500 }, data: { range: "Sheet1!A1" } }
    ],
    edges: [
      { id: "e1", source: "cam-1", target: "ocr-1", sourceHandle: "frames", targetHandle: "camera" },
      { id: "e2", source: "ocr-1", target: "gsheets-1", sourceHandle: "output", targetHandle: "trigger" }
    ]
  }
];
