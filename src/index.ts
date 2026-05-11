import { Container, getContainer } from "@cloudflare/containers";

export class OpenclawContainer extends Container {
  defaultPort = 18789;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.OPENCLAW_CONTAINER);
    return container.fetch(request);
  },
};
