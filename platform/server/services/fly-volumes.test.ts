import { describe, it, expect, vi, beforeEach } from "vitest";
import { FlyVolumesClient } from "./fly-volumes";

const BASE = "https://api.machines.dev/v1/apps/test-app";
const TOKEN = "test-fly-token";

/**
 * Helper: build a mock Response that resolves .json() to `data`.
 * By default the response is ok (status 200).
 */
function mockResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

describe("FlyVolumesClient", () => {
  let client: FlyVolumesClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new FlyVolumesClient(TOKEN, "test-app");
  });

  // --- createVolume ---------------------------------------------------

  describe("createVolume", () => {
    it("sends POST to /volumes with the input body and returns the created volume", async () => {
      const input = { name: "data_vol", region: "iad", size_gb: 3 };
      const volume = {
        id: "vol_abc123",
        name: "data_vol",
        state: "created",
        size_gb: 3,
        region: "iad",
        zone: "a1b2",
        created_at: "2026-02-24T00:00:00Z",
      };

      fetchMock.mockResolvedValueOnce(mockResponse(volume));

      const result = await client.createVolume(input);

      // Verify the request was made to the correct URL with the right options
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/volumes`);
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(opts.body)).toEqual(input);

      // Verify the parsed response is returned
      expect(result).toEqual(volume);
    });
  });

  // --- getVolume ------------------------------------------------------

  describe("getVolume", () => {
    it("sends GET to /volumes/:id with auth header and returns the volume", async () => {
      const volume = {
        id: "vol_xyz",
        name: "db_vol",
        state: "attached",
        size_gb: 10,
        region: "ord",
        zone: "z9",
        created_at: "2026-01-01T12:00:00Z",
      };

      fetchMock.mockResolvedValueOnce(mockResponse(volume));

      const result = await client.getVolume("vol_xyz");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/volumes/vol_xyz`);
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      // GET requests should not include a body
      expect(opts.body).toBeUndefined();

      expect(result).toEqual(volume);
    });
  });

  // --- listVolumes ----------------------------------------------------

  describe("listVolumes", () => {
    it("sends GET to /volumes and returns an array of volumes", async () => {
      const volumes = [
        {
          id: "vol_1",
          name: "v1",
          state: "created",
          size_gb: 1,
          region: "iad",
          zone: "a",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "vol_2",
          name: "v2",
          state: "attached",
          size_gb: 5,
          region: "ord",
          zone: "b",
          created_at: "2026-02-01T00:00:00Z",
        },
      ];

      fetchMock.mockResolvedValueOnce(mockResponse(volumes));

      const result = await client.listVolumes();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/volumes`);
      expect(opts.method).toBe("GET");
      expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(opts.body).toBeUndefined();

      expect(result).toEqual(volumes);
      expect(result).toHaveLength(2);
    });
  });

  // --- deleteVolume ---------------------------------------------------

  describe("deleteVolume", () => {
    it("sends DELETE to /volumes/:id and returns void", async () => {
      // The DELETE endpoint may return an empty or minimal response;
      // deleteVolume discards it (returns void).
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      const result = await client.deleteVolume("vol_to_delete");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE}/volumes/vol_to_delete`);
      expect(opts.method).toBe("DELETE");
      expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);

      // deleteVolume is typed as Promise<void>
      expect(result).toBeUndefined();
    });
  });

  // --- error handling -------------------------------------------------

  describe("error handling (non-ok responses)", () => {
    it("throws an error containing the HTTP method, path, status code, and response body", async () => {
      const errorBody = "volume not found";
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(errorBody),
      } as unknown as Response);

      await expect(client.getVolume("vol_missing")).rejects.toThrow(
        'Fly API GET /volumes/vol_missing failed (404): volume not found',
      );
    });

    it("throws on a 500 server error with the full error body", async () => {
      const errorBody = '{"error":"internal server error"}';
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve(errorBody),
      } as unknown as Response);

      await expect(client.createVolume({ name: "v", region: "iad", size_gb: 1 })).rejects.toThrow(
        'Fly API POST /volumes failed (500): {"error":"internal server error"}',
      );
    });

    it("does not call res.json() when the response is not ok", async () => {
      const jsonSpy = vi.fn();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve("forbidden"),
        json: jsonSpy,
      } as unknown as Response);

      await expect(client.deleteVolume("vol_x")).rejects.toThrow();
      // json() should never be called on an error response
      expect(jsonSpy).not.toHaveBeenCalled();
    });
  });
});
