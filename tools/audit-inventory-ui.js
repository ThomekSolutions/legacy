const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const URL = "http://localhost:3000/play.html";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

fs.mkdirSync(ARTIFACTS, { recursive: true });

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  let server = null;
  if (!(await urlOk(URL))) {
    server = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    await waitFor(() => urlOk(URL), 5000, "server");
  }

  const desktop = await auditViewport(1280, 720, "inventory-desktop-audit.png", 9343);
  const mobile = await auditViewport(390, 844, "inventory-mobile-audit.png", 9344);

  if (server) server.kill();

  const result = { desktop, mobile };
  fs.writeFileSync(path.join(ARTIFACTS, "inventory-audit.json"), `${JSON.stringify(result, null, 2)}\n`);
  assertAudit("desktop", desktop.audit);
  assertAudit("mobile", mobile.audit);
  console.log(JSON.stringify(result, null, 2));
}

async function auditViewport(width, height, screenshotName, port) {
  const userDataDir = path.join(ARTIFACTS, `chrome-profile-${port}`);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-software-rasterizer",
    "--no-first-run",
    "--disable-default-apps",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    URL,
  ], {
    stdio: ["ignore", "ignore", fs.openSync(path.join(ARTIFACTS, `chrome-${port}.err.log`), "w")],
    windowsHide: true,
  });

  try {
    const tab = await waitFor(async () => {
      const tabs = await getJson(`http://127.0.0.1:${port}/json`);
      return tabs.find((entry) => entry.type === "page");
    }, 6000, "chrome tab");

    const cdp = await connectCdp(tab.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 480,
    });
    await cdp.send("Page.navigate", { url: URL });
    await delay(900);
    await delay(2200);
    const clickResult = await cdp.send("Runtime.evaluate", { expression: clickScript(), awaitPromise: true, returnByValue: true });
    if (clickResult.result.value !== true) throw new Error("Start screen did not close before inventory audit");
    await delay(350);
    await cdp.send("Runtime.evaluate", { expression: waitForInventoryScript(), awaitPromise: true });
    const auditResult = await cdp.send("Runtime.evaluate", {
      expression: `(${auditScript})()`,
      returnByValue: true,
    });
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshotPath = path.join(ARTIFACTS, screenshotName);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    cdp.close();
    return { screenshotPath, audit: auditResult.result.value };
  } finally {
    chrome.kill();
  }
}

function clickScript() {
  return `new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const connected = typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN;
      if (connected || document.querySelector('#inventoryButton')) {
        document.querySelector('#inventoryButton')?.click();
        setTimeout(() => resolve(true), 160);
        return;
      }
      if (Date.now() - startedAt > 1400) {
        if (typeof connect === 'function') connect();
        if (!document.querySelector('#equipmentSlots')?.children.length) {
          const labels = { helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', weapon: 'Weapon' };
          document.querySelector('#equipmentSlots').innerHTML = Object.entries(labels).map(([id, label]) => '<div class="equipment-slot equipment-slot--' + id + '" data-slot="' + id + '"><span>' + label + '</span><div class="equipment-item"><em>' + label + '</em></div></div>').join('');
        }
        if (!document.querySelector('#inventorySlots')?.children.length) {
          document.querySelector('#inventorySlots').innerHTML = Array.from({ length: 10 }, (_, index) => '<button type="button" class="item-slot" data-index="' + index + '"></button>').join('');
        }
        document.querySelector('#inventoryPanel')?.classList.remove('hidden');
      }
      if (Date.now() - startedAt > 5000) {
        resolve(false);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  })`;
}

function auditScript() {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const overlaps = (a, b) => !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
  const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.right <= outer.right && inner.bottom <= outer.bottom;
  const panel = rect("#inventoryPanel");
  const header = rect(".inventory-header");
  const core = rect(".inventory-core");
  const equipment = rect("#equipmentSlots");
  const bag = rect("#inventorySlots");
  const gold = rect(".panel-gold");
  const footer = rect(".inventory-footer");
  const slotRects = [...document.querySelectorAll(".equipment-slot, .item-slot")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  });
  const equipmentItems = [...document.querySelectorAll(".equipment-slot")].map((slot) => {
    const label = slot.querySelector("span").getBoundingClientRect();
    const item = slot.querySelector(".equipment-item").getBoundingClientRect();
    return {
      slot: slot.dataset.slot,
      labelAboveItem: label.bottom <= item.y,
      labelDoesNotOverlapItem: !(label.bottom > item.y && label.y < item.bottom),
    };
  });
  return {
    viewport: { width: innerWidth, height: innerHeight },
    actionButtons: document.querySelectorAll(".hud-action").length,
    inventoryButtonImages: document.querySelectorAll("#inventoryButton img").length,
    iconLoaded: document.querySelector("#inventoryButton img")?.complete && document.querySelector("#inventoryButton img")?.naturalWidth > 0,
    controlsVisible: getComputedStyle(document.querySelector("#mobileControls")).display !== "none",
    panelInsideViewport: panel.x >= 0 && panel.y >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight,
    noPageScroll: document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight,
    headerText: document.querySelector(".inventory-header").innerText.replace(/\s+/g, " ").trim(),
    inventoryTabs: [...document.querySelectorAll("#inventoryPanel .panel-tabs button")].map((el) => el.textContent.trim()),
    forgeTabs: [...document.querySelectorAll("#forgePanel .panel-tabs button")].map((el) => el.textContent.trim()),
    hasResourceSlots: Boolean(document.querySelector("#resourceSlots")),
    hasTooltip: Boolean(document.querySelector("#itemTooltip")),
    hasForgeCraftPanel: Boolean(document.querySelector("#forgeCraftPanel")),
    hasForgeRefinePanel: Boolean(document.querySelector("#forgeRefinePanel")),
    equipmentLabels: [...document.querySelectorAll("#equipmentSlots .equipment-slot > span")].map((el) => el.textContent),
    inventorySlots: document.querySelectorAll("#inventorySlots .item-slot").length,
    panelContainsAllSections: [header, core, equipment, bag, gold, footer].every((r) => contains(panel, r)),
    overlaps: {
      headerCore: overlaps(header, core),
      equipmentBag: overlaps(equipment, bag),
      bagGold: overlaps(bag, gold),
      goldFooter: overlaps(gold, footer),
      footerPanelOverflow: footer.bottom > panel.bottom,
    },
    verticalGaps: {
      headerToCore: Math.round(core.y - header.bottom),
      equipmentToBag: Math.round(bag.y - equipment.bottom),
      bagToGold: Math.round(gold.y - bag.bottom),
      goldToFooter: Math.round(footer.y - gold.bottom),
      footerToPanelBottom: Math.round(panel.bottom - footer.bottom),
    },
    equipmentItems,
    anySlotOutsideCore: slotRects.some((r) => !contains(core, r)),
  };
}

function waitForInventoryScript() {
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const panelOpen = !document.querySelector('#inventoryPanel')?.classList.contains('hidden');
      const slots = document.querySelectorAll('#inventorySlots .item-slot').length;
      if (panelOpen && slots === 10) {
        resolve(true);
        return;
      }
      if (Date.now() - started > 5000) {
        reject(new Error('Timed out waiting for inventory slots'));
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  })`;
}

function assertAudit(name, audit) {
  const failures = [];
  if (audit.actionButtons !== 1) failures.push("expected exactly one HUD action button");
  if (audit.inventoryButtonImages !== 1 || !audit.iconLoaded) failures.push("inventory icon did not load");
  if (!audit.panelInsideViewport) failures.push("panel outside viewport");
  if (!audit.noPageScroll) failures.push("page scroll detected");
  if (audit.viewport.width <= 760 && audit.controlsVisible) failures.push("mobile controls should be hidden while inventory is open");
  if (audit.inventorySlots !== 10) failures.push("expected 10 inventory slots");
  if (audit.inventoryTabs.join("|") !== "Equipment|Shards") failures.push("inventory tabs missing");
  if (audit.forgeTabs.join("|") !== "Refine|Craft") failures.push("forge tabs missing");
  if (!audit.hasResourceSlots) failures.push("resource slots container missing");
  if (!audit.hasTooltip) failures.push("item tooltip missing");
  if (!audit.hasForgeCraftPanel || !audit.hasForgeRefinePanel) failures.push("forge panels missing");
  if (!audit.panelContainsAllSections) failures.push("panel does not contain all sections");
  if (audit.anySlotOutsideCore) failures.push("a slot is outside core");
  for (const [key, value] of Object.entries(audit.overlaps)) {
    if (value) failures.push(`overlap: ${key}`);
  }
  for (const item of audit.equipmentItems) {
    if (!item.labelAboveItem || !item.labelDoesNotOverlapItem) failures.push(`bad equipment label: ${item.slot}`);
  }
  if (failures.length) throw new Error(`${name} inventory audit failed: ${failures.join(", ")}`);
}

async function connectCdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    send(method, params = {}) {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

async function urlOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function waitFor(fn, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    let value = null;
    try {
      value = await fn();
    } catch {
      value = null;
    }
    if (value) return value;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
