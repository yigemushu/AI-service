const fields = {
  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  platform: document.getElementById("platform"),
  businessType: document.getElementById("businessType"),
  customerName: document.getElementById("customerName"),
  rawMessage: document.getElementById("rawMessage"),
  status: document.getElementById("status"),
};

function setStatus(text, isError = false) {
  fields.status.textContent = text;
  fields.status.style.color = isError ? "#be123c" : "#047857";
}

function normalizeBaseUrl(value) {
  return (value || "http://localhost:3000").replace(/\/+$/, "");
}

async function loadSettings() {
  const saved = await chrome.storage.sync.get({
    baseUrl: "http://localhost:3000",
    token: "",
    platform: "闲鱼",
    businessType: "xianyu",
  });
  fields.baseUrl.value = saved.baseUrl;
  fields.token.value = saved.token;
  fields.platform.value = saved.platform;
  fields.businessType.value = saved.businessType;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    baseUrl: fields.baseUrl.value,
    token: fields.token.value,
    platform: fields.platform.value,
    businessType: fields.businessType.value,
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function captureSelection() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("没有找到当前网页");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      selectedText: window.getSelection()?.toString() || "",
      title: document.title || "",
      url: location.href || "",
    }),
  });
  return result?.result || { selectedText: "", title: "", url: "" };
}

document.getElementById("capture").addEventListener("click", async () => {
  try {
    const captured = await captureSelection();
    fields.rawMessage.value = captured.selectedText || fields.rawMessage.value;
    if (!fields.customerName.value && captured.title) fields.customerName.value = captured.title.slice(0, 40);
    setStatus(captured.selectedText ? "已读取选中文本" : "没有检测到选中文本，可以手动粘贴");
  } catch (error) {
    setStatus(error.message || "读取失败", true);
  }
});

document.getElementById("send").addEventListener("click", async () => {
  try {
    await saveSettings();
    const rawMessage = fields.rawMessage.value.trim();
    if (!rawMessage) {
      setStatus("请先选中或粘贴客户消息", true);
      return;
    }
    const captured = await captureSelection().catch(() => ({ url: "" }));
    const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
    const headers = { "Content-Type": "application/json" };
    if (fields.token.value.trim()) headers.Authorization = `Bearer ${fields.token.value.trim()}`;
    const response = await fetch(`${baseUrl}/api/inbox`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customerName: fields.customerName.value.trim(),
        platform: fields.platform.value,
        sourceChannel: "浏览器插件",
        businessType: fields.businessType.value,
        rawMessage,
        sourceUrl: captured.url || "",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `发送失败：${response.status}`);
    setStatus("已发送到消息中心，请回网站点击同步外部消息");
  } catch (error) {
    setStatus(error.message || "发送失败", true);
  }
});

loadSettings();
