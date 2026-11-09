import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: process.env.ENV_FILE ?? fileURLToPath(new URL('../../../.env', import.meta.url)) })

const command = process.argv.slice(2)
if (command.length === 0) {
  throw new Error('Provide a Prisma CLI command, such as validate or migrate deploy')
}

const prismaCli = resolve('node_modules/prisma/build/index.js')
const child = spawn(process.execPath, [prismaCli, ...command], { stdio: 'inherit', env: process.env })

child.on('error', (error) => {
  console.error('Could not start the Prisma CLI', error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
