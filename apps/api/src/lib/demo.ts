import { env } from "../env.js";

/** Domínio reservado às contas de demonstração criadas pelo seed. */
const DEMO_EMAIL_SUFFIX = "@transitum.local";

/**
 * Em DEMO_MODE, as contas *@transitum.local ficam protegidas — não podem mudar
 * palavra-passe, ativar MFA nem ser suspensas/editadas, evitando que visitantes
 * trancem a demonstração para os restantes.
 */
export function isProtectedDemoUser(email: string | null | undefined): boolean {
  return !!email && env.DEMO_MODE && email.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);
}
