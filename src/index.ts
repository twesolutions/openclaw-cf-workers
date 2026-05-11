import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  OPENCLAW_CONTAINER: DurableObjectNamespace;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export class OpenclawContainer extends Container<Env> {
  defaultPort = 18789;
  sleepAfter = "15m";
  envVars = {
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
    AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY,
  };
}

const ALLOWED_IPS = new Set(["YOUR.PUBLIC.IP.HERE"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    if (!ALLOWED_IPS.has(ip)) {
      return new Response("Forbidden", { status: 403 });
    }
    const container = getContainer(env.OPENCLAW_CONTAINER);
    return container.fetch(request);
  },
};
