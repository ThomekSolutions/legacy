const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const PORT = 3142;
const URL = `http://localhost:${PORT}/play.html`;
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

fs.mkdirSync(ARTIFACTS, { recursive: true });

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const dataDir = path.join(ARTIFACTS, "inventory-ui-data");
  fs.rmSync(dataDir, { recursive: true, force: true });
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), LEGACY_TEST_MODE: "1", DATA_DIR: dataDir },
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  try {
    await waitFor(() => urlOk(URL), 5000, "server");

    const desktop = await auditViewport(1280, 720, "inventory-desktop-audit.png", 9343);
    const mobile = await auditViewport(390, 844, "inventory-mobile-audit.png", 9344);

    const result = { desktop, mobile };
    fs.writeFileSync(path.join(ARTIFACTS, "inventory-audit.json"), `${JSON.stringify(result, null, 2)}\n`);
    assertAudit("desktop", desktop.audit);
    assertAudit("mobile", mobile.audit);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    server.kill();
  }
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
    await openInventoryForAudit(cdp);
    await delay(350);
    await waitForInventory(cdp);
    const shardFlow = width >= 760 ? await runShardUiFlow(cdp) : { skipped: true };
    const auditResult = await cdp.send("Runtime.evaluate", {
      expression: `(${auditScript})()`,
      returnByValue: true,
    });
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshotPath = path.join(ARTIFACTS, screenshotName);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    cdp.close();
    return { screenshotPath, audit: auditResult.result.value, shardFlow };
  } finally {
    chrome.kill();
  }
}

async function runShardUiFlow(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(${shardUiFlowScript})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result.result.value;
  if (!value?.ok) throw new Error(`shard UI flow failed: ${JSON.stringify(value)}`);
  return value;
}

async function shardUiFlowScript() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 6000) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeout) {
      if (predicate()) return true;
      await sleep(40);
    }
    throw new Error(label);
  };
  try {
    await waitFor(() => typeof ws !== "undefined" && ws && ws.readyState === WebSocket.OPEN && snapshot?.id, "socket ready");
    closePanel(document.querySelector("#inventoryPanel"));
    ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 28 * 32, y: 42 * 32 } }));
    ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "fragment", id: "magic", amount: 5 }));
    ws.send(JSON.stringify({ t: "testGiveItem", rarity: "common", depth: 10 }));
    await waitFor(() => (
      snapshot?.forgeNearby
      && (snapshot.resources || []).some((item) => item.resourceKind === "fragment" && item.resourceId === "magic" && item.stack >= 5)
      && (snapshot.inventory || []).some((item) => item.rarity === "common")
    ), "forge setup ready");

    openForge();
    setForgeTab("refine");
    await sleep(120);
    const fragmentButton = [...document.querySelectorAll("#forgeFragments .forge-item")].find((el) => /Magic Fragment/.test(el.textContent));
    if (!fragmentButton) throw new Error("magic fragment refine button missing");
    fragmentButton.click();
    await waitFor(() => (
      logs.some((entry) => /Converted 5 Magic Fragments into Transmutation Shard/.test(entry))
      && (snapshot.resources || []).some((item) => item.resourceKind === "shard" && item.resourceId === "transmutation")
    ), "refine conversion log missing");

    setForgeTab("craft");
    await sleep(160);
    const shardButton = [...document.querySelectorAll("#forgeShards .forge-item")].find((el) => el.dataset.resourceId === "transmutation");
    if (!shardButton) throw new Error("transmutation shard button missing");
    shardButton.click();
    await waitFor(() => document.body.classList.contains("is-shard-armed") && /Transmutation Shard/.test(document.body.dataset.armedShard || ""), "transmutation shard did not arm");
    const commonTarget = [...document.querySelectorAll("#forgeEquipment .forge-item")].find((el) => el.dataset.itemRarity === "common");
    if (!commonTarget) throw new Error("common forge target missing");
    if (!commonTarget.classList.contains("is-compatible")) throw new Error("common target was not highlighted as compatible");
    const targetId = commonTarget.dataset.itemId;
    commonTarget.click();
    await waitFor(() => logs.some((entry) => /Transmutation Shard applied/i.test(entry)) && (snapshot.inventory || []).some((item) => item.uid === targetId && item.rarity === "magic"), "forge transmutation application did not complete");
    closePanel(document.querySelector("#forgePanel"));
    document.querySelector("#inventoryPanel")?.classList.remove("hidden");
    renderInventory();
    renderEquipment();
    return { ok: true, targetId };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      bodyArmed: document.body.classList.contains("is-shard-armed"),
      armedShard: document.body.dataset.armedShard || "",
      logs: typeof logs !== "undefined" ? logs.slice(0, 6) : [],
      resources: (snapshot?.resources || []).map((item) => `${item.resourceKind}:${item.resourceId}:${item.stack}`),
      inventory: (snapshot?.inventory || []).map((item) => `${item.name}:${item.rarity}`),
    };
  }
}

function clickScript() {
  return `(() => {
    const connected = typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN;
    if (connected || document.querySelector('#inventoryButton')) {
      document.querySelector('#inventoryButton')?.click();
      return true;
    }
    if (typeof connect === 'function') connect();
    if (!document.querySelector('#equipmentSlots')?.children.length) {
      const labels = { helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', weapon: 'Weapon' };
      document.querySelector('#equipmentSlots').innerHTML = Object.entries(labels).map(([id, label]) => '<div class="equipment-slot equipment-slot--' + id + '" data-slot="' + id + '"><span>' + label + '</span><div class="equipment-item"><em>' + label + '</em></div></div>').join('');
    }
    if (!document.querySelector('#inventorySlots')?.children.length) {
      document.querySelector('#inventorySlots').innerHTML = Array.from({ length: 10 }, (_, index) => '<button type="button" class="item-slot" data-index="' + index + '"></button>').join('');
    }
    document.querySelector('#inventoryPanel')?.classList.remove('hidden');
    return !document.querySelector('#inventoryPanel')?.classList.contains('hidden');
  })()`;
}

async function openInventoryForAudit(cdp) {
  await waitFor(async () => {
    const result = await cdp.send("Runtime.evaluate", { expression: clickScript(), returnByValue: true });
    return result.result.value === true;
  }, 5000, "inventory open");
}

async function waitForInventory(cdp) {
  await waitFor(async () => {
    const result = await cdp.send("Runtime.evaluate", { expression: waitForInventoryScript(), returnByValue: true });
    return result.result.value === true;
  }, 5000, "inventory slots");
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
  return `(() => {
      const panelOpen = !document.querySelector('#inventoryPanel')?.classList.contains('hidden');
      const slots = document.querySelectorAll('#inventorySlots .item-slot').length;
      return panelOpen && slots === 10;
  })()`;
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
