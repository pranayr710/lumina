import { useMemo } from "react";
import { useEdges } from "reactflow";
import { useNodeOutputStore } from "@/lib/nodeOutputStore";

/**
 * Shared hook for action nodes to subscribe to upstream output changes.
 * Finds the incoming edge on `targetHandleId`, resolves compound keys
 * (Logic node match/no_match), and returns the latest output + version.
 */
export function useUpstreamTrigger(nodeId: string, targetHandleId: string) {
  const edges = useEdges();

  const { sourceNodeId, sourceHandle } = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === nodeId && e.targetHandle === targetHandleId
    );
    return {
      sourceNodeId: incomingEdge?.source ?? null,
      sourceHandle: incomingEdge?.sourceHandle ?? null,
    };
  }, [edges, nodeId, targetHandleId]);

  const outputKey = useMemo(() => {
    if (!sourceNodeId) return null;
    if (
      sourceHandle &&
      sourceHandle !== "response" &&
      sourceHandle !== "output"
    ) {
      return `${sourceNodeId}:${sourceHandle}`;
    }
    return sourceNodeId;
  }, [sourceNodeId, sourceHandle]);

  const sourceOutput = useNodeOutputStore(
    (state) => (outputKey ? state.outputs[outputKey] : undefined)
  );
  const sourceVersion = useNodeOutputStore(
    (state) => (outputKey ? (state.versions[outputKey] ?? 0) : 0)
  );

  return { sourceOutput, sourceVersion, sourceNodeId };
}
