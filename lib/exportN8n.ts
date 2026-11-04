import type { Node, Edge } from "reactflow";

const BACKEND = "http://localhost:8000";

/**
 * Export the current Lumina canvas to a downloadable n8n workflow JSON.
 * Calls the Lumina backend which compiles the ReactFlow graph to n8n format.
 */
export async function exportToN8n(nodes: Node[], edges: Edge[]): Promise<void> {
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

  const response = await fetch(`${BACKEND}/api/export/n8n`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lumina-workflow.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Push the current canvas directly to a running n8n instance.
 * Requires N8N_MCP_TOKEN and N8N_INSTANCE_URL to be set on the backend.
 */
export async function pushToN8n(
  nodes: Node[],
  edges: Edge[]
): Promise<{ status: number; workflow_id?: string; error?: string }> {
  const graph = {
    nodes: nodes.map((n) => ({
      id: n.id, type: n.type, position: n.position, data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    })),
  };

  const response = await fetch(`${BACKEND}/api/export/n8n/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });

  return response.json();
}
