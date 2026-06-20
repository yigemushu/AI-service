const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const port = process.env.LOCAL_SERVER_PORT || "3000";
const mode = process.env.LOCAL_SERVER_MODE || "start";
const logPath = path.join(root, "dev-server-stable.log");
const errorLogPath = path.join(root, "dev-server-stable.err.log");
const pidPath = path.join(root, ".local-server-supervisor.pid");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

let child = null;
let stopping = false;

function append(file, message) {
  fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function startChild() {
  if (stopping) return;
  const args = [nextBin, mode, "-p", port];
  append(logPath, `[supervisor] starting next ${mode} on ${port}`);
  const out = fs.openSync(logPath, "a");
  const err = fs.openSync(errorLogPath, "a");
  child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", out, err],
  });
  child.on("exit", (code, signal) => {
    append(errorLogPath, `[supervisor] next exited code=${code ?? ""} signal=${signal ?? ""}`);
    child = null;
    if (!stopping) setTimeout(startChild, 1000);
  });
}

function stop() {
  stopping = true;
  if (child && !child.killed) child.kill();
  try {
    fs.unlinkSync(pidPath);
  } catch {}
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
fs.writeFileSync(pidPath, String(process.pid), "utf8");
startChild();
setInterval(() => {}, 60_000);
