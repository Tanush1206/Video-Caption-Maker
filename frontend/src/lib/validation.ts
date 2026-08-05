import { z } from "zod";

// 72 bytes is bcrypt's hard limit; the backend rejects anything longer, so
// catch it here rather than surfacing a 422 from the API.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "Password is too long (max 72 bytes)"
  );

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  full_name: z.string().max(255, "Name is too long").optional(),
  password,
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;

/** Flatten Zod issues into a { field: message } map for rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message])
  );
}
