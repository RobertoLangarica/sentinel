import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';
import prompts from 'prompts';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Reporter, ApprovalChoice, CalibrationResult } from './types.js';


export class ConsoleReporter implements Reporter {
  header(runId: string, prTitle?: string): void {
    console.log(chalk.bold.cyan('\n🛡️  Sentinel PR Review'));
    console.log(chalk.dim('━'.repeat(50)));
    console.log(`${chalk.dim('Run ID:')} ${chalk.bold(runId)}`);
    if (prTitle) console.log(`${chalk.dim('PR:')} ${prTitle}`);
    console.log('');
  }

  step(label: string) {
    const spinner = ora(label).start();
    return {
      succeed: (msg?: string) => { spinner.succeed(msg ?? label); },
      fail: (msg?: string) => { spinner.fail(msg ?? label); },
    };
  }

  panel(title: string, body: string): void {
    console.log(boxen(body, { title, padding: 1, borderStyle: 'round', borderColor: 'cyan' }));
  }

  previewReview(markdown: string): void {
    console.log(boxen(markdown, { title: '📝 Review Preview', padding: 1, borderStyle: 'round', borderColor: 'yellow' }));
  }

  async promptGuidance(): Promise<string | undefined> {
    const { text } = await prompts({
      type: 'text', name: 'text',
      message: 'Additional guidance/constraints (Enter to skip):',
    });
    return text?.trim() ? text.trim() : undefined;
  }

  async promptApproval(): Promise<ApprovalChoice> {
    const { choice } = await prompts({
      type: 'select', name: 'choice', message: 'What next?',
      choices: [
        { title: 'Approve and post to GitHub', value: 'approve' },
        { title: 'Edit review in $EDITOR', value: 'edit' },
        { title: 'Regenerate review', value: 'regenerate' },
        { title: 'Cancel', value: 'cancel' },
      ],
    });
    return (choice ?? 'cancel') as ApprovalChoice;
  }

  async promptRegenerateMessage(): Promise<string | undefined> {
    const { text } = await prompts({
      type: 'text', name: 'text',
      message: 'What should change? (calibrate the next review — Enter to just regenerate):',
    });
    return text?.trim() ? text.trim() : undefined;
  }

  showCalibration(result: CalibrationResult): void {
    const lines: string[] = [];
    lines.push(chalk.bold('Sentinel:') + ' ' + result.acknowledgement);
    if (result.rules.length) {
      lines.push('');
      lines.push(chalk.dim('Rules it will apply next pass:'));
      for (const r of result.rules) {
        const badge = r.directive === 'ignore'
          ? chalk.red('✗ IGNORE')
          : chalk.green('✓ ENFORCE');
        lines.push(`  ${badge}  ${r.rule}`);
      }
    } else {
      lines.push('');
      lines.push(chalk.dim('(No explicit rule changes — regenerating with your note as guidance.)'));
    }
    console.log(boxen(lines.join('\n'), {
      title: '🔧 Calibration', padding: 1, borderStyle: 'round', borderColor: 'magenta',
    }));
  }

  async confirmCalibration(): Promise<boolean> {
    const { ok } = await prompts({
      type: 'confirm', name: 'ok',
      message: 'Regenerate with these rules?',
      initial: true,
    });
    return ok !== false;
  }

  async openInEditor(markdown: string): Promise<string> {

    const editor = process.env.EDITOR;
    if (!editor) {
      console.log(chalk.yellow('⚠️  $EDITOR not set — keeping review unedited.'));
      return markdown;
    }
    const file = join(tmpdir(), `sentinel-review-${Date.now()}.md`);
    writeFileSync(file, markdown, 'utf8');
    spawnSync(editor, [file], { stdio: 'inherit' });
    const edited = readFileSync(file, 'utf8');
    try { unlinkSync(file); } catch { /* ignore */ }
    return edited;
  }

  result(opts: { url?: string; sha?: string; failed?: boolean; message?: string }): void {
    console.log(chalk.dim('━'.repeat(50)));
    if (opts.failed) {
      console.log(chalk.red(`✗ ${opts.message ?? 'Run failed.'}`));
    } else {
      console.log(chalk.green('✅ Review complete!'));
      if (opts.url) console.log(`   ${chalk.dim('View:')} ${opts.url}`);
      if (opts.sha) console.log(`   ${chalk.dim('Commit:')} ${opts.sha.slice(0, 7)}`);
    }
  }
}
