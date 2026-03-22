/**
 * ClaudeCliService.ts — Claude Code CLI spawn with streaming NDJSON output.
 *
 * Extension-host port of electron/services/ClaudeCodeService.js.
 * Spawns `claude` CLI as a child process, writes the prompt via stdin,
 * and streams NDJSON lines from stdout.  Parsed events are broadcast
 * through the inherited EventEmitter (worker-output, worker-complete,
 * worker-error).
 *
 * Preserves all original semantics:
 *   - buildArgs: --print --output-format stream-json --verbose [--model]
 *                [--dangerously-skip-permissions] [--resume] [--add-dir]
 *                [--append-system-prompt]
 *   - stdin prompt write + close
 *   - NDJSON line-buffered parsing on stdout
 *   - stderr accumulation
 *   - 10-second "no output" safety warning
 *   - env cleanup (ELECTRON_RUN_AS_NODE, CLAUDECODE)
 */

import { spawn } from 'child_process';

import {
  AgentRunnerService,
  SpawnWorkerOptions,
  SpawnResult,
  WorkerRecord,
  AgentProvider,
} from './AgentRunnerService';

// ---------------------------------------------------------------------------
// Claude-specific worker record (extends base with no extra fields currently)
// ---------------------------------------------------------------------------

interface ClaudeWorkerRecord extends WorkerRecord {
  provider: 'claude';
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export class ClaudeCliService extends AgentRunnerService {
  public readonly provider: AgentProvider = 'claude';

  /**
   * Spawn a Claude Code CLI worker for a task.
   *
   * Mirrors the behaviour of electron/services/ClaudeCodeService.js#spawnWorker
   * but emits events via EventEmitter instead of calling a broadcastFn.
   */
  spawnWorker(opts: SpawnWorkerOptions): SpawnResult {
    const cliPath = opts.cliPath || 'claude';
    const args = this.buildArgs(opts);
    const promptText = opts.prompt;
    const env = this.buildCleanEnv();

    const proc = spawn(cliPath, args, {
      cwd: opts.projectDir || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt via stdin then close — avoids arg parsing issues with flags
    proc.stdin!.write(promptText);
    proc.stdin!.end();

    const worker: ClaudeWorkerRecord = {
      provider: 'claude',
      taskId: opts.taskId,
      dashboardId: opts.dashboardId,
      process: proc,
      pid: proc.pid!,
      startedAt: new Date().toISOString(),
      output: '',
      errorOutput: '',
      lineBuffer: '',
    };

    this.registerWorker(worker);

    // Safety timeout: warn if no stdout within 10 seconds
    let gotOutput = false;
    setTimeout(() => {
      if (!gotOutput && this.activeWorkers.has(proc.pid!)) {
        // Intentional console.warn — diagnostic aid, not user-facing
        console.warn(
          `[ClaudeCliService] WARNING: No stdout received after 10s from PID: ${proc.pid}`,
        );
      }
    }, 10000);

    // -----------------------------------------------------------------------
    // Stream stdout — buffer NDJSON lines and emit parsed events
    // -----------------------------------------------------------------------
    proc.stdout!.on('data', (chunk: Buffer) => {
      gotOutput = true;
      const text = chunk.toString();
      worker.output += text;
      worker.lineBuffer += text;

      const [lines, remaining] = this.splitNdjsonLines(worker.lineBuffer);
      worker.lineBuffer = remaining;

      for (const line of lines) {
        const parsed = this.tryParseJson(line);

        this.broadcast('worker-output', {
          pid: proc.pid!,
          provider: 'claude',
          taskId: opts.taskId,
          dashboardId: opts.dashboardId,
          chunk: line + '\n',
          parsed,
        });
      }
    });

    // -----------------------------------------------------------------------
    // Accumulate stderr
    // -----------------------------------------------------------------------
    proc.stderr!.on('data', (chunk: Buffer) => {
      worker.errorOutput += chunk.toString();
    });

    // -----------------------------------------------------------------------
    // Process close — emit worker-complete
    // -----------------------------------------------------------------------
    proc.on('close', (code: number | null) => {
      const exitCode = code == null ? 0 : code;
      this.unregisterWorker(proc.pid!);

      this.broadcast('worker-complete', {
        pid: proc.pid!,
        provider: 'claude',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        exitCode,
        output: worker.output,
        errorOutput: worker.errorOutput,
      });
    });

    // -----------------------------------------------------------------------
    // Spawn error — emit worker-error
    // -----------------------------------------------------------------------
    proc.on('error', (err: Error) => {
      this.unregisterWorker(proc.pid!);

      this.broadcast('worker-error', {
        pid: proc.pid!,
        provider: 'claude',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        error: err.message,
      });
    });

    return {
      pid: proc.pid!,
      taskId: opts.taskId,
      dashboardId: opts.dashboardId,
    };
  }

  // -----------------------------------------------------------------------
  // Argument builder — mirrors ClaudeCodeService.js#buildArgs exactly
  // -----------------------------------------------------------------------

  private buildArgs(opts: SpawnWorkerOptions): string[] {
    const args: string[] = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }
    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }
    if (opts.projectDir) {
      args.push('--add-dir', opts.projectDir);
    }
    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt);
    }

    return args;
  }
}

export default ClaudeCliService;
