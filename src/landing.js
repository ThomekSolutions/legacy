const SESSION_KEY = "legacy.sessionToken.v1";
const WALLET_CHOICES = ["Phantom", "Jup Wallet", "Solflare", "Backpack"];
const PREFERRED_WALLETS = ["Phantom", "Jupiter", "Jup Wallet", "Solflare", "Backpack"];

const ui = {
  connect: document.querySelector("#connectWalletButton"),
  modal: document.querySelector("#walletModal"),
  status: document.querySelector("#walletStatus"),
  walletList: document.querySelector("#walletList"),
  nameForm: document.querySelector("#nameForm"),
  nameInput: document.querySelector("#characterNameInput"),
  turnstileSlot: document.querySelector("#turnstileSlot"),
  onlinePlayersMetric: document.querySelector("#onlinePlayersMetric"),
  recordMetric: document.querySelector("#recordMetric"),
  playLinks: [
    document.querySelector("#heroPlayLink"),
    document.querySelector("#footerPlayLink"),
  ].filter(Boolean),
};

let selectedWallet = null;
let profile = null;
let turnstileSiteKey = "";
let turnstileWidget = null;
let turnstileReady = null;

initLanding();

async function initLanding() {
  lockPlay();
  await loadAuthConfig();
  await refreshSession();
  await refreshHeroMetrics();
  renderWallets();
  ui.connect?.addEventListener("click", openWalletModal);
  document.querySelectorAll("[data-close-wallet-modal]").forEach((element) => element.addEventListener("click", closeWalletModal));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWalletModal();
  });
  ui.nameForm?.addEventListener("submit", saveName);
  for (const link of ui.playLinks) {
    link.addEventListener("click", (event) => {
      if (!profile || profile.needsName) event.preventDefault();
    });
  }
}

async function refreshHeroMetrics() {
  try {
    const response = await fetch("/api/legends");
    const legends = await response.json();
    if (ui.onlinePlayersMetric) ui.onlinePlayersMetric.textContent = formatCount(legends.online || 0);
    if (ui.recordMetric) ui.recordMetric.textContent = `Lvl ${legends.records?.maxLevel || 1}`;
  } catch {
    if (ui.onlinePlayersMetric) ui.onlinePlayersMetric.textContent = "0";
    if (ui.recordMetric) ui.recordMetric.textContent = "Lvl 1";
  }
}

async function loadAuthConfig() {
  try {
    const response = await fetch("/api/auth/config");
    const config = await response.json();
    turnstileSiteKey = config.turnstileSiteKey || "";
    if (turnstileSiteKey) await loadTurnstile();
  } catch {
    turnstileSiteKey = "";
  }
}

async function refreshSession() {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return;
  try {
    const response = await fetch("/api/session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    if (!response.ok || !result.profile) throw new Error("Invalid session");
    profile = result.profile;
    updateProfileUi();
  } catch {
    localStorage.removeItem(SESSION_KEY);
    profile = null;
    lockPlay();
  }
}

function renderWallets() {
  const wallets = detectWallets();
  if (!ui.walletList) return;
  ui.walletList.innerHTML = "";
  for (const walletName of WALLET_CHOICES) {
    const wallet = wallets.find((candidate) => walletMatchesChoice(candidate.name, walletName));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = walletName;
    if (!wallet) button.className = "is-unavailable";
    button.addEventListener("click", () => {
      if (!wallet) {
        setStatus(`${walletName} is not detected. Install it first, then try again.`);
        return;
      }
      selectedWallet = wallet;
      connectSelectedWallet();
    });
    ui.walletList.append(button);
  }
}

function openWalletModal() {
  renderWallets();
  ui.modal?.classList.remove("hidden");
}

function closeWalletModal() {
  ui.modal?.classList.add("hidden");
}

async function connectSelectedWallet() {
  if (!selectedWallet) {
    renderWallets();
    return;
  }
  try {
    setStatus(`Connecting ${selectedWallet.name}...`);
    const account = await selectedWallet.connect();
    if (!account?.address) throw new Error("Wallet did not return an address.");
    const turnstileToken = await getTurnstileToken();
    const challenge = await postJson("/api/auth/challenge", { wallet: account.address, turnstileToken });
    const signature = await selectedWallet.signMessage(challenge.message);
    const verified = await postJson("/api/auth/verify", {
      wallet: account.address,
      nonce: challenge.nonce,
      signature: bytesToBase64(signature),
    });
    localStorage.setItem(SESSION_KEY, verified.sessionToken);
    profile = verified.profile;
    updateProfileUi();
  } catch (error) {
    setStatus(error.message || "Wallet connection failed.");
    resetTurnstile();
  }
}

async function saveName(event) {
  event.preventDefault();
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return;
  try {
    const response = await fetch("/api/profile/name", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: ui.nameInput?.value || "" }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Name refused.");
    profile = result.profile;
    updateProfileUi();
  } catch (error) {
    setStatus(error.message || "Unable to save name.");
  }
}

function updateProfileUi() {
  if (!profile) {
    lockPlay();
    return;
  }
  if (profile.needsName) {
    lockPlay();
    ui.nameForm?.classList.remove("hidden");
    openWalletModal();
    setStatus("Choose a unique character name.");
    return;
  }
  ui.nameForm?.classList.add("hidden");
  unlockPlay();
  setStatus(`Connected as ${profile.characterName}.`);
  closeWalletModal();
}

function lockPlay() {
  for (const link of ui.playLinks) {
    link.classList.add("is-disabled");
    link.setAttribute("aria-disabled", "true");
  }
}

function unlockPlay() {
  for (const link of ui.playLinks) {
    link.classList.remove("is-disabled");
    link.setAttribute("aria-disabled", "false");
  }
}

function setStatus(text) {
  if (ui.status) ui.status.textContent = text;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function detectWallets() {
  const found = [];
  const seen = new Set();
  for (const wallet of standardWallets()) addWallet(found, seen, makeStandardWallet(wallet));
  addWallet(found, seen, makeInjectedWallet("Phantom", window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null)));
  addWallet(found, seen, makeInjectedWallet("Solflare", window.solflare || (window.solana?.isSolflare ? window.solana : null)));
  addWallet(found, seen, makeInjectedWallet("Backpack", window.backpack || (window.solana?.isBackpack ? window.solana : null)));
  addWallet(found, seen, makeInjectedWallet("Jupiter", window.jupiter || window.jup || (window.solana?.isJupiter ? window.solana : null)));
  return found.sort((a, b) => walletRank(a.name) - walletRank(b.name));
}

function standardWallets() {
  try {
    const wallets = navigator.wallets?.get?.() || [];
    return wallets.filter((wallet) => {
      const chains = wallet.chains || [];
      return chains.some((chain) => String(chain).startsWith("solana"));
    });
  } catch {
    return [];
  }
}

function makeStandardWallet(wallet) {
  if (!wallet) return null;
  const connectFeature = wallet.features?.["standard:connect"];
  const signFeature = wallet.features?.["solana:signMessage"];
  if (!connectFeature?.connect || !signFeature?.signMessage) return null;
  let connectedAccount = null;
  return {
    name: wallet.name || "Solana Wallet",
    async connect() {
      const result = await connectFeature.connect();
      connectedAccount = result.accounts?.[0] || wallet.accounts?.[0];
      return { address: connectedAccount?.address, account: connectedAccount };
    },
    async signMessage(message) {
      const account = connectedAccount || wallet.accounts?.[0];
      if (!account) throw new Error("Wallet account unavailable.");
      const result = await signFeature.signMessage({
        account,
        message: new TextEncoder().encode(message),
      });
      return result.signature;
    },
  };
}

function makeInjectedWallet(name, provider) {
  if (!provider || !provider.connect || !provider.signMessage) return null;
  return {
    name,
    async connect() {
      const result = await provider.connect();
      const publicKey = result?.publicKey || provider.publicKey;
      return { address: publicKey?.toString?.() || String(publicKey || "") };
    },
    async signMessage(message) {
      const encoded = new TextEncoder().encode(message);
      const result = await provider.signMessage(encoded, "utf8");
      return result?.signature || result;
    },
  };
}

function addWallet(list, seen, wallet) {
  if (!wallet?.name) return;
  const key = wallet.name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  list.push(wallet);
}

function walletRank(name) {
  const index = PREFERRED_WALLETS.findIndex((candidate) => name.toLowerCase().includes(candidate.toLowerCase().split(" ")[0]));
  return index === -1 ? 99 : index;
}

function walletMatchesChoice(name, choice) {
  if (choice === "Jup Wallet") return /jup|jupiter/i.test(name);
  return name.toLowerCase().includes(choice.toLowerCase());
}

async function getTurnstileToken() {
  if (!turnstileSiteKey || !window.turnstile) return "dev";
  if (!turnstileReady) {
    turnstileReady = new Promise((resolve) => {
      turnstileWidget = window.turnstile.render(ui.turnstileSlot, {
        sitekey: turnstileSiteKey,
        size: "invisible",
        callback: resolve,
      });
    });
  }
  window.turnstile.execute(turnstileWidget);
  return turnstileReady;
}

function resetTurnstile() {
  if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
  turnstileReady = null;
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Request failed.");
  return result;
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
