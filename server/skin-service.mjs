const cache = new Map();
const inflight = new Map();
export function validateUsername(name) {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}
async function upstream(url, binary = false) {
  let r;
  try {
    r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      headers: { "User-Agent": "WhiteBrick/0.6.1 (public skin lookup)" },
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw error;
    throw Object.assign(
      new Error(
        "De publieke skinservice is niet bereikbaar. PNG-upload blijft beschikbaar.",
        { cause: error },
      ),
      { status: 502 },
    );
  }
  if (!r.ok || r.status === 204) {
    const error = new Error(
      r.status === 429
        ? "Skinservice is druk. Probeer het over een minuut."
        : r.status === 404 || r.status === 204
          ? "Deze Java-accountnaam is niet gevonden."
          : "De publieke skinservice is tijdelijk niet beschikbaar.",
    );
    error.status =
      r.status === 429 ? 429 : r.status === 404 || r.status === 204 ? 404 : 502;
    throw error;
  }
  if (binary) {
    const bytes = Buffer.from(await r.arrayBuffer());
    if (
      bytes.length > 1024 * 1024 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new Error("Skinservice gaf geen geldige PNG.");
    return bytes;
  }
  return r.json();
}
export async function lookupSkin(name) {
  if (!validateUsername(name))
    throw Object.assign(
      new Error(
        "Gebruik een Java-username van 3–16 letters, cijfers of underscores.",
      ),
      { status: 400 },
    );
  const key = name.toLowerCase(),
    entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    const account = await upstream(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    );
    if (!/^[a-f0-9]{32}$/i.test(account.id))
      throw new Error("Ongeldig accountantwoord.");
    const profile = await upstream(
      `https://sessionserver.mojang.com/session/minecraft/profile/${account.id}`,
    );
    const property = profile.properties?.find((p) => p.name === "textures");
    const skin = property
      ? JSON.parse(Buffer.from(property.value, "base64").toString("utf8"))
          .textures?.SKIN
      : null;
    if (!skin)
      throw Object.assign(
        new Error(
          "Deze account heeft geen publieke custom skin. Upload een PNG of gebruik de originele standaardskin.",
        ),
        { status: 404 },
      );
    const url = new URL(skin.url);
    if (
      url.hostname !== "textures.minecraft.net" ||
      !/^\/texture\/[a-f0-9]+$/i.test(url.pathname) ||
      url.port
    )
      throw new Error("Onverwachte skinlocatie.");
    url.protocol = "https:";
    const png = await upstream(url.href, true);
    const data = {
      name: account.name,
      uuid: account.id,
      model: skin.metadata?.model === "slim" ? "slim" : "classic",
      png: `data:image/png;base64,${png.toString("base64")}`,
    };
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, { data, expires: Date.now() + 20 * 60 * 1000 });
    return data;
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}
export function skinMiddleware() {
  let windowStart = Date.now(),
    count = 0;
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/skin/")) return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Alleen GET is toegestaan." }));
      return;
    }
    if (Date.now() - windowStart > 60000) {
      count = 0;
      windowStart = Date.now();
    }
    if (++count > 30) {
      res.statusCode = 429;
      res.setHeader("Retry-After", "60");
      res.end(
        JSON.stringify({ error: "Te veel verzoeken. Wacht een minuut." }),
      );
      return;
    }
    try {
      const name = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname.slice(
          "/api/skin/".length,
        ),
      );
      res.end(JSON.stringify(await lookupSkin(name)));
    } catch (error) {
      res.statusCode = error.status ?? 502;
      res.end(
        JSON.stringify({
          error:
            error.name === "TimeoutError"
              ? "De skinservice reageert niet op tijd. PNG-upload blijft beschikbaar."
              : (error.message ?? "Skin ophalen mislukt."),
        }),
      );
    }
  };
}
