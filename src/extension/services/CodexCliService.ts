/**
 * CodexCliService.ts — Codex CLI spawn with temp-file output extraction.
 *
 * Extension-host port of electron/services/CodexService.js.
 * Spawns `codex` CLI as a child process, writes the prompt (with optional
 * system prompt prefix) via stdin, streams stdout lines, and on close
 * reads the final message from a temp file written by Codex's -o flag.
 *
 * Preserves all original semantics:
 *   - buildArgs: exec [resume] --json [--model]
 *                [--dangerously-bypass-approvals-and-sandbox | --full-auto]
 *                [-C projectDir] [--skip-git-repo-check] [-o tempFile]
 *   - buildPromptText: prepends system prompt if present
 *   - cleanErrorOutput: filters "Reading prompt from stdin..." noise
 *   - outputLastMessagePath temp file: read on close, then unlink
 *   - env cleanup (ELECTRON_RUN_AS_NODE, CLAUDECODE)
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AgentRunnerService,
  SpawnWorkerOptions,
  SpawnResult,
  WorkerRecord,
  AgentProvider,
} from './AgentRunnerService';

// ---------------------------------------------------------------------------
// Codex-specific worker record — includes outputLastMessagePath
// ---------------------------------------------------------------------------

interface CodexWorkerRecord extends WorkerRecord {
  provider: 'codex';
  outputLastMessagePath: string;
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export class CodexCliService extends AgentRunnerService {
  public readonly provider: AgentProvider = 'codex';

  /**
   * Spawn a Codex CLI worker for a task.
   *
   * Mirrors the behaviour of electron/services/CodexService.js#spawnWorker
   * but emits events via EventEmitter instead of calling a broadcastFn.
   */
  spawnWorker(opts: SpawnWorkerOptions): SpawnResult {
    const cliPath = opts.cliPath || 'codex';
    const args = this.buildArgs(opts);
    const promptText = this.buildPromptText(opts);

    // Unique temp file for Codex's -o flag (last message extraction)
    const outputLastMessagePath = path.join(
      os.tmpdir(),
      `synapse_codex_last_message_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`,
    );
    args.push('-o', outputLastMessagePath);

    const env = this.buildCleanEnv();

    const proc = spawn(cliPath, args, {
      cwd: opts.projectDir || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write prompt via stdin then close
    proc.stdin!.write(promptText);
    proc.stdin!.end();

    const worker: CodexWorkerRecord = {
      provider: 'codex',
      taskId: opts.taskId,
      dashboardId: opts.dashboardId,
      process: proc,
      pid: proc.pid!,
      startedAt: new Date().toISOString(),
      output: '',
      errorOutput: '',
      lineBuffer: '',
      outputLastMessagePath,
    };

    this.registerWorker(worker);

    // -----------------------------------------------------------------------
    // Stream stdout — buffer lines and emit parsed events
    // -----------------------------------------------------------------------
    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      worker.output += text;
      worker.lineBuffer += text;

      const [lines, remaining] = this.splitNdjsonLines(worker.lineBuffer);
      worker.lineBuffer = remaining;

      for (const line of lines) {
        const parsed = this.tryParseJson(line);

        this.broadcast('worker-output', {
          pid: proc.pid!,
          provider: 'codex',
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
    // Process close — read last message temp file, emit worker-complete
    // -----------------------------------------------------------------------
    proc.on('close', (code: number | null) => {
      this.unregisterWorker(proc.pid!);

      // Read the last message from the temp file written by Codex's -o flag
      let lastMessage: string | null = null;
      try {
        lastMessage = fs.readFileSync(worker.outputLastMessagePath, 'utf-8');
      } catch {
        // File may not exist if Codex exited early
      }

      // Clean up temp file
      try {
        fs.unlinkSync(worker.outputLastMessagePath);
      } catch {
        // Ignore — already gone or never created
      }

      this.broadcast('worker-complete', {
        pid: proc.pid!,
        provider: 'codex',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        exitCode: code == null ? 0 : code,
        output: worker.output,
        errorOutput: this.cleanErrorOutput(worker.errorOutput),
        lastMessage,
      });
    });

    // -----------------------------------------------------------------------
    // Spawn error — emit worker-error
    // -----------------------------------------------------------------------
    proc.on('error', (err: Error) => {
      this.unregisterWorker(proc.pid!);

      this.broadcast('worker-error', {
        pid: proc.pid!,
        provider: 'codex',
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
  // Argument builder — mirrors CodexService.js#buildArgs exactly
  // -----------------------------------------------------------------------

  private buildArgs(opts: SpawnWorkerOptions): string[] {
    const args: string[] = opts.resumeSessionId
      ? ['exec', 'resume', '--json']
      : ['exec', '--json'];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.dangerouslySkipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--full-auto');
    }

    if (!opts.resumeSessionId && opts.projectDir) {
      args.push('-C', opts.projectDir);
    }

    args.push('--skip-git-repo-check');

    if (opts.resumeSessionId) {
      args.push(opts.resumeSessionId);
    }

    return args;
  }

  // -----------------------------------------------------------------------
  // Prompt builder — mirrors CodexService.js#buildPromptText exactly
  // -----------------------------------------------------------------------

  private buildPromptText(opts: SpawnWorkerOptions): string {
    if (!opts.systemPrompt) {
      return opts.prompt;
    }

    return [
      'Follow these operating instructions exactly:',
      opts.systemPrompt,
      '',
      'User request:',
      opts.prompt,
    ].join('\n');
  }

  // -----------------------------------------------------------------------
  // Error output cleaner — mirrors CodexService.js#cleanErrorOutput exactly
  // -----------------------------------------------------------------------

  private cleanErrorOutput(errorOutput: string): string {
    if (!errorOutput) return '';

    return errorOutput
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed === 'Reading prompt from stdin...') return false;
        return true;
      })
      .join('\n')
      .trim();
  }
}

export default CodexCliService;
