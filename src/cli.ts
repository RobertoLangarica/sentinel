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
  .version('0.1.0');

program
  .command('review')
  .description('Review a PR (interactive by default)')
  .argument('[pr-number]', 'PR number to review', (v) => parseInt(v, 10))
  .option('--resume <run-id>', 'Resume an interrupted run')
  .option('--guidance <text>', 'Add specific guidance/constraints')
  .option('--no-guidance', 'Skip the interactive guidance prompt')
  .option('-y, --yes', 'Skip all interactive prompts (automation)')
  .option('--model <name>', 'Override AI model')
  .action(async (prNumber: number | undefined, opts: any) => {
    // commander: --no-guidance sets opts.guidance to false; --guidance "x" sets a string.
    const guidanceProvided = typeof opts.guidance === 'string';
    const options: ReviewOptions = {
      prNumber: Number.isNaN(prNumber as number) ? undefined : prNumber,
      resumeRunId: opts.resume,
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


program
  .command('runs')
  .description('List recent review runs')
  .option('--limit <n>', 'Max runs to show', (v) => parseInt(v, 10), 20)
  .action((opts: { limit: number }) => {
    const runs = WorkflowManagerImpl.listRuns(opts.limit);
    if (!runs.length) { console.log(chalk.dim('No runs yet.')); return; }
    console.log(chalk.bold('\nRecent review runs:\n'));
    for (const r of runs) {
      console.log(`  ${chalk.cyan(r.id.padEnd(24))} PR #${String(r.prNumber).padEnd(6)} ${stateColor(r.state)} ${chalk.dim(r.ageLabel)}`);
    }
    console.log(chalk.dim("\nUse 'sentinel review --resume <run-id>' to continue.\n"));
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
