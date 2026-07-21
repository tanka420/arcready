#!/usr/bin/env node

import { inspectScanOptionPresence, runCli } from "./cli.js";

const argv = process.argv.slice(2);
const isJsonV2Scan =
  argv[0] === "scan" && inspectScanOptionPresence(argv.slice(1)).jsonV2;
let jsonV2StdoutFailed = false;

if (isJsonV2Scan) {
  process.stdout.on("error", () => {
    if (jsonV2StdoutFailed) return;
    jsonV2StdoutFailed = true;
    process.stderr.write(
      "ArcReady json-v2 error: unable to write canonical scan output.\n"
    );
    process.exitCode = 2;
  });
}

const cliExitCode = await runCli(argv, {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
});

process.exitCode = jsonV2StdoutFailed ? 2 : cliExitCode;
