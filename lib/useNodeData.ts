"use client";

import { useCallback } from "react";
import { useReactFlow } from "reactflow";

/**
 * Returns an `updateData` function that persists key-value pairs
 * back into the ReactFlow node's `data` object so autosave captures them.
 *
 * Returns the SAME nodes array reference when nothing changed,
 * which makes React bail out of re-rendering entirely — preventing infinite loops.
 */
export function useNodeData(nodeId: string) {
  const { setNodes } = useReactFlow();

  return useCallback(
    (updates: Record<string, any>) => {
      setNodes((nodes) => {
        let changed = false;
        const result = nodes.map((n) => {
          if (n.id !== nodeId) return n;

          // Check if every value is already identical
          const allSame = Object.keys(updates).every((key) => {
            const oldVal = n.data[key];
            const newVal = updates[key];
            if (oldVal === newVal) return true;
            if (
              typeof oldVal === "object" &&
              typeof newVal === "object" &&
              oldVal !== null &&
              newVal !== null
            ) {
              try {
                return JSON.stringify(oldVal) === JSON.stringify(newVal);
              } catch {
                return false;
              }
            }
            return false;
          });

          if (allSame) return n;
          changed = true;
          return { ...n, data: { ...n.data, ...updates } };
        });

        // Return same reference if nothing changed — React skips re-render
        return changed ? result : nodes;
      });
    },
    [nodeId, setNodes]
  );
}
