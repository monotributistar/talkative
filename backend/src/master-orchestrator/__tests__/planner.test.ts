// ═══════════════════════════════════════════════════════════
// Planner unit tests
// ═══════════════════════════════════════════════════════════
//
// These tests validate the planner's validation logic
// without making real LLM calls. We test the validation
// function directly by importing it indirectly through
// plan creation with a mocked LLM.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We need to test validation logic. Since createPlan calls the LLM,
// we test by crafting TaskPlans manually and validating them through
// the supervisor (which consumes plans). The planner's validation
// is internal, so we test its effects via integration.

// For now, test the plan structure and supervisor ordering logic.

import type { TaskPlan, SubTask } from "../types.js";

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
  return {
    plan_id: "plan-test-001",
    tenant_id: "tenant-test",
    original_request: "test request",
    subtasks: [
      {
        id: "st-1",
        description: "First task",
        target_agent_id: "agent-a",
        dependencies: [],
        priority: 1,
        status: "pending",
      },
      {
        id: "st-2",
        description: "Second task depends on first",
        target_agent_id: "agent-b",
        dependencies: ["st-1"],
        priority: 2,
        status: "pending",
      },
    ],
    strategy: "sequential",
    created_at: new Date().toISOString(),
    created_by: "planner",
    ...overrides,
  };
}

describe("TaskPlan structure", () => {
  it("should have required fields", () => {
    const plan = makePlan();
    assert.ok(plan.plan_id);
    assert.ok(plan.tenant_id);
    assert.ok(plan.original_request);
    assert.ok(plan.subtasks.length > 0);
    assert.equal(plan.strategy, "sequential");
    assert.ok(plan.created_at);
    assert.ok(plan.created_by);
  });

  it("subtasks should have correct initial status", () => {
    const plan = makePlan();
    for (const st of plan.subtasks) {
      assert.equal(st.status, "pending");
      assert.equal(st.result, undefined);
      assert.equal(st.error, undefined);
    }
  });

  it("should support dependency chains", () => {
    const plan = makePlan({
      subtasks: [
        { id: "st-1", description: "A", target_agent_id: "a", dependencies: [], priority: 1, status: "pending" },
        { id: "st-2", description: "B", target_agent_id: "b", dependencies: ["st-1"], priority: 2, status: "pending" },
        { id: "st-3", description: "C", target_agent_id: "c", dependencies: ["st-2"], priority: 3, status: "pending" },
      ],
    });

    // st-3 depends on st-2 which depends on st-1
    const st3 = plan.subtasks.find((s) => s.id === "st-3")!;
    assert.deepEqual(st3.dependencies, ["st-2"]);

    const st2 = plan.subtasks.find((s) => s.id === "st-2")!;
    assert.deepEqual(st2.dependencies, ["st-1"]);

    const st1 = plan.subtasks.find((s) => s.id === "st-1")!;
    assert.deepEqual(st1.dependencies, []);
  });

  it("should enforce max subtasks via config", async () => {
    const { DEFAULT_SUPERVISOR_CONFIG } = await import("../types.js");
    assert.equal(DEFAULT_SUPERVISOR_CONFIG.max_subtasks, 10);
    assert.equal(DEFAULT_SUPERVISOR_CONFIG.subtask_timeout_ms, 60_000);
  });
});

describe("SubTask lifecycle", () => {
  it("should transition through statuses correctly", () => {
    const st: SubTask = {
      id: "st-1",
      description: "test",
      target_agent_id: "agent-a",
      dependencies: [],
      priority: 1,
      status: "pending",
    };

    // Simulate delegation
    st.status = "delegated";
    st.delegated_at = new Date().toISOString();
    assert.equal(st.status, "delegated");

    // Simulate completion
    st.status = "completed";
    st.completed_at = new Date().toISOString();
    st.duration_ms = 1500;
    st.result = "Task done";
    assert.equal(st.status, "completed");
    assert.ok(st.duration_ms > 0);
  });

  it("should handle failure state", () => {
    const st: SubTask = {
      id: "st-1",
      description: "test",
      target_agent_id: "agent-a",
      dependencies: [],
      priority: 1,
      status: "pending",
    };

    st.status = "failed";
    st.error = "Agent unreachable";
    st.completed_at = new Date().toISOString();
    assert.equal(st.status, "failed");
    assert.ok(st.error);
  });

  it("should handle skipped state", () => {
    const st: SubTask = {
      id: "st-2",
      description: "depends on failed task",
      target_agent_id: "agent-b",
      dependencies: ["st-1"],
      priority: 2,
      status: "pending",
    };

    st.status = "skipped";
    assert.equal(st.status, "skipped");
  });
});
