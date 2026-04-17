import type { Hono } from "hono";
import * as teamService from "../team-service.js";

export function registerTeamRoutes(api: Hono): void {
  api.get("/teams", (c) => {
    return c.json(teamService.listTeams());
  });

  api.get("/teams/:id", (c) => {
    const team = teamService.getTeam(c.req.param("id"));
    if (!team) return c.json({ error: "Team not found" }, 404);
    return c.json(team);
  });

  api.get("/teams/:id/status", (c) => {
    const status = teamService.getTeamStatus(c.req.param("id"));
    if (!status) return c.json({ error: "Team not found" }, 404);
    return c.json(status);
  });

  api.post("/teams", async (c) => {
    const body = await c.req.json();
    const team = teamService.createTeam({
      goal: body.goal,
      repoRoot: body.repoRoot || body.cwd,
      baseBranch: body.baseBranch,
      suggestedAgents: body.suggestedAgents,
    });
    return c.json(team, 201);
  });

  api.put("/teams/:id", async (c) => {
    const body = await c.req.json();
    const team = teamService.updateTeamState(c.req.param("id"), body.state, body);
    if (!team) return c.json({ error: "Team not found" }, 404);
    return c.json(team);
  });

  api.put("/teams/:id/tasks/:taskId", async (c) => {
    const body = await c.req.json();
    const team = teamService.updateTask(c.req.param("id"), c.req.param("taskId"), body);
    if (!team) return c.json({ error: "Team or task not found" }, 404);
    return c.json(team);
  });

  api.post("/teams/:id/complete", async (c) => {
    const body = await c.req.json();
    const team = teamService.updateTeamState(c.req.param("id"), "completed", {
      result: body.result,
      completedAt: Date.now(),
    });
    if (!team) return c.json({ error: "Team not found" }, 404);
    return c.json(team);
  });

  api.post("/teams/:id/fail", async (c) => {
    const body = await c.req.json();
    const team = teamService.updateTeamState(c.req.param("id"), "failed", {
      error: body.error,
      completedAt: Date.now(),
    });
    if (!team) return c.json({ error: "Team not found" }, 404);
    return c.json(team);
  });

  api.delete("/teams/:id", (c) => {
    const success = teamService.deleteTeam(c.req.param("id"));
    if (!success) return c.json({ error: "Team not found" }, 404);
    return c.json({ ok: true });
  });
}
