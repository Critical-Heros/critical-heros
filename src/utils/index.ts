import { nanoid } from 'nanoid'
import type { ArgumentsCamelCase } from 'yargs'
import type { OptionsType } from '@/types'

export function generateSessionId() {
  return nanoid()
}

export function toSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **bold** → *bold*
    .replace(/^#{1,3} (.+)$/gm, '*$1*') // # Heading → *Heading*
    .replace(/^- /gm, '• ') // - item → • item
}

export function getOptions(
  argv: ArgumentsCamelCase,
  pkg: {
    name: string
    version: string
  },
) {
  return {
    name: pkg.name,
    version: pkg.version,
    port: argv.port,
  } as OptionsType
}
