import type { ZodTypeAny, z } from "zod";

/** Parse and return typed data; ZodError is turned into a 400 by the error handler. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? "");
}
