import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: process.env.ENV_FILE ?? fileURLToPath(new URL('../../../../.env', import.meta.url)) })
