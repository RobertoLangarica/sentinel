import { Command } from 'commander';
import chalk from 'chalk';
import { Orchestrator } from './orchestrator.js';
import { WorkflowManagerImpl } from './db/workflow.js';
import { loadConfig, setApiKey, setModel, getConfiguredModel, CONFIG_PATH } from './config.js';
import type { ReviewOptions } from './types.js';


const program = new Command();

program
  .name('sentinel')
  .description('🛡️  Sentinel — AI-powered PR reviewer')
  .version('0.1.0')
  .option('--debug', 'Verbose debug output (prints every `gh` command and full error output)')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().debug) process.env.SENTINEL_DEBUG = '1';
  });

program
  .command('review')
  .description('Review a PR (interactive by default)')
  .argument('[pr-number]', 'PR number to review', (v) => parseInt(v, 10))
  .option('--resume [run-id]', 'Resume a run. With a run-id, resumes that run. With just a PR number (e.g. `review 123 --resume`), resumes the latest run for that PR.')
  .option('--guidance <text>', 'Add specific guidance/constraints')
  .option('--no-guidance', 'Skip the interactive guidance prompt')
  .option('-y, --yes', 'Skip all interactive prompts (automation)')
  .option('--model <name>', 'Override AI model')
  .action(async (prNumber: number | undefined, opts: any) => {
    const pr = Number.isNaN(prNumber as number) ? undefined : prNumber;

    // Resolve --resume:
    //   --resume <run-id>  → resume that exact run
    //   <pr> --resume      → resume the latest run for that PR (opts.resume === true)
    let resumeRunId: string | undefined;
    if (typeof opts.resume === 'string') {
      resumeRunId = opts.resume;
    } else if (opts.resume === true) {
      if (pr == null) {
        console.error(chalk.red('✗ `--resume` without a run-id needs a PR number, e.g. `sentinel review 123 --resume`.'));
        process.exit(2);
      }
      const latest = WorkflowManagerImpl.findLatestRunForPR(pr);
      if (!latest) {
        console.error(chalk.red(`✗ No existing run found for PR #${pr}. Run \`sentinel review ${pr}\` to start one.`));
        process.exit(2);
      }
      resumeRunId = latest.id;
      console.log(chalk.dim(`Resuming run ${latest.id} (PR #${pr}, ${latest.state}).`));
    }

    // commander: --no-guidance sets opts.guidance to false; --guidance "x" sets a string.
    const guidanceProvided = typeof opts.guidance === 'string';
    const options: ReviewOptions = {
      prNumber: pr,
      resumeRunId,
      guidance: guidanceProvided ? opts.guidance : undefined,
      interactive: !opts.yes,
      promptGuidance: opts.guidance === false ? false : !opts.yes,
      model: opts.model ?? getConfiguredModel(),
    };
    const res = await new Orchestrator().run(options);
    process.exit(res.state === 'DONE' ? 0 : 1);
  });

const config = program
  .command('config')
  .description('Manage Sentinel configuration (~/.config/sentinel/config.json)');

config
  .command('set-key')
  .description('Save your Anthropic API key so you never have to set it again')
  .argument('<key>', 'Anthropic API key (sk-ant-...)')
  .action((key: string) => {
    setApiKey(key);
    console.log(chalk.green('✓ API key saved to ') + chalk.dim(CONFIG_PATH));
    console.log(chalk.dim('  You can now run `sentinel review <pr>` without exporting anything.'));
  });

config
  .command('set-model')
  .description('Set a default model (overridable per-run with --model)')
  .argument('<name>', 'Model name, e.g. claude-3-5-sonnet-latest')
  .action((name: string) => {
    setModel(name);
    console.log(chalk.green('✓ Default model set to ') + chalk.bold(name));
  });

config
  .command('show')
  .description('Show current configuration (key is masked)')
  .action(() => {
    const cfg = loadConfig();
    const masked = cfg.anthropicApiKey
      ? cfg.anthropicApiKey.slice(0, 7) + '…' + cfg.anthropicApiKey.slice(-4)
      : chalk.red('(not set)');
    console.log(`${chalk.dim('Config file:')} ${CONFIG_PATH}`);
    console.log(`${chalk.dim('API key:')}     ${masked}`);
    console.log(`${chalk.dim('Model:')}       ${cfg.model ?? chalk.dim('(default)')}`);
  });

config
  .command('path')
  .description('Print the config file path')
  .action(() => console.log(CONFIG_PATH));


const runs = program
  .command('runs')
  .description('List recent review runs')
  .option('--limit <n>', 'Max runs to show', (v) => parseInt(v, 10), 20)
  .action((opts: { limit: number }) => {
    const list = WorkflowManagerImpl.listRuns(opts.limit);
    if (!list.length) { console.log(chalk.dim('No runs yet.')); return; }
    console.log(chalk.bold('\nRecent review runs:\n'));
    for (const r of list) {
      const kb = r.kbExtractedSha ? chalk.dim(` kb@${r.kbExtractedSha.slice(0, 7)}`) : '';
      console.log(`  ${chalk.cyan(r.id.padEnd(24))} PR #${String(r.prNumber).padEnd(6)} ${stateColor(r.state)} ${chalk.dim(r.ageLabel)}${kb}`);
    }
    console.log(chalk.dim("\nResume:  sentinel review --resume <run-id>"));
    console.log(chalk.dim("Clean:   sentinel runs prune   (removes finished runs)\n"));
  });

runs
  .command('rm')
  .description('Delete one or more runs by id')
  .argument('<run-ids...>', 'Run id(s) to delete')
  .action((ids: string[]) => {
    let removed = 0;
    for (const id of ids) {
      if (WorkflowManagerImpl.deleteRun(id)) { console.log(chalk.green(`✓ removed ${id}`)); removed++; }
      else console.log(chalk.yellow(`• not found: ${id}`));
    }
    console.log(chalk.dim(`\n${removed} run(s) removed.`));
  });

runs
  .command('prune')
  .description('Remove finished runs (DONE/FAILED). Use --all to remove every run.')
  .option('--all', 'Remove ALL runs, including in-progress ones')
  .action((opts: { all?: boolean }) => {
    const deleted = WorkflowManagerImpl.pruneRuns({ all: opts.all });
    if (!deleted.length) { console.log(chalk.dim('Nothing to prune.')); return; }
    for (const id of deleted) console.log(chalk.green(`✓ removed ${id}`));
    console.log(chalk.dim(`\n${deleted.length} run(s) pruned${opts.all ? ' (all)' : ' (finished only)'}.`));
  });


function stateColor(state: string): string {
  if (state === 'DONE') return chalk.green(state.padEnd(10));
  if (state === 'FAILED') return chalk.red(state.padEnd(10));
  return chalk.yellow(state.padEnd(10));
}

program.parseAsync().catch((err) => {
  console.error(chalk.red(`✗ ${err?.message ?? err}`));
  process.exit(2);
});
