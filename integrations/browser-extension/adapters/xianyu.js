(function () {
  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isXianyuPage(url = location.href) {
    return /(^https?:\/\/([^/]+\.)?(goofish\.com|2\.taobao\.com)\/)/i.test(String(url || ""));
  }

  const CONTROL_TEXT = /^(发送|清除未读|表情|图片|常用语|更多|订单|退款|联系卖家|输入消息|按 Enter 发送|请选择客户消息|Send)$/i;
  const CONTROL_COMBO_TEXT = /(清除未读|表情|图片|常用语|更多|订单|退款|发送|Send)(\s*[-|/]\s*|\s+)+(清除未读|表情|图片|常用语|更多|订单|退款|发送|Send)/i;
  const BUBBLE_HINTS = /(message|msg|bubble|chat|talk|im|dialog|conversation|item|cell|row|消息|气泡|聊天)/i;

  function isControlText(value) {
    const text = cleanText(value);
    return !text || CONTROL_TEXT.test(text) || CONTROL_COMBO_TEXT.test(text);
  }

  function isLikelyMessageBubble(element) {
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const hints = [
        current.className,
        current.id,
        current.getAttribute?.("role"),
        current.getAttribute?.("data-role"),
        current.getAttribute?.("data-testid"),
        current.getAttribute?.("aria-label"),
      ].join(" ");
      if (BUBBLE_HINTS.test(hints)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function normalizeUrl(value) {
    try {
      const url = new URL(value || location.href);
      url.hash = "";
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return String(value || location.href).split("#")[0];
    }
  }

  function inferCustomerName(element, fallback = "") {
    const candidates = [];
    function push(value) {
      const text = cleanText(value)
        .replace(/\s*[-_|｜].*$/, "")
        .replace(/的?\s*聊天.*$/, "")
        .trim();
      if (!text || text.length < 2 || text.length > 24) return;
      if (/闲鱼|咸鱼|goofish|淘宝|消息|聊天|首页|登录|搜索|订单|商品|发布|通知|AI客服/.test(text)) return;
      if (/^[0-9:：\-. ]+$/.test(text)) return;
      if (!candidates.includes(text)) candidates.push(text);
    }
    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1) {
      push(current.getAttribute?.("data-nick"));
      push(current.getAttribute?.("data-name"));
      push(current.getAttribute?.("data-username"));
      push(current.getAttribute?.("aria-label"));
      push(current.getAttribute?.("title"));
      push(current.previousElementSibling?.textContent);
      current.querySelectorAll?.("img[alt], [title], [aria-label]").forEach((item) => {
        push(item.getAttribute("alt"));
        push(item.getAttribute("title"));
        push(item.getAttribute("aria-label"));
      });
      current = current.parentElement;
    }
    (document.title || "").split(/[-_|｜]/).forEach(push);
    return candidates[0] || cleanText(fallback);
  }

  function inferItemTitle() {
    const title = cleanText(document.title || "");
    const parts = title.split(/[-_|｜]/).map(cleanText).filter(Boolean);
    const item = parts.find((part) => !/闲鱼|咸鱼|goofish|消息|聊天|淘宝/.test(part));
    if (item) return item.slice(0, 80);
    const candidates = [...document.querySelectorAll("[title], [aria-label], h1, h2")]
      .map((element) => cleanText(element.getAttribute("title") || element.getAttribute("aria-label") || element.textContent || ""))
      .filter((text) => text.length >= 2 && text.length <= 80 && !/闲鱼|消息|聊天|搜索|首页/.test(text));
    return candidates[0] || "";
  }

  function inferThreadId() {
    const url = normalizeUrl(location.href);
    const parsed = new URL(url);
    const keys = ["conversationId", "threadId", "chatId", "itemId", "id"];
    for (const key of keys) {
      const value = parsed.searchParams.get(key);
      if (value) return value;
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  }

  function inferMessageTime(element) {
    const candidates = [];
    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1) {
      candidates.push(current.getAttribute?.("data-time"));
      candidates.push(current.getAttribute?.("datetime"));
      candidates.push(current.querySelector?.("time")?.getAttribute("datetime"));
      candidates.push(current.querySelector?.("time")?.textContent);
      current = current.parentElement;
    }
    const raw = candidates.map(cleanText).find(Boolean);
    if (!raw) return new Date().toISOString();
    const time = Number(raw);
    if (Number.isFinite(time) && time > 1000000000) return new Date(time > 9999999999 ? time : time * 1000).toISOString();
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function buildMessageId(input) {
    const source = [
      input.platform || "闲鱼",
      input.shopAlias || "default-shop",
      input.platformThreadId || input.externalConversationId || normalizeUrl(location.href),
      input.customerName || "",
      input.itemTitle || "",
      input.messageText || "",
      input.messageTime || "",
    ].join("|");
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
      hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
    }
    return `xy_${Math.abs(hash).toString(36)}`;
  }

  function extractMessage(element, text, settings = {}) {
    const messageText = cleanText(text || element?.innerText || element?.textContent || "");
    if (isControlText(messageText)) throw new Error("Filtered control text");
    if (!isLikelyMessageBubble(element)) throw new Error("Not a likely message bubble");
    const customerName = inferCustomerName(element, settings.customerName);
    const itemTitle = inferItemTitle();
    const sourceUrl = normalizeUrl(location.href);
    const platformThreadId = inferThreadId();
    const messageTime = inferMessageTime(element);
    const payload = {
      platform: "闲鱼",
      shopAlias: cleanText(settings.shopAlias) || "default-shop",
      businessType: settings.businessType || "xianyu",
      customerName,
      customerFolder: cleanText(settings.customerFolder) || customerName,
      itemTitle,
      messageText,
      messageTime,
      sourceUrl,
      direction: "inbound",
      externalConversationId: platformThreadId,
      platformThreadId,
      externalMessageId: "",
    };
    payload.externalMessageId = buildMessageId(payload);
    return payload;
  }

  window.AICS_XIANYU_ADAPTER = {
    isXianyuPage,
    extractMessage,
    normalizeUrl,
  };
})();
