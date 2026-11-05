import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupSkin, validateUsername } from "../server/skin-service.mjs";
afterEach(() => vi.unstubAllGlobals());
const account = { id: "069a79f444e94726a5befca90e38aaf5", name: "TestPlayer" };
function profile(
  url = "http://textures.minecraft.net/texture/abc123",
  model = "slim",
) {
  return {
    properties: [
      {
        name: "textures",
        value: Buffer.from(
          JSON.stringify({ textures: { SKIN: { url, metadata: { model } } } }),
        ).toString("base64"),
      },
    ],
  };
}
describe("public skin proxy", () => {
  it("reports an unreachable upstream clearly and still allows later retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(lookupSkin("OfflineFixture")).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("PNG-upload blijft beschikbaar"),
    });
    await expect(lookupSkin("OfflineFixture")).rejects.toMatchObject({
      status: 502,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid usernames without network requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(validateUsername("Notch")).toBe(true);
    await expect(lookupSkin("../invalid")).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads profile metadata, downloads a PNG and caches the result", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(account))
      .mockResolvedValueOnce(Response.json(profile()))
      .mockResolvedValueOnce(
        new Response(Buffer.from("89504e470d0a1a0a", "hex")),
      );
    vi.stubGlobal("fetch", fetch);
    const skin = await lookupSkin("CacheFixture");
    expect(skin.model).toBe("slim");
    expect(skin.png).toMatch(/^data:image\/png;base64,/);
    expect(fetch.mock.calls[2][0]).toBe(
      "https://textures.minecraft.net/texture/abc123",
    );
    expect(await lookupSkin("cachefixture")).toEqual(skin);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects arbitrary texture hosts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(account))
      .mockResolvedValueOnce(
        Response.json(profile("https://example.com/secret")),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(lookupSkin("HostFixture")).rejects.toThrow(
      "Onverwachte skinlocatie",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reports rate limits and absent accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    await expect(lookupSkin("RateFixture")).rejects.toMatchObject({
      status: 429,
    });
    await expect(lookupSkin("AbsentFixture")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("does not invent a custom skin when none is public", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(account))
        .mockResolvedValueOnce(Response.json({ properties: [] })),
    );
    await expect(lookupSkin("NoSkinFixture")).rejects.toMatchObject({
      status: 404,
    });
  });
});
