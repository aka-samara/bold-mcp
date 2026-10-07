import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface Session {
  id: string;
  /** Sessions are bound to the credential that created them. */
  binding: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

/**
 * In-memory sessions for this instance. With several instances the load
 * balancer must route by the Mcp-Session-Id header; an unknown session gets
 * 404 and the client re-initialises (MCP spec behaviour).
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly idleMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.sweep(), Math.min(this.idleMs, 60_000));
    this.timer.unref();
  }

  get size(): number {
    return this.sessions.size;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  add(session: Session): boolean {
    if (this.sessions.size >= this.max) return false;
    this.sessions.set(session.id, session);
    return true;
  }

  touch(session: Session): void {
    session.lastSeen = this.now();
  }

  async remove(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    await s.transport.close().catch(() => undefined);
    await s.server.close().catch(() => undefined);
  }

  async sweep(): Promise<void> {
    const cutoff = this.now() - this.idleMs;
    for (const [id, s] of this.sessions) if (s.lastSeen < cutoff) await this.remove(id);
  }

  async closeAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.sessions.keys()]) await this.remove(id);
  }
}
