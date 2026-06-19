const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = 3138;
const BASE = `http://127.0.0.1:${PORT}`;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), LEGACY_TEST_MODE: "1", PUBLIC_ORIGIN: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    const identity = createSolanaIdentity();

    const sessionStatus = await get("/api/session", "bad-token");
    assert(sessionStatus.status === 200, "test mode session endpoint should allow browser automation");
    const badProfileSession = await post("/api/profile/name", { name: "Nope" }, "bad-token");
    assert(badProfileSession.status === 401, "invalid profile session should be refused");

    const challenge = await post("/api/auth/challenge", { wallet: identity.wallet, turnstileToken: "test" });
    assert(challenge.status === 200 && challenge.body.nonce && challenge.body.message, "challenge should be issued");

    const badVerify = await post("/api/auth/verify", { wallet: identity.wallet, nonce: challenge.body.nonce, signature: "bad" });
    assert(badVerify.status === 401, "invalid signature should be refused");

    const replay = await post("/api/auth/verify", { wallet: identity.wallet, nonce: challenge.body.nonce, signature: "bad" });
    assert(replay.status === 401, "used nonce should be refused");

    const nextChallenge = await post("/api/auth/challenge", { wallet: identity.wallet, turnstileToken: "test" });
    const signature = crypto.sign(null, Buffer.from(nextChallenge.body.message, "utf8"), identity.privateKey);
    const verified = await post("/api/auth/verify", {
      wallet: identity.wallet,
      nonce: nextChallenge.body.nonce,
      signature: signature.toString("base64"),
    });
    assert(verified.status === 200 && verified.body.sessionToken, "valid signature should create a session");
    assert(verified.body.profile.needsName, "new profile should need a name");

    const invalidName = await post("/api/profile/name", { name: "<script>" }, verified.body.sessionToken);
    assert(invalidName.status === 400, "dangerous name should be refused");

    const bannedName = await post("/api/profile/name", { name: "merdeHero" }, verified.body.sessionToken);
    assert(bannedName.status === 400, "banned name should be refused");

    const savedName = await post("/api/profile/name", { name: `Hero${Date.now().toString().slice(-5)}` }, verified.body.sessionToken);
    assert(savedName.status === 200 && !savedName.body.profile.needsName, "valid name should be saved");

    const secondIdentity = createSolanaIdentity();
    const secondChallenge = await post("/api/auth/challenge", { wallet: secondIdentity.wallet, turnstileToken: "test" });
    const secondSignature = crypto.sign(null, Buffer.from(secondChallenge.body.message, "utf8"), secondIdentity.privateKey);
    const secondVerified = await post("/api/auth/verify", {
      wallet: secondIdentity.wallet,
      nonce: secondChallenge.body.nonce,
      signature: secondSignature.toString("base64"),
    });
    const duplicate = await post("/api/profile/name", { name: savedName.body.profile.characterName }, secondVerified.body.sessionToken);
    assert(duplicate.status === 400, "duplicate name should be refused");

    const liveSession = await get("/api/session", verified.body.sessionToken);
    assert(liveSession.status === 200 && liveSession.body.profile.characterName, "valid session should load profile");

    console.log("Auth flow test passed.");
  } finally {
    server.kill();
    if (process.exitCode && stderr) console.error(stderr);
  }
}

function createSolanaIdentity() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const raw = der.subarray(der.length - 32);
  return { privateKey, wallet: base58Encode(raw) };
}

function post(path, body, token = "") {
  return request("POST", path, body, token);
}

function get(path, token = "") {
  return request("GET", path, null, token);
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      await get("/api/auth/config");
      return;
    } catch {
      await delay(80);
    }
  }
  throw new Error("Timed out waiting for test server");
}

function base58Encode(buffer) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (const byte of buffer) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += alphabet[digits[i]];
  return out;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
