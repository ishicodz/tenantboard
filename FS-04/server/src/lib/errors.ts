export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have permission to do this") => new AppError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const planLimit = (msg: string, details?: unknown) => new AppError(402, "PLAN_LIMIT", msg, details);
