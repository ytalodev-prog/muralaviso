const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const SESSION_COOKIE = "avisos_session";
const SESSION_TTL = 12 * 60 * 60 * 1000;
const READER_USERNAME = "Portaria";
const READER_PASSWORD = "Portaria@123";
const sessions = new Map();
let settingUp = false;

fs.mkdirSync(DATA_DIR, { recursive: true });

function readStore() {
  if (!fs.existsSync(STORE_FILE)) {
    return { users: [], notices: [] };
  }

  try {
    const store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      users: Array.isArray(store.users) ? store.users : [],
      notices: Array.isArray(store.notices) ? store.notices : [],
    };
  } catch (error) {
    throw new Error(`Não foi possível ler ${STORE_FILE}: ${error.message}`);
  }
}

let store = readStore();

function saveStore() {
  const temporaryFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporaryFile, STORE_FILE);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12_000) {
        reject(Object.assign(new Error("Requisição muito grande."), { status: 413 }));
        request.resume();
      }
    });
    request.on("end", () => {
      if (body.length > 12_000) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Formato JSON inválido."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || "";
  const entry = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function currentUser(request) {
  const token = cookieValue(request, SESSION_COOKIE);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return store.users.find((user) => user.id === session.userId) || null;
}

function sessionCookie(token, maxAge) {
  const secure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function publicUser(user) {
  return {
    name: user.name,
    email: user.email || null,
    username: user.username || null,
    role: user.role,
  };
}

function requireUser(request, response, role) {
  const user = currentUser(request);
  if (!user) {
    sendJson(response, 401, { error: "Entre na sua conta para continuar." });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(response, 403, { error: "Esta ação não está disponível para sua conta." });
    return null;
  }
  return user;
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
  const [saltHex, hashHex] = encoded.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function createReaderAccount(existingReader) {
  return {
    id: existingReader?.id || crypto.randomUUID(),
    name: READER_USERNAME,
    username: READER_USERNAME,
    email: null,
    passwordHash: await hashPassword(READER_PASSWORD),
    role: "reader",
  };
}

async function ensureReaderAccount() {
  if (!store.users.some((user) => user.role === "admin")) return;

  const reader = store.users.find((user) => user.role === "reader");
  if (!reader) {
    store.users.push(await createReaderAccount());
    saveStore();
    return;
  }

  if (reader.username !== READER_USERNAME || reader.name !== READER_USERNAME) {
    Object.assign(reader, await createReaderAccount(reader));
    saveStore();
  }
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/status") {
    const user = currentUser(request);
    return sendJson(response, 200, {
      configured: store.users.some((user) => user.role === "admin"),
      authenticated: Boolean(user),
      user: user ? publicUser(user) : null,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/setup") {
    if (store.users.some((user) => user.role === "admin") || settingUp) {
      return sendJson(response, 409, { error: "A configuração inicial já foi concluída." });
    }

    settingUp = true;
    try {
      const body = await readJson(request);
      if (!validName(body.adminName) || !validEmail(body.adminEmail) || !validPassword(body.adminPassword)) {
        return sendJson(response, 400, {
          error: "Informe um nome válido, um e-mail válido e uma senha com pelo menos 10 caracteres.",
        });
      }

      const admin = {
        id: crypto.randomUUID(),
        name: body.adminName.trim(),
        email: body.adminEmail.trim().toLowerCase(),
        passwordHash: await hashPassword(body.adminPassword),
        role: "admin",
      };
      const reader = await createReaderAccount();
      store.users = [admin, reader];
      saveStore();

      const token = createSession(admin);
      return sendJson(response, 201, { user: publicUser(admin) }, {
        "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000),
      });
    } finally {
      settingUp = false;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(request);
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const normalizedIdentifier = identifier.toLocaleLowerCase("pt-BR");
    const user = store.users.find((item) =>
      (item.username && item.username.toLocaleLowerCase("pt-BR") === normalizedIdentifier)
      || (item.email && item.email.toLowerCase() === normalizedIdentifier));
    const password = typeof body.password === "string" ? body.password : "";

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return sendJson(response, 401, { error: "E-mail ou senha incorretos." });
    }
    if (body.role !== user.role) {
      return sendJson(response, 403, { error: "Essa conta pertence a outro perfil. Selecione o perfil correto." });
    }

    const token = createSession(user);
    return sendJson(response, 200, { user: publicUser(user) }, {
      "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    const token = cookieValue(request, SESSION_COOKIE);
    sessions.delete(token);
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": sessionCookie("", 0),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/notices") {
    if (!requireUser(request, response)) return;
    return sendJson(response, 200, {
      notices: [...store.notices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/notices") {
    const user = requireUser(request, response, "admin");
    if (!user) return;
    const body = await readJson(request);
    if (typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 100) {
      return sendJson(response, 400, { error: "O título deve ter entre 3 e 100 caracteres." });
    }
    if (typeof body.message !== "string" || body.message.trim().length < 5 || body.message.trim().length > 3000) {
      return sendJson(response, 400, { error: "O aviso deve ter entre 5 e 3.000 caracteres." });
    }

    const notice = {
      id: crypto.randomUUID(),
      title: body.title.trim(),
      message: body.message.trim(),
      createdAt: new Date().toISOString(),
      author: user.name,
    };
    store.notices.push(notice);
    saveStore();
    return sendJson(response, 201, { notice });
  }

  sendJson(response, 404, { error: "Rota não encontrada." });
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const publicDir = path.join(__dirname, "public");
  const filePath = path.resolve(publicDir, relativePath);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403);
    return response.end("Acesso negado.");
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      return response.end(error.code === "ENOENT" ? "Página não encontrada." : "Erro ao carregar a página.");
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      console.error("Erro na API:", error);
      if (!response.headersSent) {
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : "Ocorreu um erro interno. Tente novamente.",
        });
      } else {
        response.end();
      }
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end("Método não permitido.");
  }
  serveStatic(response, url.pathname);
});

async function startServer() {
  await ensureReaderAccount();
  server.listen(PORT, () => {
    console.log(`Central de avisos disponível em http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Não foi possível iniciar a central de avisos:", error);
  process.exitCode = 1;
});
