const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const originalExec = childProcess.exec;

childProcess.exec = function exec(command, options, callback) {
  const cb = typeof options === "function" ? options : callback;

  if (process.platform === "win32" && command === "net use") {
    process.nextTick(() => {
      cb?.(Object.assign(new Error("net use probe skipped"), { code: "EPERM" }), "", "");
    });
    return new EventEmitter();
  }

  return originalExec.apply(this, arguments);
};
