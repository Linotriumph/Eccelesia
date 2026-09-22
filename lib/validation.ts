import { z } from "zod";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name field Cannot Be Empty")
  .refine((value) => /^[A-Za-z\s]+$/.test(value), "Full Name Must use Only Letters")
  .refine((value) => value.trim().split(/\s+/).length >= 2, "Full Name Must Contain at Least 2 Words");

export const registerSchema = z.object({
  name: nameSchema,
  email: z.string().trim().toLowerCase().email("Enter a Valid Email Address"),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Email and password are required."),
  password: z.string().min(1, "Email and password are required."),
});

export const resetPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email and password are required.")
    .email("Enter a Valid Email Address"),
  password: z.string().min(8, "Password must be at least 8 characters."),
});