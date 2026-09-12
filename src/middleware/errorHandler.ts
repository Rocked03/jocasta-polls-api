import type { ErrorRequestHandler } from "express";
import { ApiError } from "@/errors";

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  ApiError.sendError(res, error);
};
