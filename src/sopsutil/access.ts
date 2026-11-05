// ctx.access is supplied by Cloudflare, not by client-controlled headers.
// The matching Access application's policy requires named Entra users AND
// this organization's Gateway posture. Missing context/audience fails closed.
export function hasApplicationAccess(context: {access?: {aud: string}}, audience?: string): boolean {
 return Boolean(audience && context.access?.aud === audience);
}
