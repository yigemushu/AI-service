import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 客服订单助手",
  description: "面向聊天成交场景的 AI 客服订单工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
