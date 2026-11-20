import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { hashPassword, signToken, verifyPassword } from "../lib/auth.js";
import { conflict, unauthorized } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(200).transform((e) => e.toLowerCase().trim()),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res) => {
  const body = parse(registerSchema, req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw conflict("An account with this email already exists");
  const user = await prisma.user.create({
    data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) },
    select: { id: true, email: true, name: true },
  });
  res.status(201).json({ user, token: signToken({ sub: user.id, email: user.email }) });
});

authRouter.post("/login", async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw unauthorized("Invalid email or password");
  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    token: signToken({ sub: user.id, email: user.email }),
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});
