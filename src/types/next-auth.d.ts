import { type DefaultSession } from "next-auth";
import { Role } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: Role | null;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    role?: Role | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role | null;
  }
}
