import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import multer from "multer";
import { AppError } from "../lib/errors.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.flatten() },
    });
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: { code: "CONFLICT", message: "A record with these values already exists", details: err.meta } });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
    }
  }
  if (err instanceof SyntaxError && "body" in (err as object)) {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Malformed JSON body" } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
