import chalk from "chalk";

const noColor = process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0";

export const dim = (s: string) => (noColor ? s : chalk.dim(s));
export const bld = (s: string) => (noColor ? s : chalk.bold(s));
export const grn = (s: string) => (noColor ? s : chalk.green(s));
export const ylw = (s: string) => (noColor ? s : chalk.yellow(s));
export const red = (s: string) => (noColor ? s : chalk.red(s));

/** Notable inline values: file paths, locale codes, branch names, variable names */
export const highlight = (s: string) => (noColor ? s : chalk.bold(s));

/** Structural elements: bars, separators — should recede visually */
export const info = (s: string) => (noColor ? s : chalk.dim(s));

/** Interactive/selected state: active cursor, selected items */
export const active = (s: string) => (noColor ? s : chalk.green(s));
