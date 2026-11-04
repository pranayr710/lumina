import type { Node, Edge } from "reactflow";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

/**
 * Export the current Lumina canvas to a downloadable Node-RED flow JSON.
 *
 * Node-RED import: Menu → Import → paste JSON → Import nodes.
 * The downloaded file contains a flat JSON array — the correct format
 * for Node-RED's built-in import dialog.
 */
export async function exportToNodeRed(nodes: Node[], edges: Edge[]): Promise<void> {
  const graph = {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  const response = await fetch(`${BACKEND}/api/export/nodered`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });

  if (!response.ok) {
    throw new Error(`Node-RED export failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lumina-nodered-flow.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
