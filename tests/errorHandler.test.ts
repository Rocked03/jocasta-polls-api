import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";

import { createApp } from "@/app";
import { NotFoundError } from "@/errors";
import { errorHandler } from "@/middleware/errorHandler";

let app: Express;
const TOKEN = process.env.BOT_SERVICE_TOKEN!;

beforeAll(async () => {
  app = await createApp();
});

function mockRes(headersSent = false) {
  return {
    headersSent,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("errorHandler middleware", () => {
  it("responds with an ApiError's own status and message shape", () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    errorHandler(new NotFoundError("Poll not found"), {} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Poll not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("maps unknown errors to a generic 500 and logs them", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    const error = new Error("boom");

    try {
      errorHandler(error, {} as Request, res, next);

      expect(consoleSpy).toHaveBeenCalledWith(error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "An unexpected error occurred",
      });
      expect(next).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("defers to next(error) without writing when headers are already sent", () => {
    const res = mockRes(true);
    const next = vi.fn() as NextFunction;
    const error = new Error("too late");

    errorHandler(error, {} as Request, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("errorHandler route integration (typed service errors, no string matching)", () => {
  it("web votes route maps unknown poll ids to 404, not 500", async () => {
    const response = await request(app).get("/api/v1/polls/999/votes");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Poll not found" });
  });

  it("web votes route maps hidden-voting polls to 403 via ForbiddenError", async () => {
    // P2 is the hidden-voting fixture; unauthenticated callers have no
    // management override, so getVotesByPoll throws ForbiddenError.
    const response = await request(app).get("/api/v1/polls/2/votes");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: "Votes are not visible for this poll",
    });
  });

  it("bot votes route maps unknown poll ids to 404 after shim removal", async () => {
    const response = await request(app)
      .get("/api/v1/bot/polls/999/votes")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Poll not found" });
  });
});
