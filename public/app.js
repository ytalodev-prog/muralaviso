const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let currentUser = null;
let notices = [];
let selectedRole = "reader";
let toastTimer;

const icons = {
  bell: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17l5-5-5-5m5 5H3m9-9h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a solicitação.");
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("toast-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast-visible"), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  }).format(new Date(value));
}

function renderBrand() {
  return `<a class="brand" href="/" aria-label="Mural de avisos, início">
    <span class="brand-mark"><img src="/logo.jpg" alt=""></span><span class="brand-name">mural<span>.</span></span>
  </a>`;
}

function renderAuth(configured) {
  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-panel">
        ${renderBrand()}
        <div class="auth-content">
          <div class="eyebrow"><span class="eyebrow-dot"></span> CENTRAL DE AVISOS</div>
          <h1>${configured ? "Bom ter você<br>de <span>volta.</span>" : "Avisos<br>que chegam<br><span>até você.</span>"}</h1>
          <p class="auth-intro">${configured
            ? "Entre na sua conta para acompanhar os comunicados da portaria."
            : "Configure a conta que publica os avisos. A conta da portaria já está pronta para receber."}</p>
          ${configured ? renderLoginForm() : renderSetupForm()}
          <p class="auth-footnote"><span class="secure-icon">✳</span> Acesso protegido para a sua comunidade.</p>
        </div>
        <div class="auth-copyright">© ${new Date().getFullYear()} Mural de avisos</div>
      </section>
      <aside class="auth-art" aria-label="Identidade visual da central de avisos">
        <div class="art-shape art-shape-green"></div><div class="art-shape art-shape-orange"></div><div class="art-shape art-shape-blue"></div>
        <div class="art-center">
          <span class="art-overline">UMA COMUNICAÇÃO MAIS PRÓXIMA</span>
          <img class="art-logo" src="/logo.jpg" alt="Logo colorida da central">
          <div class="art-copy">
            <div class="art-kicker"><span class="live-dot"></span> PORTARIA CONECTADA</div>
            <h2>Informação<br>boa é informação<br><span>compartilhada.</span></h2>
            <p>Entre para ver os avisos importantes<br>da sua comunidade.</p>
          </div>
        </div>
        <div class="art-bottom">SIMPLES, DIRETO, SEMPRE POR PERTO <span>✳</span></div>
      </aside>
    </div>`;

  if (configured) bindLoginForm();
  else bindSetupForm();
}

function renderLoginForm() {
  return `<form id="login-form" class="auth-form">
    <div class="role-label">ESCOLHA SEU ACESSO</div>
    <div class="role-switch" role="group" aria-label="Escolha o tipo de conta">
      <button class="role-option ${selectedRole === "admin" ? "active" : ""}" type="button" data-role="admin">
        <span class="role-glyph">↗</span> Publicador
      </button>
      <button class="role-option ${selectedRole === "reader" ? "active" : ""}" type="button" data-role="reader">
        <span class="role-glyph">◉</span> Portaria
      </button>
    </div>
    <label class="field-label" for="login-identifier">Usuário ou e-mail</label>
    <input class="text-field" id="login-identifier" name="identifier" type="text" value="${selectedRole === "reader" ? "Portaria" : ""}" placeholder="${selectedRole === "reader" ? "Portaria" : "voce@exemplo.com"}" autocomplete="username" required>
    <label class="field-label" for="login-password">Senha</label>
    <input class="text-field" id="login-password" name="password" type="password" placeholder="Sua senha" autocomplete="current-password" required>
    <button class="button button-primary auth-submit" type="submit">Entrar na minha conta ${icons.arrow}</button>
    <p class="form-error" id="form-error" aria-live="polite"></p>
  </form>`;
}

function renderSetupForm() {
  return `<form id="setup-form" class="auth-form setup-form">
    <div class="setup-heading"><span class="setup-step">PRIMEIRO ACESSO</span><span class="setup-line"></span></div>
    <div class="setup-columns">
      <fieldset class="account-fields">
        <legend><span class="legend-number">01</span> Conta publicadora</legend>
        <label class="field-label" for="admin-name">Nome</label>
        <input class="text-field" id="admin-name" name="adminName" placeholder="Seu nome" autocomplete="name" required minlength="2" maxlength="60">
        <label class="field-label" for="admin-email">E-mail</label>
        <input class="text-field" id="admin-email" name="adminEmail" type="email" placeholder="voce@exemplo.com" autocomplete="username" required>
        <label class="field-label" for="admin-password">Senha <span class="field-hint">mín. 10 caracteres</span></label>
        <input class="text-field" id="admin-password" name="adminPassword" type="password" placeholder="Crie uma senha" autocomplete="new-password" required minlength="10">
      </fieldset>
      <div class="reader-setup-card">
        <span class="reader-setup-icon">◉</span><span class="reader-setup-kicker">CONTA LEITORA</span>
        <strong>Portaria</strong><p>A conta que vai receber os avisos já está configurada.</p>
      </div>
    </div>
    <button class="button button-primary auth-submit" type="submit">Criar conta publicadora ${icons.arrow}</button>
    <p class="form-error" id="form-error" aria-live="polite"></p>
  </form>`;
}

function bindLoginForm() {
  document.querySelectorAll(".role-option").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRole = button.dataset.role;
      document.querySelectorAll(".role-option").forEach((option) => {
        option.classList.toggle("active", option === button);
      });
      const identifier = document.querySelector("#login-identifier");
      identifier.value = selectedRole === "reader" ? "Portaria" : "";
      identifier.placeholder = selectedRole === "reader" ? "Portaria" : "voce@exemplo.com";
    });
  });
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    setBusy(submit, true);
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ identifier: data.identifier, password: data.password, role: selectedRole }),
      });
      currentUser = result.user;
      await loadDashboard();
    } catch (error) {
      form.querySelector("#form-error").textContent = error.message;
    } finally {
      setBusy(submit, false);
    }
  });
}

function bindSetupForm() {
  document.querySelector("#setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    setBusy(submit, true);
    try {
      const result = await api("/api/setup", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      currentUser = result.user;
      await loadDashboard();
    } catch (error) {
      form.querySelector("#form-error").textContent = error.message;
    } finally {
      setBusy(submit, false);
    }
  });
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.originalText ||= button.textContent.trim();
  button.classList.toggle("button-busy", busy);
  if (busy) button.textContent = "Só um instante…";
  else if (button.dataset.originalText) button.innerHTML = `${escapeHtml(button.dataset.originalText)} ${icons.arrow}`;
}

async function loadDashboard() {
  const data = await api("/api/notices");
  notices = data.notices;
  renderDashboard();
}

function renderDashboard() {
  app.innerHTML = `<div class="dashboard">
    <aside class="sidebar">
      <div class="sidebar-top">${renderBrand()}<span class="workspace-pill"><span></span> SUA CENTRAL</span></div>
      <div class="sidebar-nav-label">MENU</div>
      <nav class="sidebar-nav" aria-label="Menu principal">
        <a class="nav-link active" href="#inicio"><span class="nav-icon">${icons.bell}</span> ${currentUser.role === "admin" ? "Visão geral" : "Meus avisos"}
          ${currentUser.role === "reader" && notices.length ? `<span class="nav-count">${notices.length}</span>` : ""}
        </a>
        ${currentUser.role === "admin" ? '<a class="nav-link" href="#publicados"><span class="nav-icon">▤</span> Avisos publicados</a>' : ""}
      </nav>
      <div class="sidebar-bottom">
        <div class="account-card"><div class="avatar">${escapeHtml(currentUser.name.charAt(0).toUpperCase())}</div><div class="account-info"><b>${escapeHtml(currentUser.name)}</b><span>${currentUser.role === "admin" ? "Publicador" : "Leitor"}</span></div><button class="logout-button" id="logout" aria-label="Sair da conta">${icons.logout}</button></div>
        <div class="sidebar-note">Feito para manter tudo<br><b>em boa conversa.</b> <span>✳</span></div>
      </div>
    </aside>
    <section class="dashboard-main">
      <header class="topbar"><div class="breadcrumb">Mural <span>/</span> ${currentUser.role === "admin" ? "Visão geral" : "Meus avisos"}</div><div class="topbar-right"><span class="today">${formatDate(new Date())}</span><div class="top-avatar">${escapeHtml(currentUser.name.charAt(0).toUpperCase())}</div></div></header>
      <div class="dashboard-content">
        ${currentUser.role === "admin" ? renderAdminDashboard() : renderReaderDashboard()}
      </div>
    </section>
  </div>`;
  document.querySelector("#logout").addEventListener("click", logout);
  if (currentUser.role === "admin") bindNoticeForm();
}

function renderAdminDashboard() {
  const latest = notices[0];
  return `<div class="welcome-row">
      <div><div class="eyebrow"><span class="eyebrow-dot"></span> SUA CENTRAL ESTÁ ATUALIZADA</div><h1>Oi, ${escapeHtml(currentUser.name.split(" ")[0])} <span class="wave">✳</span></h1><p>O que você precisa compartilhar hoje?</p></div>
      <div class="welcome-decoration">a<span>.</span></div>
    </div>
    <div class="stats-row">
      <div class="stat-card"><span class="stat-label">AVISOS PUBLICADOS</span><strong>${notices.length.toString().padStart(2, "0")}</strong><span class="stat-foot"><span class="stat-dot"></span> No total</span><span class="stat-mark">↗</span></div>
      <div class="stat-card stat-card-lilac"><span class="stat-label">CONTA LEITORA</span><strong>01</strong><span class="stat-foot">Conta ativa para receber</span><span class="stat-mark">◉</span></div>
      <div class="stat-card stat-card-dark"><span class="stat-label">ÚLTIMO AVISO</span><strong class="stat-date">${latest ? formatDate(latest.createdAt).replace(" de ", " / ") : "—"}</strong><span class="stat-foot">${latest ? "Publicado com sucesso" : "Seu primeiro aviso começa aqui"}</span><span class="stat-mark">✳</span></div>
    </div>
    <div class="section-heading"><div><span class="section-kicker">UM RECADO QUE FAZ DIFERENÇA</span><h2>Novo aviso</h2></div><span class="section-number">01 <i>/ 02</i></span></div>
    <form class="composer-card" id="notice-form">
      <label class="field-label" for="notice-title">Título do aviso <span class="counter" id="title-counter">0 / 100</span></label>
      <input class="text-field composer-title" id="notice-title" name="title" placeholder="Ex.: Uma novidade para você" maxlength="100" required minlength="3">
      <label class="field-label" for="notice-message">Sua mensagem <span class="counter" id="message-counter">0 / 3000</span></label>
      <textarea class="text-field composer-message" id="notice-message" name="message" placeholder="Escreva aqui os detalhes do aviso. Uma mensagem clara faz toda a diferença." maxlength="3000" required minlength="5" rows="4"></textarea>
      <div class="composer-bottom"><span class="recipient-chip"><span>◉</span> Será enviado para a conta leitora</span><button type="submit" class="button button-primary publish-button">Publicar aviso ${icons.arrow}</button></div>
      <p class="form-error" id="notice-error" aria-live="polite"></p>
    </form>
    <section class="notice-section" id="publicados"><div class="section-heading section-heading-list"><div><span class="section-kicker">TUDO NO SEU LUGAR</span><h2>Avisos publicados <span class="heading-count">${notices.length}</span></h2></div><span class="list-subtitle">Mais recentes primeiro</span></div>
      ${renderNoticeList(true)}
    </section>`;
}

function renderReaderDashboard() {
  return `<div class="reader-hero">
      <div class="reader-hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> SEU ESPAÇO DE LEITURA</div><h1>Oi, ${escapeHtml(currentUser.name.split(" ")[0])}<br>tem novidade <span>pra você.</span></h1><p>Todos os avisos importantes, reunidos aqui.<br>Volte quando quiser — nada se perde.</p></div>
      <div class="reader-illustration"><div class="reader-sun"></div><div class="reader-envelope"><span>✳</span></div><div class="reader-sparkle sparkle-one">✦</div><div class="reader-sparkle sparkle-two">✳</div><div class="reader-pill">feito pra você <span>♡</span></div></div>
    </div>
    <section class="notice-section reader-notice-section"><div class="section-heading section-heading-list"><div><span class="section-kicker">DIRETO DA SUA CENTRAL</span><h2>Seus avisos <span class="heading-count">${notices.length}</span></h2></div><span class="list-subtitle">Mais recentes primeiro</span></div>
      ${renderNoticeList(false)}
    </section>`;
}

function renderNoticeList(isAdmin) {
  if (notices.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">${icons.bell}</div><h3>${isAdmin ? "Seu mural começa aqui" : "Está tudo tranquilo por aqui"}</h3><p>${isAdmin ? "Quando publicar um aviso, ele aparecerá nesta lista." : "Quando chegar um novo aviso, você o encontrará aqui."}</p></div>`;
  }
  return `<div class="notice-list">${notices.map((notice, index) => `
    <article class="notice-card">
      <div class="notice-card-aside"><span class="notice-index">${String(notices.length - index).padStart(2, "0")}</span><span class="notice-type-icon ${index % 2 ? "notice-type-lilac" : ""}">${index % 2 ? "↗" : "✳"}</span></div>
      <div class="notice-card-content"><div class="notice-meta"><span class="notice-date">${formatDate(notice.createdAt)}</span><span class="notice-badge">AVISO</span></div><h3>${escapeHtml(notice.title)}</h3><p>${escapeHtml(notice.message).replace(/\n/g, "<br>")}</p>${isAdmin ? `<span class="notice-author">Publicado por ${escapeHtml(notice.author)}</span>` : ""}</div>
      <div class="notice-card-decoration">✳</div>
    </article>`).join("")}</div>`;
}

function bindNoticeForm() {
  const form = document.querySelector("#notice-form");
  const title = form.elements.title;
  const message = form.elements.message;
  title.addEventListener("input", () => {
    document.querySelector("#title-counter").textContent = `${title.value.length} / 100`;
  });
  message.addEventListener("input", () => {
    document.querySelector("#message-counter").textContent = `${message.value.length} / 3000`;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    setBusy(submit, true);
    try {
      await api("/api/notices", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      showToast("Aviso publicado e disponível para a conta leitora.");
      await loadDashboard();
    } catch (error) {
      form.querySelector("#notice-error").textContent = error.message;
      setBusy(submit, false);
    }
  });
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
    currentUser = null;
    selectedRole = "reader";
    await start();
  } catch (error) {
    showToast(error.message);
  }
}

async function start() {
  try {
    const status = await api("/api/status");
    if (status.authenticated) {
      currentUser = status.user;
      await loadDashboard();
    } else {
      renderAuth(status.configured);
    }
  } catch (error) {
    app.innerHTML = `<div class="fatal-error"><div class="brand-mark"><img src="/logo.jpg" alt=""></div><h1>Não foi possível carregar a central.</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" onclick="location.reload()">Tentar novamente</button></div>`;
  }
}

start();
