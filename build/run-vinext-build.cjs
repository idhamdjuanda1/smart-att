require("./vite-windows-spawn-fix.cjs");

process.argv = [process.argv[0], "vinext", "build", ...process.argv.slice(2)];
import("../node_modules/vinext/dist/cli.js");
