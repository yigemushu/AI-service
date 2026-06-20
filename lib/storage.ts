"use client";

import { defaultSettings } from "./constants";
import type { CustomerMessage, EvaluationRun, FeedbackRecord, KnowledgeRule, MessageTemplate, OptimizationRecord, Order, RecognitionExperience, Settings } from "./types";

const keys = {
  orders: "ai-service.orders",
  customerMessages: "ai-service.customer-messages",
  optimization: "ai-service.optimization",
  evaluationRuns: "ai-service.evaluation-runs",
  settings: "ai-service.settings",
  templates: "ai-service.templates",
  knowledgeRules: "ai-service.knowledge-rules",
  recognitionExperiences: "ai-service.recognition-experiences",
  feedback: "ai-service.feedback",
  demoAuth: "ai-service.demo-auth",
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
}

function writeJson<T>(key: string, value: T) {
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    try {
      window.sessionStorage.setItem(key, raw);
    } catch {
      // Storage can be blocked in some browser modes; callers should still be able to update in-memory UI state.
    }
  }
}

export function getOrders() {
  return readJson<Order[]>(keys.orders, []);
}

export function saveOrders(orders: Order[]) {
  writeJson(keys.orders, orders);
  window.dispatchEvent(new Event("orders-updated"));
}

export function getCustomerMessages() {
  return readJson<CustomerMessage[]>(keys.customerMessages, []);
}

export function saveCustomerMessages(messages: CustomerMessage[]) {
  writeJson(keys.customerMessages, messages);
  window.dispatchEvent(new Event("customer-messages-updated"));
}

export function getTemplates() {
  return readJson<MessageTemplate[]>(keys.templates, []);
}

export function saveTemplates(templates: MessageTemplate[]) {
  writeJson(keys.templates, templates);
  window.dispatchEvent(new Event("templates-updated"));
}

export function getKnowledgeRules() {
  return readJson<KnowledgeRule[]>(keys.knowledgeRules, []);
}

export function saveKnowledgeRules(rules: KnowledgeRule[]) {
  writeJson(keys.knowledgeRules, rules);
  window.dispatchEvent(new Event("knowledge-updated"));
}

export function getRecognitionExperiences() {
  return readJson<RecognitionExperience[]>(keys.recognitionExperiences, []);
}

export function saveRecognitionExperiences(experiences: RecognitionExperience[]) {
  writeJson(keys.recognitionExperiences, experiences);
  window.dispatchEvent(new Event("recognition-experiences-updated"));
}

export function getOptimizationRecords() {
  return readJson<OptimizationRecord[]>(keys.optimization, []);
}

export function saveOptimizationRecords(records: OptimizationRecord[]) {
  writeJson(keys.optimization, records);
  window.dispatchEvent(new Event("optimization-updated"));
}

export function getEvaluationRuns() {
  return readJson<EvaluationRun[]>(keys.evaluationRuns, []);
}

export function saveEvaluationRuns(runs: EvaluationRun[]) {
  writeJson(keys.evaluationRuns, runs);
  window.dispatchEvent(new Event("evaluation-runs-updated"));
}

export function getFeedbackRecords() {
  return readJson<FeedbackRecord[]>(keys.feedback, []);
}

export function saveFeedbackRecords(records: FeedbackRecord[]) {
  writeJson(keys.feedback, records);
}

export function getSettings() {
  return readJson<Settings>(keys.settings, defaultSettings);
}

export function saveSettings(settings: Settings) {
  writeJson(keys.settings, settings);
}

export async function getWebhookTokenForClient() {
  const localToken = getSettings().inboxWebhookToken?.trim();
  if (localToken) return localToken;

  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const data = (await response.json()) as { inboxWebhookToken?: string };
    const serverToken = typeof data.inboxWebhookToken === "string" ? data.inboxWebhookToken.trim() : "";
    if (response.ok && serverToken) {
      saveSettings({ ...getSettings(), inboxWebhookToken: serverToken });
      return serverToken;
    }
  } catch {
    // The app can still work with local-only settings if the server settings endpoint is unavailable.
  }

  return "";
}

export function isDemoAuthed() {
  return readJson<boolean>(keys.demoAuth, false);
}

export function setDemoAuthed(value: boolean) {
  writeJson(keys.demoAuth, value);
  window.dispatchEvent(new Event("auth-updated"));
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
