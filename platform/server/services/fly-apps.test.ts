import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlyAppsClient } from "./fly-apps";

const TOKEN = "fly-test-token";
const ORG = "my-org";
const BASE = "https://api.machines.dev/v1";
const GRAPHQL_BASE = "https://api.fly.io/graphql";

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function gqlOkResponse(data: unknown): Response {
  return okResponse({ data });
}

describe("FlyAppsClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: FlyAppsClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new FlyAppsClient(TOKEN, ORG);
  });

  it("getApp sends GET /apps/:name", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: "app1", name: "app-a" }));

    const result = await client.getApp("app-a");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/apps/app-a`);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toEqual({ id: "app1", name: "app-a" });
  });

  it("createApp sends POST /apps with app_name and org_slug", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: "app1", name: "app-a" }));

    await client.createApp("app-a");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/apps`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ app_name: "app-a", org_slug: ORG });
  });

  it("ensureAppExists does nothing when app already exists", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: "app1", name: "app-a" }));

    await client.ensureAppExists("app-a");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/apps/app-a`);
  });

  it("ensureAppExists creates app after 404 on get", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("not found"),
      } as unknown as Response)
      .mockResolvedValueOnce(okResponse({ id: "app1", name: "app-a" }));

    await client.ensureAppExists("app-a");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/apps/app-a`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/apps`);
  });

  it("ensureAppExists rethrows non-404 errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
    } as unknown as Response);

    await expect(client.ensureAppExists("app-a")).rejects.toThrow(
      'Fly API GET /apps/app-a failed (401): unauthorized',
    );
  });

  it("deleteApp sends DELETE /apps/:name", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));

    await client.deleteApp("app-a");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/apps/app-a`);
    expect(opts.method).toBe("DELETE");
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("destroyAppIfExists ignores 404 errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    } as unknown as Response);

    await expect(client.destroyAppIfExists("app-a")).resolves.toBeUndefined();
  });

  it("ensurePublicIps allocates shared_v4 then v6 via GraphQL", async () => {
    fetchMock
      .mockResolvedValueOnce(gqlOkResponse({ allocateIpAddress: { app: { name: "app-a" } } }))
      .mockResolvedValueOnce(gqlOkResponse({ allocateIpAddress: { app: { name: "app-a" } } }));

    await client.ensurePublicIps("app-a");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(GRAPHQL_BASE);
    expect(fetchMock.mock.calls[1][0]).toBe(GRAPHQL_BASE);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.variables.input.type).toBe("shared_v4");
    expect(secondBody.variables.input.type).toBe("v6");
    expect(firstBody.variables.input.appId).toBe("app-a");
  });

  it("ensurePublicIps is idempotent when GraphQL reports existing allocation", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ errors: [{ message: "IP already allocated" }] }))
      .mockResolvedValueOnce(okResponse({ errors: [{ message: "address exists" }] }));

    await expect(client.ensurePublicIps("app-a")).resolves.toBeUndefined();
  });
});
