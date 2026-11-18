const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "avisos_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const READER_USERNAME = "Portaria";
const READER_PASSWORD = "Portaria@123";

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function requireMethod(request, response, method) {
  if (request.method === method) return true;
  json(response, 405, { error: "Método não permitido." }, { Allow: method });
  return false;
}

async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    let body;
    try {
      body = JSON.parse(request.body || "{}");
    } catch {
      throw Object.assign(new Error("Formato JSON inválido."), { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw Object.assign(new Error("O corpo da requisição deve ser um objeto JSON."), { status: 400 });
    }
    return body;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 12_000) {
      throw Object.assign(new Error("Requisição muito grande."), { status: 413 });
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Formato JSON inválido."), { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("O corpo da requisição deve ser um objeto JSON."), { status: 400 });
  }
  return parsed;
}

function databaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  }
  return { url, key };
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Configure SESSION_SECRET com pelo menos 32 caracteres.");
  }
  return secret;
}

async function databaseRequest(path, options = {}) {
  const { url, key } = databaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`Supabase request failed (${response.status}).`);
    throw new Error("Não foi possível acessar o banco de dados.");
  }
  return text ? JSON.parse(text) : null;
}

function validEmail(value) {
  return typeof value === "string"
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validName(value) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 60;
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [saltHex, hashHex] = encoded.split(":");
  if (!/^[\da-f]{32}$/i.test(saltHex || "") || !/^[\da-f]{128}$/i.test(hashHex || "")) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return {
    name: user.name,
    email: user.email || null,
    username: user.username || null,
    role: user.role,
  };
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || "";
  const entry = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return "";
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return "";
  }
}

function cookieHeader(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Secure`;
}

function createSession(user) {
  const secret = sessionSecret();
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(request) {
  const token = cookieValue(request, SESSION_COOKIE);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", sessionSecret()).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.sub !== "string" || session.exp <= Date.now() / 1000) return null;
    return session;
  } catch {
    return null;
  }
}

async function userById(id) {
  const query = new URLSearchParams({
    select: "id,name,email,username,role",
    id: `eq.${id}`,
    limit: "1",
  });
  const users = await databaseRequest(`notice_users?${query}`);
  return users[0] || null;
}

async function currentUser(request) {
  const session = readSession(request);
  return session ? userById(session.sub) : null;
}

function handleError(response, error) {
  console.error("Cloud API error:", error);
  if (!response.headersSent) {
    json(response, error.status || 500, {
      error: error.status ? error.message : "Ocorreu um erro interno. Tente novamente.",
    });
  } else {
    response.end();
  }
}

function endpoint(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      handleError(response, error);
    }
  };
}

const status = endpoint(async (request, response) => {
  if (!requireMethod(request, response, "GET")) return;
  const query = new URLSearchParams({ select: "id", role: "eq.admin", limit: "1" });
  const admins = await databaseRequest(`notice_users?${query}`);
  const user = await currentUser(request);
  json(response, 200, {
    configured: admins.length > 0,
    authenticated: Boolean(user),
    user: user ? publicUser(user) : null,
  });
});

const setup = endpoint(async (request, response) => {
  if (!requireMethod(request, response, "POST")) return;
  const body = await readJson(request);
  if (!validName(body.adminName) || !validEmail(body.adminEmail) || !validPassword(body.adminPassword)) {
    return json(response, 400, {
      error: "Informe um nome válido, um e-mail válido e uma senha com pelo menos 10 caracteres.",
    });
  }

  const adminEmail = body.adminEmail.trim().toLowerCase();
  const [adminPasswordHash, readerPasswordHash] = await Promise.all([
    hashPassword(body.adminPassword),
    hashPassword(READER_PASSWORD),
  ]);
  const result = await databaseRequest("rpc/setup_initial_accounts", {
    method: "POST",
    body: JSON.stringify({
      p_admin_name: body.adminName.trim(),
      p_admin_email: adminEmail,
      p_admin_password_hash: adminPasswordHash,
      p_reader_password_hash: readerPasswordHash,
    }),
  });
  const adminId = typeof result === "string" ? result : result?.id;
  if (!adminId) {
    return json(response, 409, { error: "A configuração inicial já foi concluída." });
  }

  const user = await userById(adminId);
  if (!user) throw new Error("A conta publicadora criada não foi encontrada.");
  const token = createSession(user);
  json(response, 201, { user: publicUser(user) }, {
    "Set-Cookie": cookieHeader(token, SESSION_TTL_SECONDS),
  });
});

const login = endpoint(async (request, response) => {
  if (!requireMethod(request, response, "POST")) return;
  const body = await readJson(request);
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const normalized = identifier.toLocaleLowerCase("pt-BR");
  const field = normalized.includes("@") ? "email" : "username";
  const query = new URLSearchParams({
    select: "id,name,email,username,role,password_hash",
    [field]: `${field === "email" ? "eq" : "ilike"}.${normalized}`,
    limit: "1",
  });
  const users = await databaseRequest(`notice_users?${query}`);
  const user = users[0];
  const password = typeof body.password === "string" ? body.password : "";

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json(response, 401, { error: "Usuário/e-mail ou senha incorretos." });
  }
  if (body.role !== user.role) {
    return json(response, 403, { error: "Essa conta pertence a outro perfil. Selecione o perfil correto." });
  }

  json(response, 200, { user: publicUser(user) }, {
    "Set-Cookie": cookieHeader(createSession(user), SESSION_TTL_SECONDS),
  });
});

const logout = endpoint(async (request, response) => {
  if (!requireMethod(request, response, "POST")) return;
  json(response, 200, { ok: true }, { "Set-Cookie": cookieHeader("", 0) });
});

const notices = endpoint(async (request, response) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return json(response, 405, { error: "Método não permitido." }, { Allow: "GET, POST" });
  }
  const user = await currentUser(request);
  if (!user) return json(response, 401, { error: "Entre na sua conta para continuar." });

  if (request.method === "GET") {
    const query = new URLSearchParams({
      select: "id,title,message,created_at,author",
      order: "created_at.desc",
    });
    const rows = await databaseRequest(`notices?${query}`);
    return json(response, 200, {
      notices: rows.map((notice) => ({
        id: notice.id,
        title: notice.title,
        message: notice.message,
        createdAt: notice.created_at,
        author: notice.author,
      })),
    });
  }

  if (user.role !== "admin") {
    return json(response, 403, { error: "Esta ação não está disponível para sua conta." });
  }
  const body = await readJson(request);
  if (typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 100) {
    return json(response, 400, { error: "O título deve ter entre 3 e 100 caracteres." });
  }
  if (typeof body.message !== "string" || body.message.trim().length < 5 || body.message.trim().length > 3000) {
    return json(response, 400, { error: "O aviso deve ter entre 5 e 3.000 caracteres." });
  }

  const inserted = await databaseRequest("notices", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ title: body.title.trim(), message: body.message.trim(), author: user.name }),
  });
  const notice = inserted[0];
  json(response, 201, {
    notice: {
      id: notice.id,
      title: notice.title,
      message: notice.message,
      createdAt: notice.created_at,
      author: notice.author,
    },
  });
});

module.exports = { status, setup, login, logout, notices };
