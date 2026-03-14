// ═══════════════════════════════════════════════════════════
// Supervisor unit tests
// ═══════════════════════════════════════════════════════════
//
// Tests the supervisor's ordering logic and state machine
// integration without making real agent calls.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reduceRunStatus,
  reduceSubagentState,
} from "../../orchestrator/stateMachine.js";

describe("State machine — Master Orchestrator transitions", () => {
  describe("reduceRunStatus", () => {
    it("plan_created → running", () => {
      assert.equal(reduceRunStatus("pending", { event: "plan_created" }), "running");
    });

    it("subtask_delegated while running → stays running", () => {
      assert.equal(reduceRunStatus("running", { event: "subtask_delegated" }), "running");
    });

    it("subtask_completed while running → stays running", () => {
      assert.equal(reduceRunStatus("running", { event: "subtask_completed" }), "running");
    });

    it("subtask_failed → failed", () => {
      assert.equal(reduceRunStatus("running", { event: "subtask_failed" }), "failed");
    });

    it("workflow_evaluated → completed", () => {
      assert.equal(reduceRunStatus("running", { event: "workflow_evaluated" }), "completed");
    });

    it("delegate_subtask command while running → stays running", () => {
      assert.equal(reduceRunStatus("running", { command: "delegate_subtask" }), "running");
    });

    it("evaluate_result command while running → stays running", () => {
      assert.equal(reduceRunStatus("running", { command: "evaluate_result" }), "running");
    });

    // Existing transitions still work
    it("start_task → running (existing)", () => {
      assert.equal(reduceRunStatus("pending", { command: "start_task" }), "running");
    });

    it("cancel → cancelled (existing)", () => {
      assert.equal(reduceRunStatus("running", { command: "cancel" }), "cancelled");
    });
  });

  describe("reduceSubagentState", () => {
    it("delegate_subtask → running", () => {
      assert.equal(reduceSubagentState("idle", { command: "delegate_subtask" }), "running");
    });

    it("subtask_delegated event → running", () => {
      assert.equal(reduceSubagentState("idle", { event: "subtask_delegated" }), "running");
    });

    it("subtask_failed event → error", () => {
      assert.equal(reduceSubagentState("running", { event: "subtask_failed" }), "error");
    });

    it("workflow_evaluated → idle", () => {
      assert.equal(reduceSubagentState("running", { event: "workflow_evaluated" }), "idle");
    });

    // Existing transitions still work
    it("start_task → running (existing)", () => {
      assert.equal(reduceSubagentState("idle", { command: "start_task" }), "running");
    });

    it("cancel → stopped (existing)", () => {
      assert.equal(reduceSubagentState("running", { command: "cancel" }), "stopped");
    });
  });
});

describe("Topological ordering logic", () => {
  // Extracted ordering logic for testing
  function orderByDeps(
    subtasks: Array<{ id: string; dependencies: string[]; priority: number }>
  ): string[] {
    const result: string[] = [];
    const done = new Set<string>();
    const remaining = [...subtasks];

    while (remaining.length > 0) {
      const ready = remaining.filter((st) =>
        st.dependencies.every((dep) => done.has(dep))
      );

      if (ready.length === 0) {
        throw new Error("Circular dependency detected");
      }

      ready.sort((a, b) => a.priority - b.priority);

      for (const st of ready) {
        result.push(st.id);
        done.add(st.id);
        const idx = remaining.indexOf(st);
        remaining.splice(idx, 1);
      }
    }

    return result;
  }

  it("should order independent tasks by priority", () => {
    const order = orderByDeps([
      { id: "st-3", dependencies: [], priority: 3 },
      { id: "st-1", dependencies: [], priority: 1 },
      { id: "st-2", dependencies: [], priority: 2 },
    ]);
    assert.deepEqual(order, ["st-1", "st-2", "st-3"]);
  });

  it("should respect dependencies over priority", () => {
    const order = orderByDeps([
      { id: "st-1", dependencies: [], priority: 2 },
      { id: "st-2", dependencies: ["st-1"], priority: 1 },
    ]);
    // st-1 must come first despite st-2 having higher priority
    assert.deepEqual(order, ["st-1", "st-2"]);
  });

  it("should handle chain dependencies", () => {
    const order = orderByDeps([
      { id: "st-3", dependencies: ["st-2"], priority: 1 },
      { id: "st-1", dependencies: [], priority: 1 },
      { id: "st-2", dependencies: ["st-1"], priority: 1 },
    ]);
    assert.deepEqual(order, ["st-1", "st-2", "st-3"]);
  });

  it("should detect circular dependencies", () => {
    assert.throws(() => {
      orderByDeps([
        { id: "st-1", dependencies: ["st-2"], priority: 1 },
        { id: "st-2", dependencies: ["st-1"], priority: 1 },
      ]);
    }, /Circular dependency/);
  });

  it("should handle single task", () => {
    const order = orderByDeps([
      { id: "st-1", dependencies: [], priority: 1 },
    ]);
    assert.deepEqual(order, ["st-1"]);
  });

  it("should handle diamond dependency", () => {
    // st-1 → st-2, st-3 → st-4
    const order = orderByDeps([
      { id: "st-4", dependencies: ["st-2", "st-3"], priority: 1 },
      { id: "st-2", dependencies: ["st-1"], priority: 1 },
      { id: "st-3", dependencies: ["st-1"], priority: 2 },
      { id: "st-1", dependencies: [], priority: 1 },
    ]);
    assert.equal(order[0], "st-1"); // must be first
    assert.equal(order[order.length - 1], "st-4"); // must be last
    // st-2 and st-3 can be in either order, but st-2 has lower priority
    assert.ok(order.indexOf("st-2") < order.indexOf("st-4"));
    assert.ok(order.indexOf("st-3") < order.indexOf("st-4"));
  });
});
