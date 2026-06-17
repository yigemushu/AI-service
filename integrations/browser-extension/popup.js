const fields = {
  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  myNickname: document.getElementById("myNickname"),
  platform: document.getElementById("platform"),
  businessType: document.getElementById("businessType"),
  customerName: document.getElementById("customerName"),
  customerFolder: document.getElementById("customerFolder"),
  rawMessage: document.getElementById("rawMessage"),
  status: document.getElementById("status"),
};

function setStatus(text, isError = false) {
  fields.status.textContent = text;
  fields.status.style.color = isError ? "#be123c" : "#047857";
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("网站地址不能为空");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("网站地址格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("网站地址格式不正确");
  return url.origin;
}

function inboxUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/api/inbox`;
}

function inboxHealthUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/api/inbox/health`;
}

function getTrimmedValue(name) {
  return String(fields[name]?.value || "").trim();
}

function validateRequiredConfig() {
  const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
  const token = getTrimmedValue("token");
  const platform = getTrimmedValue("platform");
  const businessType = getTrimmedValue("businessType");
  if (!token) throw new Error("请先填写 Webhook Token");
  if (!platform) throw new Error("请选择平台");
  if (!businessType) throw new Error("请选择业务类型");
  return { baseUrl, token, platform, businessType };
}

async function loadSettings() {
  const saved = await chrome.storage.sync.get({
    baseUrl: "http://localhost:3000",
    token: "",
    myNickname: "",
    platform: "闲鱼",
    businessType: "xianyu",
    customerName: "",
    customerFolder: "",
  });
  fields.baseUrl.value = saved.baseUrl || "http://localhost:3000";
  fields.token.value = saved.token;
  fields.myNickname.value = saved.myNickname;
  fields.platform.value = saved.platform;
  fields.businessType.value = saved.businessType;
  fields.customerName.value = saved.customerName;
  fields.customerFolder.value = saved.customerFolder;
}

async function saveSettings() {
  const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
  await chrome.storage.sync.set({
    baseUrl,
    token: getTrimmedValue("token"),
    myNickname: getTrimmedValue("myNickname"),
    platform: fields.platform.value,
    businessType: fields.businessType.value,
    customerName: getTrimmedValue("customerName"),
    customerFolder: getTrimmedValue("customerFolder"),
  });
  fields.baseUrl.value = baseUrl;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function captureSelection() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("没有找到当前网页");
  const excludedName = fields.myNickname.value.trim();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [excludedName],
    func: (myNickname) => {
      function normalizeName(value) {
        return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
      }

      function cleanName(value) {
        const text = String(value || "")
          .replace(/\s+/g, " ")
          .replace(/^\s*(和|与|跟)\s*/, "")
          .replace(/\s*[-_|｜—].*$/, "")
          .replace(/(的)?聊天.*$/, "")
          .trim();
        if (!text || text.length < 2 || text.length > 12) return "";
        if (/https?:|www\.|localhost|搜索|消息|聊天|闲鱼|咸鱼|goofish|淘宝|首页|登录|客服接单|AI客服|订单|店铺|商品|发布|通知|您好|你好|因为|需要|可以|能吗|多少钱|道歉|检讨|朋友|女朋友|男朋友/i.test(text)) return "";
        if (/^[0-9:：/\-. ]+$/.test(text)) return "";
        if (normalizeName(text) === normalizeName(myNickname)) return "";
        if (myNickname && normalizeName(text).includes(normalizeName(myNickname))) return "";
        return text;
      }

      function pushCandidate(list, value) {
        const cleaned = cleanName(value);
        if (cleaned && !list.includes(cleaned)) list.push(cleaned);
      }

      function textFromElement(element) {
        if (!element) return "";
        const ownText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .trim();
        return ownText || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
      }

      function selectedTextCandidates(value) {
        const lines = String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
        return lines.filter((line, index) => {
          if (line.length > 12) return false;
          if (/[？?。！!，,：:]/.test(line)) return false;
          const previous = lines[index - 1] || "";
          const next = lines[index + 1] || "";
          return Boolean(previous.length > 8 && next.length > 4);
        });
      }

      function pushNearbyShortText(list, root) {
        root?.querySelectorAll?.("*").forEach((element) => {
          const text = textFromElement(element);
          if (text && text.length <= 12) pushCandidate(list, text);
        });
      }

      function inferCustomerName() {
        const nearCandidates = [];
        const pageCandidates = [];
        const selection = window.getSelection();
        const selectedText = selection?.toString() || "";
        selectedTextCandidates(selectedText).forEach((line) => pushCandidate(nearCandidates, line));

        const title = document.title || "";

        const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
          ? selection.anchorNode
          : selection?.anchorNode?.parentElement;
        let current = anchorElement;
        for (let depth = 0; current && depth < 8; depth += 1) {
          pushCandidate(nearCandidates, current.getAttribute("data-nick"));
          pushCandidate(nearCandidates, current.getAttribute("data-name"));
          pushCandidate(nearCandidates, current.getAttribute("data-username"));
          pushCandidate(nearCandidates, current.getAttribute("aria-label"));
          pushCandidate(nearCandidates, current.getAttribute("title"));
          current.querySelectorAll?.("img[alt], [title], [aria-label]").forEach((item) => {
            pushCandidate(nearCandidates, item.getAttribute("alt"));
            pushCandidate(nearCandidates, item.getAttribute("title"));
            pushCandidate(nearCandidates, item.getAttribute("aria-label"));
          });
          const previous = current.previousElementSibling;
          const next = current.nextElementSibling;
          pushCandidate(nearCandidates, textFromElement(previous));
          pushCandidate(nearCandidates, textFromElement(next));
          pushNearbyShortText(nearCandidates, previous);
          pushNearbyShortText(nearCandidates, current);
          current = current.parentElement;
        }

        document
          .querySelectorAll('[class*="nick" i], [class*="name" i], [class*="user" i], [class*="buyer" i], [class*="contact" i], [class*="chat" i], header, h1, h2')
          .forEach((element) => pushCandidate(pageCandidates, textFromElement(element)));

        const titleParts = title.split(/[-_|｜—·]/).map((part) => part.trim());
        titleParts.forEach((part) => pushCandidate(pageCandidates, part));

        return nearCandidates[0] || pageCandidates[0] || "";
      }

      return {
        selectedText: window.getSelection()?.toString() || "",
        title: document.title || "",
        url: location.href || "",
        customerName: inferCustomerName(),
      };
    },
  });
  return result?.result || { selectedText: "", title: "", url: "", customerName: "" };
}

document.getElementById("capture").addEventListener("click", async () => {
  try {
    const captured = await captureSelection();
    fields.rawMessage.value = captured.selectedText || fields.rawMessage.value;
    if (!fields.customerName.value && captured.customerName) fields.customerName.value = captured.customerName;
    if (!fields.customerFolder.value && (captured.customerName || fields.customerName.value)) fields.customerFolder.value = captured.customerName || fields.customerName.value;
    setStatus(captured.selectedText ? `已读取选中文本${captured.customerName ? `，识别客户：${captured.customerName}` : ""}` : "没有检测到选中文本，可以手动粘贴");
  } catch (error) {
    setStatus(error.message || "读取失败", true);
  }
});

document.getElementById("saveConfig").addEventListener("click", async () => {
  try {
    await saveSettings();
    setStatus("配置已保存");
  } catch (error) {
    setStatus(error.message || "保存失败，请重试", true);
  }
});

document.getElementById("testConnection").addEventListener("click", async () => {
  try {
    const { baseUrl, token } = validateRequiredConfig();
    const response = await fetch(inboxHealthUrl(baseUrl), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setStatus("网站可访问，Token 正确");
      return;
    }
    if (response.status === 401) throw new Error("Token 错误");
    if (response.status === 503) throw new Error("服务端未配置 Token");
    throw new Error(data.error || `测试失败：${response.status}`);
  } catch (error) {
    if (error instanceof TypeError) {
      setStatus("网络失败，请检查网站地址", true);
    } else {
      setStatus(error.message || "测试连接失败", true);
    }
  }
});

document.getElementById("send").addEventListener("click", async () => {
  try {
    const { baseUrl, token, platform, businessType } = validateRequiredConfig();
    let rawMessage = fields.rawMessage.value.trim();
    let captured = { url: "", customerName: "" };
    if (!rawMessage) {
      captured = await captureSelection().catch(() => ({ url: "", customerName: "" }));
      rawMessage = captured.selectedText?.trim() || "";
    }
    if (!rawMessage) throw new Error("请先选择或输入客户消息");
    if (!captured.url && !captured.customerName) captured = await captureSelection().catch(() => ({ url: "", customerName: "" }));
    const response = await fetch(inboxUrl(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        customerName: fields.customerName.value.trim() || captured.customerName || "",
        customerFolder: fields.customerFolder.value.trim() || fields.customerName.value.trim() || captured.customerName || "",
        platform,
        sourceChannel: "浏览器插件",
        businessType,
        text: rawMessage,
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
