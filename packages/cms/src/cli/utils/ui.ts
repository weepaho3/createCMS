import kleur from 'kleur';
import ora from 'ora';
import prompts from 'prompts';

export function printMeta(label: string, value: string) {
  console.log(`  ${kleur.bold().gray(label)} ${value}`);
}

export function createSpinner(text: string) {
  return ora({ text: `  ${text}`, color: 'cyan' });
}

export async function confirmOverwrite(filePath: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `\n  ${kleur.red('Error:')} Output file already exists and no interactive terminal is available.`,
    );
    printMeta('file', filePath);
    printMeta(
      'hint',
      'Delete the file first or run the command in an interactive terminal.',
    );
    return false;
  }

  console.log();
  console.log(
    `  ${kleur.yellow('!')} ${kleur.bold('Output file already exists.')}`,
  );
  printMeta('file', filePath);

  const response = await prompts(
    {
      type: 'confirm',
      name: 'overwrite',
      message: 'Overwrite existing file?',
      initial: false,
    },
    {
      onCancel: () => false,
    },
  );

  return response.overwrite === true;
}
