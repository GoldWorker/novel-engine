/**
 * Main-thread Worker client — start / steer / pause / resume / snapshot.
 * 主线程宿主：通过 `createEngineClient` 发送协议消息（v: 1）。
 *
 * Pair with `examples/engine.worker.ts`. `pause` / `steer` take effect after
 * the current Worker instruction, not mid-tool. `steer` records a decision and
 * sets `flow=steering` so `route` returns null until `resume()`.
 *
 * Protocol (`ENGINE_PROTOCOL === 1`):
 *   main → worker:  start | steer | pause | resume | snapshot
 *   worker → main:  event | snapshot | error
 *
 * Event kinds: started | step | paused | resumed | steered | stopped
 */

/// <reference lib="dom" />

import { createEngineClient, ENGINE_PROTOCOL } from "novel-engine";

export function connectEngine(workerUrl: URL) {
  const worker = new Worker(workerUrl, { type: "module" });
  const engine = createEngineClient(worker);

  engine.onEvent((event) => {
    switch (event.kind) {
      case "started":
      case "step":
      case "paused":
      case "resumed":
      case "steered":
      case "stopped":
        console.log(event.kind, event);
        break;
    }
  });

  return { worker, engine };
}

export async function demoHostLoop(): Promise<void> {
  const { engine } = connectEngine(new URL("./engine.worker.ts", import.meta.url));

  const result = await engine.start({
    prompt: "写一本三章短篇：灯塔看守人捡到一封没有寄信人的信。",
    maxSteps: 40,
  });

  await engine.pause();
  await engine.steer("把结局改成和解");
  await engine.resume();
  const snap = await engine.snapshot();

  console.log(result.stoppedReason, snap.paused, snap.running, ENGINE_PROTOCOL);
  engine.close();
}

void demoHostLoop();
